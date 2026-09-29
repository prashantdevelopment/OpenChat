import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";

// A throwaway VAPID key pair, and web-push replaced by a recorder.
await vi.hoisted(async () => {
    const { createECDH } = await import("crypto");
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    process.env.VAPID_PUBLIC_KEY = ecdh.getPublicKey().toString("base64url");
    process.env.VAPID_PRIVATE_KEY = ecdh.getPrivateKey().toString("base64url");
});
const pushes = vi.hoisted(() => []);
vi.mock("web-push", () => ({
    default: { sendNotification: vi.fn(async (subscription, body, options) => { pushes.push({ endpoint: subscription.endpoint, payload: JSON.parse(body), options }); return { statusCode: 201 }; }) },
}));

import { createServer } from "http";
import { createECDH, randomBytes, randomUUID } from "crypto";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import User from "../src/models/user.model.js";
import Conversation from "../src/models/conversation.model.js";
import { connectTestDb, disconnectTestDb, encrypted, registerAndLogin } from "./helpers.js";

const THROTTLE_MS = 400;
let io, url, alice, bob, carol, conversationId;
const openSockets = [];

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 50, pushThrottleMs: THROTTLE_MS });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    [alice, bob, carol] = await Promise.all(["alice_pm", "bob_pm", "carol_pm"].map(registerAndLogin));
    await User.updateOne({ _id: bob.id }, { $set: { name: "Bob Kumar" } });
    conversationId = (await request(app).post("/api/conversations").set("Cookie", alice.cookie).send({ otherUserId: bob.id })).body.conversation._id;
    // Each of them has turned on notifications on one device.
    for (const user of [alice, bob, carol]) {
        const ecdh = createECDH("prime256v1");
        ecdh.generateKeys();
        await request(app).post("/api/push/subscriptions").set("Cookie", user.cookie)
            .send({ endpoint: `https://fcm.googleapis.com/fcm/send/${user.id}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } })
            .expect(201);
    }
});
afterAll(async () => {
    io.close();
    await disconnectTestDb();
});
beforeEach(async () => {
    pushes.length = 0;
    // Alice has read everything so far: each test starts at 0 unread.
    await Conversation.updateOne({ _id: conversationId }, { $set: { [`lastReadAt.${alice.id}`]: new Date() } });
});
afterEach(async () => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
    await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS + 100)); // each test starts outside the throttle window
    pushes.length = 0;
});

const connectAs = (user, { visible = true, tabId } = {}) => new Promise((resolve, reject) => {
    const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false, auth: { visible, tabId } });
    openSockets.push(socket);
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
});
const send = (socket, text = "hello", extra = {}) =>
    socket.timeout(2000).emitWithAck("sendMessage", { conversationId, clientId: randomUUID(), ...encrypted(text), ...extra });
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const pushesTo = (user) => pushes.filter((p) => p.endpoint.endsWith(user.id));

describe("push for a new message", () => {
    it("alice has no OpenChat open: she gets 'Bob Kumar · New message', never the text", async () => {
        const b = await connectAs(bob);
        await send(b, "the secret plan");
        await settle();
        const [push] = pushesTo(alice);
        expect(push.payload).toEqual({ title: "Bob Kumar", body: "New message", url: `/chat/${conversationId}`, tag: conversationId });
        expect(JSON.stringify(push)).not.toMatch(/secret|ciphertext/);
        expect(push.options).toMatchObject({ urgency: "high", topic: conversationId, TTL: 86400 });
    });

    it("the sender gets none for his own message (even with his app off screen), and outsiders none at all", async () => {
        const b = await connectAs(bob, { visible: false });
        await send(b);
        await settle();
        expect(pushesTo(bob)).toHaveLength(0);
        expect(pushesTo(carol)).toHaveLength(0);
        expect(pushesTo(alice)).toHaveLength(1);
    });

    it("alice has OpenChat on screen: no push (she sees the in-app alert)", async () => {
        await connectAs(alice, { visible: true });
        const b = await connectAs(bob);
        await send(b);
        await settle();
        expect(pushesTo(alice)).toHaveLength(0);
    });

    it("alice's app is open but hidden (phone locked, other tab): she gets the push", async () => {
        await connectAs(alice, { visible: false });
        const b = await connectAs(bob);
        await send(b);
        await settle();
        expect(pushesTo(alice)).toHaveLength(1);
    });

    it("…until she comes back to it (the app says it is visible again)", async () => {
        const a = await connectAs(alice, { visible: false });
        a.emit("appVisible", true);
        await settle(100);
        const b = await connectAs(bob);
        await send(b);
        await settle();
        expect(pushesTo(alice)).toHaveLength(0);
    });

    it("one of her devices on screen is enough (a hidden second one gets nothing)", async () => {
        await connectAs(alice, { visible: false });
        await connectAs(alice, { visible: true });
        const b = await connectAs(bob);
        await send(b);
        await settle();
        expect(pushesTo(alice)).toHaveLength(0);
    });

    it("a message seen on screen is never pushed later, even if she leaves the app right after", async () => {
        const a = await connectAs(alice, { visible: false });
        const b = await connectAs(bob);
        await send(b, "first, while away");
        await settle(100);
        expect(pushesTo(alice)).toHaveLength(1); // the throttle window is now open
        a.emit("appVisible", true);
        await settle(100);
        await send(b, "seen on screen");
        await settle(100);
        a.emit("appVisible", false); // she leaves the app within the window
        await settle(THROTTLE_MS + 200);
        expect(pushesTo(alice)).toHaveLength(1);
    });

    it("a burst of messages: one push at once, then one more with the count", async () => {
        const b = await connectAs(bob);
        await send(b, "one");
        await send(b, "two");
        await send(b, "three");
        await settle(100);
        expect(pushesTo(alice).map((p) => p.payload.body)).toEqual(["New message"]);
        await settle(THROTTLE_MS + 200);
        const bodies = pushesTo(alice).map((p) => p.payload.body);
        expect(bodies).toHaveLength(2);
        expect(bodies[1]).toMatch(/^\d+ new messages$/);
    });

    it("'Show who it's from' off: just 'OpenChat · New message'", async () => {
        await request(app).patch("/api/users/me").set("Cookie", alice.cookie).send({ pushShowSender: false }).expect(200);
        const b = await connectAs(bob);
        await send(b);
        await settle();
        expect(pushesTo(alice)[0].payload).toMatchObject({ title: "OpenChat", body: "New message" });
        await request(app).patch("/api/users/me").set("Cookie", alice.cookie).send({ pushShowSender: true }).expect(200);
    });

    it("a lingering older socket of the same tab is closed: it can't hold back her push", async () => {
        const ghost = await connectAs(alice, { visible: true, tabId: "tab-aaaaaaaa" });
        const closed = new Promise((resolve) => ghost.on("disconnect", resolve));
        await connectAs(alice, { visible: false, tabId: "tab-aaaaaaaa" }); // the same tab, reconnected
        await closed;
        const b = await connectAs(bob);
        await send(b);
        await settle();
        expect(pushesTo(alice)).toHaveLength(1);
    });

    it("other tabs stay, and another user's tab id never closes hers", async () => {
        const mine = await connectAs(alice, { visible: true, tabId: "tab-bbbbbbbb" });
        await connectAs(alice, { visible: true, tabId: "tab-cccccccc" });
        await connectAs(carol, { visible: true, tabId: "tab-bbbbbbbb" });
        await connectAs(alice, { visible: true, tabId: "bad id!" }); // malformed: ignored
        await settle(150);
        expect(mine.connected).toBe(true);
        const b = await connectAs(bob);
        await send(b);
        await settle();
        expect(pushesTo(alice)).toHaveLength(0); // still on screen
    });

    it("across a block: no push either way (the message is refused before anything is sent)", async () => {
        await request(app).put(`/api/blocks/${bob.id}`).set("Cookie", alice.cookie).expect(200);
        try {
            const a = await connectAs(alice, { visible: false });
            const b = await connectAs(bob, { visible: false });
            expect((await send(b, "blocked")).success).toBe(false);
            expect((await send(a, "blocker")).success).toBe(false);
            await settle();
            expect(pushes).toHaveLength(0);
        } finally {
            await request(app).delete(`/api/blocks/${bob.id}`).set("Cookie", alice.cookie).expect(200);
        }
    });

    it("the setting only takes true or false", async () => {
        expect((await request(app).patch("/api/users/me").set("Cookie", alice.cookie).send({ pushShowSender: "no" })).status).toBe(400);
    });

    it("the visibility event is rate-limited like other events and ignores anything but true", async () => {
        const a = await connectAs(alice, { visible: false });
        a.emit("appVisible", "yes"); // not true: still hidden
        await settle(100);
        const b = await connectAs(bob);
        await send(b);
        await settle();
        expect(pushesTo(alice)).toHaveLength(1);
    });
});

describe("what the push says (the kind of message)", () => {
    it.each([
        ["image", "Photo"],
        ["video", "Video"],
        ["audio", "Voice message"],
        ["file", "File"],
        ["text", "New message"],
    ])("%s → '%s'", async (messageType, body) => {
        const { createMessagePush } = await import("../src/services/messagePush.service.js");
        const push = createMessagePush({ hasVisibleApp: async () => false, throttleMs: 0 });
        push({ _id: conversationId, participants: [alice.id, bob.id] }, { sender: bob.id, messageType }, [1, 0]);
        await settle(150);
        expect(pushesTo(alice).at(-1).payload.body).toBe(body);
    });

    it("call records don't push here (calls get their own, step 65)", async () => {
        const { createMessagePush } = await import("../src/services/messagePush.service.js");
        const push = createMessagePush({ hasVisibleApp: async () => false, throttleMs: 0 });
        push({ _id: conversationId, participants: [alice.id, bob.id] }, { sender: bob.id, messageType: "call" }, [1, 0]);
        await settle(150);
        expect(pushesTo(alice)).toHaveLength(0);
    });
});
