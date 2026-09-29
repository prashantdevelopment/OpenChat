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
import { connectTestDb, disconnectTestDb, encrypted, registerAndLogin } from "./helpers.js";

const RING_MS = 600;
let io, url, alice, bob, carol, conversationId;
const openSockets = [];

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 50, callRingMs: RING_MS });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    [alice, bob, carol] = await Promise.all(["alice_pc", "bob_pc", "carol_pc"].map(registerAndLogin));
    await User.updateOne({ _id: bob.id }, { $set: { name: "Bob Kumar" } });
    conversationId = (await request(app).post("/api/conversations").set("Cookie", alice.cookie).send({ otherUserId: bob.id })).body.conversation._id;
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
beforeEach(() => {
    pushes.length = 0;
});
afterEach(async () => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
    await new Promise((resolve) => setTimeout(resolve, RING_MS + 100)); // every call of the test has stopped ringing
});

const connectAs = (user, { visible = true } = {}) => new Promise((resolve, reject) => {
    const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false, auth: { visible } });
    openSockets.push(socket);
    // Listen before the connection: a ringing call is handed over at once.
    socket.received = [];
    socket.onAny((event, data) => socket.received.push({ event, data }));
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
});
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const pushesTo = (user) => pushes.filter((p) => p.endpoint.endsWith(user.id));
const signal = () => encrypted("v=0 o=- 1 2 IN IP4 127.0.0.1 a=fingerprint:sha-256 AB:CD");
const call = async (socket, media = "audio") => {
    const callId = randomUUID();
    const response = await socket.timeout(2000).emitWithAck("callUser", { conversationId, callId, media, offer: signal() });
    expect(response.success).toBe(true);
    return callId;
};
const emit = (socket, event, data) => socket.timeout(2000).emitWithAck(event, { conversationId, ...data });
const eventsOf = (socket, name) => socket.received.filter((r) => r.event === name).map((r) => r.data);

describe("push for an incoming call", () => {
    it("alice has no OpenChat open: an urgent 'Bob Kumar · Incoming voice call' that opens the chat", async () => {
        const b = await connectAs(bob);
        const callId = await call(b);
        await settle();
        const [push] = pushesTo(alice);
        expect(push.payload).toEqual({ title: "Bob Kumar", body: "Incoming voice call", url: `/chat/${conversationId}`, tag: `call-${callId}`, call: true });
        expect(push.options).toMatchObject({ urgency: "high", topic: callId.replaceAll("-", "") });
        expect(push.options.TTL).toBeLessThanOrEqual(1); // useless once it stopped ringing
        expect(pushesTo(bob)).toHaveLength(0);
        expect(pushesTo(carol)).toHaveLength(0);
    });

    it("a video call says so", async () => {
        const b = await connectAs(bob);
        await call(b, "video");
        await settle();
        expect(pushesTo(alice)[0].payload.body).toBe("Incoming video call");
    });

    it("alice has OpenChat on screen: no push (it rings there)", async () => {
        const a = await connectAs(alice, { visible: true });
        const b = await connectAs(bob);
        await call(b);
        await settle();
        expect(pushesTo(alice)).toHaveLength(0);
        expect(eventsOf(a, "incomingCall")).toHaveLength(1);
    });

    it("'Show who it's from' off: just 'OpenChat'", async () => {
        await request(app).patch("/api/users/me").set("Cookie", alice.cookie).send({ pushShowSender: false }).expect(200);
        try {
            const b = await connectAs(bob);
            await call(b);
            await settle();
            expect(pushesTo(alice)[0].payload).toMatchObject({ title: "OpenChat", body: "Incoming voice call" });
        } finally {
            await request(app).patch("/api/users/me").set("Cookie", alice.cookie).send({ pushShowSender: true }).expect(200);
        }
    });
});

