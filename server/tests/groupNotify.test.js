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

// Step 72: alice writes and calls in "Goa trip" with bob and carol; eve is an outsider.
let io, url, alice, bob, carol, eve, groupId, directId;
const openSockets = [];

const api = (user) => ({
    get: (path) => request(app).get(path).set("Cookie", user.cookie),
    put: (path, body) => request(app).put(path).set("Cookie", user.cookie).send(body),
    patch: (path, body) => request(app).patch(path).set("Cookie", user.cookie).send(body),
});
const connectAs = (user, { visible = true } = {}) => new Promise((resolve, reject) => {
    const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false, auth: { visible } });
    openSockets.push(socket);
    socket.received = [];
    socket.onAny((event, data) => socket.received.push({ event, data }));
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
});
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));
const pushesTo = (user) => pushes.filter((p) => p.endpoint.endsWith(user.id));
const sendIn = (socket, conversationId, extra = {}) =>
    socket.timeout(2000).emitWithAck("sendMessage", { conversationId, clientId: randomUUID(), ...encrypted("hello"), ...extra });
const mute = (user, id, duration) => api(user).put(`/api/conversations/${id}/mute`, { duration });

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 50, pushThrottleMs: 0 });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    [alice, bob, carol, eve] = await Promise.all(["alice_gn", "bob_gn", "carol_gn", "eve_gn"].map(registerAndLogin));
    await User.updateOne({ _id: alice.id }, { $set: { name: "Alice Rao" } });
    directId = (await request(app).post("/api/conversations").set("Cookie", alice.cookie).send({ otherUserId: bob.id })).body.conversation._id;
    for (const user of [alice, bob, carol, eve]) {
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
    await Conversation.deleteMany({ type: "group" });
    await Conversation.updateOne({ _id: directId }, { $unset: { mutedUntil: "" } });
    const group = await Conversation.create({
        type: "group", name: "Goa trip", participants: [alice.id, bob.id, carol.id], admins: [alice.id], createdBy: alice.id,
        joinedAt: { [alice.id]: new Date(), [bob.id]: new Date(), [carol.id]: new Date() },
    });
    groupId = String(group._id);
    // The group's first key epoch exists (messages must carry epoch 1).
    await Conversation.db.collection("groupkeyepoches").insertOne({ group: group._id, epoch: 1, keys: [] });
});
afterEach(async () => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
    await settle(100);
});

describe("pushes for group messages", () => {
    it("members with no OpenChat open get 'Goa trip · Alice Rao: New message', never the text; the sender and outsiders nothing", async () => {
        const a = await connectAs(alice);
        await sendIn(a, groupId, { epoch: 1 });
        await settle();
        for (const user of [bob, carol]) {
            expect(pushesTo(user)[0].payload).toEqual({ title: "Goa trip", body: "Alice Rao: New message", url: `/chat/${groupId}`, tag: groupId });
        }
        expect(pushesTo(alice)).toHaveLength(0);
        expect(pushesTo(eve)).toHaveLength(0);
        expect(JSON.stringify(pushes)).not.toMatch(/hello|ciphertext/);
    });

    it("someone who hides senders gets neither the group nor who: 'OpenChat · New message in a group'", async () => {
        await api(bob).patch("/api/users/me", { pushShowSender: false }).expect(200);
        try {
            const a = await connectAs(alice);
            await sendIn(a, groupId, { epoch: 1 });
            await settle();
            expect(pushesTo(bob)[0].payload).toMatchObject({ title: "OpenChat", body: "New message in a group" });
        } finally {
            await api(bob).patch("/api/users/me", { pushShowSender: true }).expect(200);
        }
    });

    it("OpenChat on screen: no push (the in-app alert covers it)", async () => {
        await connectAs(carol, { visible: true });
        const a = await connectAs(alice);
        await sendIn(a, groupId, { epoch: 1 });
        await settle();
        expect(pushesTo(carol)).toHaveLength(0);
        expect(pushesTo(bob)).toHaveLength(1);
    });
});

