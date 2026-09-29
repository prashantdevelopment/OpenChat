import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Before the app loads: a throwaway VAPID key pair, and web-push replaced by a
// recorder (tests never call real push services).
await vi.hoisted(async () => {
    const { createECDH } = await import("crypto");
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    process.env.VAPID_PUBLIC_KEY = ecdh.getPublicKey().toString("base64url");
    process.env.VAPID_PRIVATE_KEY = ecdh.getPrivateKey().toString("base64url");
    process.env.VAPID_SUBJECT = "mailto:test@openchat.dev";
});
const sent = vi.hoisted(() => ({ calls: [], answer: null }));
vi.mock("web-push", () => ({
    default: {
        sendNotification: vi.fn(async (subscription, body, options) => {
            sent.calls.push({ subscription, body, options });
            if (sent.answer) throw Object.assign(new Error("push service said no"), { statusCode: sent.answer(subscription) });
            return { statusCode: 201 };
        }),
    },
}));

import { createECDH, randomBytes } from "crypto";
import request from "supertest";
import app from "../src/app.js";
import PushSubscription from "../src/models/pushSubscription.model.js";
import Session from "../src/models/session.model.js";
import { connectTestDb, disconnectTestDb, registerAndLogin, PASSWORD } from "./helpers.js";

let alice, bob;
beforeAll(async () => {
    await connectTestDb();
    alice = await registerAndLogin("alice_push");
    bob = await registerAndLogin("bob_push");
});
afterAll(disconnectTestDb);
beforeEach(async () => {
    sent.calls = [];
    sent.answer = null;
    await PushSubscription.deleteMany({});
});

// What a browser's pushManager.subscribe() gives: an endpoint and its keys.
const browserKeys = () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
};
let n = 0;
const subscription = (host = "fcm.googleapis.com") => ({ endpoint: `https://${host}/fcm/send/device-${++n}`, keys: browserKeys() });
const subscribe = (user, body) => request(app).post("/api/push/subscriptions").set("Cookie", user.cookie).send(body);
const login = async (username) => {
    const res = await request(app).post("/api/auth/login").send({ identifier: username, password: PASSWORD });
    return { cookie: res.headers["set-cookie"][0].split(";")[0] };
};

describe("Web Push: set-up", () => {
    it("tells the app it's on, with the public key the browser subscribes with", async () => {
        const res = await request(app).get("/api/push/config").set("Cookie", alice.cookie);
        expect(res.body).toMatchObject({ enabled: true, publicKey: process.env.VAPID_PUBLIC_KEY });
    });

    it("needs a login", async () => {
        await request(app).get("/api/push/config").expect(401);
        await request(app).post("/api/push/subscriptions").send(subscription()).expect(401);
    });
});

describe("Web Push: subscribing", () => {
    it.each([
        ["Chrome / Android (FCM)", "fcm.googleapis.com"],
        ["Firefox (Mozilla)", "updates.push.services.mozilla.com"],
        ["Safari (Apple)", "web.push.apple.com"],
        ["Edge on Windows (WNS)", "wns2-par02p.notify.windows.com"],
    ])("accepts %s", async (_label, host) => {
        expect((await subscribe(alice, subscription(host))).status).toBe(201);
        expect(await PushSubscription.countDocuments({ userId: alice.id })).toBe(1);
    });

    it.each([
        ["plain http", "http://fcm.googleapis.com/fcm/send/x"],
        ["another site", "https://evil.example/collect"],
        ["a look-alike host", "https://fcm.googleapis.com.evil.example/x"],
        ["an internal address (SSRF)", "https://169.254.169.254/latest/meta-data"],
        ["localhost", "https://localhost:5000/api/users"],
        ["not a URL", "fcm.googleapis.com/x"],
        ["too long", `https://fcm.googleapis.com/${"a".repeat(1100)}`],
    ])("refuses an endpoint that is %s", async (_label, endpoint) => {
        const res = await subscribe(alice, { endpoint, keys: browserKeys() });
        expect(res.status).toBe(400);
        expect(await PushSubscription.countDocuments({})).toBe(0);
    });

    it("refuses keys that aren't a browser's (wrong sizes, not base64url)", async () => {
        const good = browserKeys();
        for (const keys of [{ ...good, p256dh: "abc" }, { ...good, auth: randomBytes(8).toString("base64url") }, { ...good, auth: "not base64!" }, null]) {
            expect((await subscribe(alice, { ...subscription(), keys })).status).toBe(400);
        }
    });

    it("the same browser subscribing again (or for another account) is one subscription, now theirs", async () => {
        const sub = subscription();
        await subscribe(alice, sub).expect(201);
        await subscribe(bob, sub).expect(201);
        const saved = await PushSubscription.find({ endpoint: sub.endpoint });
        expect(saved).toHaveLength(1);
        expect(String(saved[0].userId)).toBe(bob.id);
    });

    it("keeps at most 10 devices per person (the oldest go)", async () => {
        for (let i = 0; i < 12; i++) await subscribe(alice, subscription()).expect(201);
        expect(await PushSubscription.countDocuments({ userId: alice.id })).toBe(10);
    });

    it("turning off removes only your own subscription", async () => {
        const sub = subscription();
        await subscribe(alice, sub).expect(201);
        await request(app).delete("/api/push/subscriptions").set("Cookie", bob.cookie).send({ endpoint: sub.endpoint }).expect(200);
        expect(await PushSubscription.countDocuments({})).toBe(1);
        await request(app).delete("/api/push/subscriptions").set("Cookie", alice.cookie).send({ endpoint: sub.endpoint }).expect(200);
        expect(await PushSubscription.countDocuments({})).toBe(0);
    });
});