describe("opening OpenChat while it rings", () => {
    it("her app (opened from the notification) gets the call, the caller's candidates and how long it still rings", async () => {
        const b = await connectAs(bob);
        const callId = await call(b);
        await emit(b, "iceCandidate", { callId, candidate: signal() });
        await emit(b, "iceCandidate", { callId, candidate: signal() });
        await settle(100);
        const a = await connectAs(alice);
        await settle(100);
        const [incoming] = eventsOf(a, "incomingCall");
        expect(incoming).toMatchObject({ callId, conversationId, media: "audio", from: { username: "bob_pc", name: "Bob Kumar" } });
        expect(incoming.offer).toEqual(expect.objectContaining({ ciphertext: expect.any(String), iv: expect.any(String) }));
        expect(incoming.ringsForMs).toBeGreaterThan(0);
        expect(incoming.ringsForMs).toBeLessThan(RING_MS);
        expect(eventsOf(a, "iceCandidate").map((c) => c.callId)).toEqual([callId, callId]);
        expect(JSON.stringify(incoming.from)).not.toMatch(/email|password|googleId/);
    });

    it("she answers from there: the caller hears it, and nothing more is handed over or pushed", async () => {
        const b = await connectAs(bob);
        const callId = await call(b);
        const a = await connectAs(alice);
        await settle(100);
        expect((await emit(a, "answerCall", { callId, answer: signal() })).success).toBe(true);
        await settle(100);
        expect(eventsOf(b, "callAnswered")).toHaveLength(1);
        const later = await connectAs(alice);
        await settle(RING_MS + 100);
        expect(eventsOf(later, "incomingCall")).toHaveLength(0);
        expect(pushesTo(alice).map((p) => p.payload.body)).toEqual(["Incoming voice call"]); // no "Missed"
    });

    it("only the callee gets it: not the caller's other device, not an outsider", async () => {
        const b = await connectAs(bob);
        await call(b);
        const [b2, c] = [await connectAs(bob), await connectAs(carol)];
        await settle(100);
        expect(eventsOf(b2, "incomingCall")).toHaveLength(0);
        expect(eventsOf(c, "incomingCall")).toHaveLength(0);
    });

    it("once it stopped ringing, opening the app brings no call", async () => {
        const b = await connectAs(bob);
        await call(b);
        await settle(RING_MS + 100);
        const a = await connectAs(alice);
        await settle(100);
        expect(eventsOf(a, "incomingCall")).toHaveLength(0);
    });

    it("blocked while it rang: not handed over", async () => {
        const b = await connectAs(bob);
        await call(b);
        await request(app).put(`/api/blocks/${bob.id}`).set("Cookie", alice.cookie).expect(200);
        try {
            const a = await connectAs(alice);
            await settle(100);
            expect(eventsOf(a, "incomingCall")).toHaveLength(0);
        } finally {
            await request(app).delete(`/api/blocks/${bob.id}`).set("Cookie", alice.cookie).expect(200);
        }
    });

    it("the outsider can't end or answer someone else's ringing call", async () => {
        const b = await connectAs(bob);
        const callId = await call(b);
        const c = await connectAs(carol);
        expect((await emit(c, "endCall", { callId, reason: "declined" })).success).toBe(false);
        expect((await emit(c, "answerCall", { callId, answer: signal() })).success).toBe(false);
        const a = await connectAs(alice);
        await settle(100);
        expect(eventsOf(a, "incomingCall")).toHaveLength(1); // still ringing for her
    });
});

describe("missed call", () => {
    it("nobody answered (the caller gives up): the notification becomes 'Missed voice call'", async () => {
        const b = await connectAs(bob);
        const callId = await call(b);
        await settle(100);
        await emit(b, "endCall", { callId, reason: "missed" });
        await settle();
        const bodies = pushesTo(alice).map((p) => p.payload.body);
        expect(bodies).toEqual(["Incoming voice call", "Missed voice call"]);
        const missed = pushesTo(alice)[1];
        expect(missed.payload).toEqual({ title: "Bob Kumar", body: "Missed voice call", url: `/chat/${conversationId}`, tag: `call-${callId}` });
        expect(missed.options).toMatchObject({ urgency: "normal", topic: callId.replaceAll("-", "") });
    });

    it("the caller hung up before an answer: missed too", async () => {
        const b = await connectAs(bob);
        const callId = await call(b, "video");
        await emit(b, "endCall", { callId, reason: "cancelled" });
        await settle();
        expect(pushesTo(alice).map((p) => p.payload.body)).toEqual(["Incoming video call", "Missed video call"]);
    });

    it("the caller vanished without hanging up: missed once the ringing time is over", async () => {
        const b = await connectAs(bob);
        await call(b);
        b.disconnect();
        await settle(RING_MS + 200);
        expect(pushesTo(alice).map((p) => p.payload.body)).toEqual(["Incoming voice call", "Missed voice call"]);
    });

    it("she declined (on another device): no 'Missed'", async () => {
        const b = await connectAs(bob);
        const callId = await call(b);
        const a = await connectAs(alice, { visible: false });
        await emit(a, "endCall", { callId, reason: "declined" });
        await emit(b, "endCall", { callId, reason: "missed" }); // too late: already over
        await settle(RING_MS + 100);
        expect(pushesTo(alice).map((p) => p.payload.body)).toEqual(["Incoming voice call"]);
    });

    it("it rang on her screen: no push at all, not even 'Missed'", async () => {
        await connectAs(alice, { visible: true });
        const b = await connectAs(bob);
        const callId = await call(b);
        await emit(b, "endCall", { callId, reason: "missed" });
        await settle();
        expect(pushesTo(alice)).toHaveLength(0);
    });
});