describe("muting", () => {
    it("bob mutes the group: no pushes for him (carol still gets them); when it runs out, they come again", async () => {
        const res = await mute(bob, groupId, "8h").expect(200);
        const hours = (new Date(res.body.mutedUntil) - Date.now()) / 3600_000;
        expect(hours).toBeGreaterThan(7.9);
        expect(hours).toBeLessThanOrEqual(8);
        const a = await connectAs(alice);
        await sendIn(a, groupId, { epoch: 1 });
        await settle();
        expect(pushesTo(bob)).toHaveLength(0);
        expect(pushesTo(carol)).toHaveLength(1);
        await Conversation.updateOne({ _id: groupId }, { $set: { [`mutedUntil.${bob.id}`]: new Date(Date.now() - 1000) } });
        await sendIn(a, groupId, { epoch: 1 });
        await settle();
        expect(pushesTo(bob)).toHaveLength(1);
    });

    it("a 1:1 chat muted: no pushes either", async () => {
        await mute(bob, directId, "always").expect(200);
        const a = await connectAs(alice);
        await sendIn(a, directId);
        await settle();
        expect(pushesTo(bob)).toHaveLength(0);
    });

    it("1 week, always, unmute; only valid durations; only in my own chats", async () => {
        const week = (await mute(bob, groupId, "1w").expect(200)).body.mutedUntil;
        expect(Math.round((new Date(week) - Date.now()) / 86_400_000)).toBe(7);
        expect(new Date((await mute(bob, groupId, "always").expect(200)).body.mutedUntil).getUTCFullYear()).toBe(9999);
        expect((await mute(bob, groupId, null).expect(200)).body.mutedUntil).toBeNull();
        await mute(bob, groupId, "forever").expect(400);
        await mute(bob, groupId, { $gt: "" }).expect(400);
        await mute(eve, groupId, "8h").expect(403);
        await mute(bob, "nope", "8h").expect(400);
    });

    it("only I see my mute: in my chat list and groups, never in anyone else's", async () => {
        await mute(bob, groupId, "8h").expect(200);
        await mute(bob, directId, "1w").expect(200);
        const bobsGroup = (await api(bob).get("/api/groups").expect(200)).body.groups.find((g) => g._id === groupId);
        expect(bobsGroup.mutedUntil).toBeTruthy();
        const alicesGroup = (await api(alice).get("/api/groups").expect(200)).body.groups.find((g) => g._id === groupId);
        expect(alicesGroup.mutedUntil).toBeNull();
        expect(JSON.stringify(alicesGroup)).not.toMatch(/mutedUntil":\{/);
        expect((await api(bob).get("/api/conversations").expect(200)).body.conversations[0].mutedUntil).toBeTruthy();
        const alicesChat = (await api(alice).get("/api/conversations").expect(200)).body.conversations[0];
        expect(alicesChat.mutedUntil).toBeNull();
        expect(JSON.stringify(alicesChat)).not.toMatch(/mutedUntil":\{/);
        expect(JSON.stringify((await api(alice).get(`/api/groups/${groupId}`).expect(200)).body)).not.toMatch(/mutedUntil/);
        // Opening the chat again returns the conversation itself: still nothing of bob's mute.
        const reopened = await request(app).post("/api/conversations").set("Cookie", alice.cookie).send({ otherUserId: bob.id }).expect(200);
        expect(JSON.stringify(reopened.body)).not.toMatch(/mutedUntil/);
    });

    it("my other tabs are told", async () => {
        const b = await connectAs(bob);
        await mute(bob, groupId, "8h").expect(200);
        await settle();
        const [event] = b.received.filter((r) => r.event === "muteChanged").map((r) => r.data);
        expect(event).toMatchObject({ conversationId: groupId, mutedUntil: expect.any(String) });
        const a = await connectAs(alice);
        await mute(bob, groupId, null).expect(200);
        await settle();
        expect(a.received.filter((r) => r.event === "muteChanged")).toEqual([]);
    });
});

describe("a group call starting", () => {
    it("members not looking at OpenChat get an urgent 'Goa trip · Alice Rao started a voice call'; muted ones and outsiders don't", async () => {
        await mute(carol, groupId, "8h").expect(200);
        const a = await connectAs(alice);
        const callId = randomUUID();
        expect((await a.timeout(2000).emitWithAck("groupCallJoin", { groupId, callId, media: "audio" })).success).toBe(true);
        await settle();
        const [push] = pushesTo(bob);
        expect(push.payload).toEqual({ title: "Goa trip", body: "Alice Rao started a voice call", url: `/chat/${groupId}`, tag: `groupcall-${callId}`, call: true });
        expect(push.options).toMatchObject({ urgency: "high", TTL: 30 });
        expect(pushesTo(carol)).toHaveLength(0);
        expect(pushesTo(alice)).toHaveLength(0);
        expect(pushesTo(eve)).toHaveLength(0);
    });

    it("muted: no ring in the app either (the call still shows as going on)", async () => {
        await mute(carol, groupId, "always").expect(200);
        const c = await connectAs(carol);
        const a = await connectAs(alice);
        await a.timeout(2000).emitWithAck("groupCallJoin", { groupId, callId: randomUUID(), media: "audio" });
        await settle();
        expect(c.received.filter((r) => r.event === "groupCallRinging")).toEqual([]);
        expect(c.received.some((r) => r.event === "groupCallUpdated" && r.data.active)).toBe(true);
    });

    it("someone with OpenChat on screen rings in the app instead: no push", async () => {
        await connectAs(bob, { visible: true });
        const a = await connectAs(alice);
        await a.timeout(2000).emitWithAck("groupCallJoin", { groupId, callId: randomUUID(), media: "video" });
        await settle();
        expect(pushesTo(bob)).toHaveLength(0);
        expect(pushesTo(carol)[0].payload.body).toBe("Alice Rao started a video call");
    });
});