describe("Web Push: sending", () => {
    it("a test notification goes to your own devices only, signed with the VAPID key", async () => {
        const mine = subscription();
        await subscribe(alice, mine).expect(201);
        await subscribe(bob, subscription()).expect(201);
        const res = await request(app).post("/api/push/test").set("Cookie", alice.cookie);
        expect(res.body.sent).toBe(1);
        expect(sent.calls).toHaveLength(1);
        const [call] = sent.calls;
        expect(call.subscription).toEqual({ endpoint: mine.endpoint, keys: mine.keys });
        expect(JSON.parse(call.body)).toEqual({ title: "OpenChat", body: "Notifications are on for this device.", url: "/settings", tag: "test" });
        expect(call.options.vapidDetails).toMatchObject({ subject: "mailto:test@openchat.dev", publicKey: process.env.VAPID_PUBLIC_KEY });
        expect(call.options).toMatchObject({ TTL: 3600, urgency: "normal" });
    });

    it("a subscription the push service says is gone (410/404) is removed; other errors keep it", async () => {
        const gone = subscription();
        const flaky = subscription();
        await subscribe(alice, gone).expect(201);
        await subscribe(alice, flaky).expect(201);
        sent.answer = (s) => (s.endpoint === gone.endpoint ? 410 : 500);
        const res = await request(app).post("/api/push/test").set("Cookie", alice.cookie);
        expect(res.body.sent).toBe(0);
        expect(await PushSubscription.exists({ endpoint: gone.endpoint })).toBeNull();
        expect(await PushSubscription.exists({ endpoint: flaky.endpoint })).not.toBeNull();
    });

    it("logging out on a device removes its subscription (the next person on that browser gets nothing)", async () => {
        const phone = await login("alice_push");
        const sub = subscription();
        await subscribe(phone, sub).expect(201);
        await request(app).post("/api/auth/logout").set("Cookie", phone.cookie).expect(200);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(await PushSubscription.exists({ endpoint: sub.endpoint })).toBeNull();
    });

    it("'log out of all other devices' removes theirs too, not this one's", async () => {
        const [here, there] = [await login("alice_push"), await login("alice_push")];
        const [mine, theirs] = [subscription(), subscription()];
        await subscribe(here, mine).expect(201);
        await subscribe(there, theirs).expect(201);
        await request(app).post("/api/auth/sessions/end-others").set("Cookie", here.cookie).expect(200);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(await PushSubscription.exists({ endpoint: mine.endpoint })).not.toBeNull();
        expect(await PushSubscription.exists({ endpoint: theirs.endpoint })).toBeNull();
    });

    it("a device whose session ran out (60 days unused) gets nothing, and its subscription is cleaned up", async () => {
        const old = await login("alice_push");
        const sub = subscription();
        await subscribe(old, sub).expect(201);
        const { sessionId } = await PushSubscription.findOne({ endpoint: sub.endpoint });
        await Session.updateOne({ _id: sessionId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        // (A fresh login: the previous test logged alice's other devices out.)
        const res = await request(app).post("/api/push/test").set("Cookie", (await login("alice_push")).cookie);
        expect(res.body.sent).toBe(0);
        expect(sent.calls).toHaveLength(0);
        expect(await PushSubscription.exists({ endpoint: sub.endpoint })).toBeNull();
    });
});
