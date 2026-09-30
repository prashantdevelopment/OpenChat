import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { createServer } from "http";
import { randomBytes, randomUUID } from "crypto";
import mongoose from "mongoose";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import Conversation from "../src/models/conversation.model.js";
import GroupInvite from "../src/models/groupInvite.model.js";
import GroupKeyEpoch from "../src/models/groupKeyEpoch.model.js";
import Message from "../src/models/message.model.js";
import { connectTestDb, disconnectTestDb, encrypted, lockedKeys, registerAndLogin } from "./helpers.js";

// Group chat on the server (step 69). alice, bob and carol are members; dave
// joins later; eve is an outsider.
let io, url, alice, bob, carol, dave, eve, groupId;
const openSockets = [];

const api = (user) => ({
    get: (path) => request(app).get(path).set("Cookie", user.cookie),
    post: (path, body) => request(app).post(path).set("Cookie", user.cookie).send(body),
    del: (path) => request(app).delete(path).set("Cookie", user.cookie),
    patch: (path, body) => request(app).patch(path).set("Cookie", user.cookie).send(body),
});
const connectAs = (user) => new Promise((resolve, reject) => {
    const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false });
    openSockets.push(socket);
    socket.received = [];
    socket.onAny((event, data) => socket.received.push({ event, data }));
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
});
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const eventsOf = (socket, name) => socket.received.filter((r) => r.event === name).map((r) => r.data);
const emit = (socket, event, data) => socket.timeout(2000).emitWithAck(event, data);
const join = (socket) => emit(socket, "joinConversation", groupId);
const send = (socket, text, epoch = 1) => emit(socket, "sendMessage", { conversationId: groupId, clientId: randomUUID(), ...encrypted(text), epoch });
const history = async (user) => (await api(user).get(`/api/conversations/${groupId}/messages`).expect(200)).body.messages;
const acceptInvite = async (user) => {
    const [invite] = (await api(user).get("/api/group-invites").expect(200)).body.invites;
    await api(user).post(`/api/group-invites/${invite._id}/accept`).expect(200);
};
const myGroup = async (user) => (await api(user).get("/api/groups").expect(200)).body.groups.find((g) => g._id === groupId);

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 50 });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    [alice, bob, carol, dave, eve] = await Promise.all(["alice_gc", "bob_gc", "carol_gc", "dave_gc", "eve_gc"].map(registerAndLogin));
    for (const other of [bob, carol, dave]) {
        const { conversation } = (await api(alice).post("/api/conversations", { otherUserId: other.id }).expect(200)).body;
        await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageAt: new Date() } });
    }
});
afterAll(async () => {
    io.close();
    await disconnectTestDb();
});
beforeEach(async () => {
    await Promise.all([GroupInvite.deleteMany({}), Conversation.deleteMany({ type: "group" }), GroupKeyEpoch.deleteMany({}), Message.deleteMany({})]);
    groupId = new mongoose.Types.ObjectId().toString();
    await api(alice).post("/api/groups", { groupId, name: "Goa trip", userIds: [bob.id, carol.id], keys: lockedKeys([alice.id, bob.id, carol.id]) }).expect(201);
    await acceptInvite(bob);
    await acceptInvite(carol);
});
afterEach(() => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
});

describe("sending in a group", () => {
    it("a member's message reaches everyone in the chat, with its key epoch; every member's list updates, with their own unread count", async () => {
        const [a, b, c, e] = [await connectAs(alice), await connectAs(bob), await connectAs(carol), await connectAs(eve)];
        await Promise.all([join(a), join(b), join(c)]);
        const sent = await send(a, "namaste");
        expect(sent.success).toBe(true);
        expect(sent.message.epoch).toBe(1);
        await settle();
        for (const socket of [b, c]) expect(eventsOf(socket, "newMessage").some((m) => m._id === sent.message._id && m.epoch === 1)).toBe(true);
        const updates = (socket) => eventsOf(socket, "conversationUpdated").filter((u) => u._id === groupId);
        expect(updates(b).at(-1)).toMatchObject({ lastMessage: { epoch: 1, sender: alice.id }, unreadCount: 1 });
        expect(updates(a).at(-1).unreadCount).toBe(0);
        expect(e.received.filter((r) => r.event === "newMessage" || r.event === "conversationUpdated")).toEqual([]);
    });

    it("only with the latest key: a wrong epoch is refused ('epoch'); after someone leaves, nothing until a new key ('rotate')", async () => {
        const b = await connectAs(bob);
        expect(await send(b, "old key", 2)).toMatchObject({ success: false, reason: "epoch" });
        await api(carol).post(`/api/groups/${groupId}/leave`).expect(200);
        expect(await send(b, "carol still has this key", 1)).toMatchObject({ success: false, reason: "rotate" });
        await api(bob).post(`/api/groups/${groupId}/keys`, { epoch: 2, keys: lockedKeys([alice.id, bob.id]) }).expect(201);
        expect(await send(b, "old key", 1)).toMatchObject({ success: false, reason: "epoch" });
        expect((await send(b, "new key", 2)).success).toBe(true);
    });

    it("outsiders can't send, read, join its room or type in it", async () => {
        const e = await connectAs(eve);
        expect((await send(e, "hi")).success).toBe(false);
        expect((await join(e)).success).toBe(false);
        await api(eve).get(`/api/conversations/${groupId}/messages`).expect(403);
        const b = await connectAs(bob);
        await join(b);
        e.emit("typing", { conversationId: groupId, isTyping: true });
        await settle();
        expect(eventsOf(b, "typing")).toEqual([]);
    });

    it("members see who is typing", async () => {
        const [a, b] = [await connectAs(alice), await connectAs(bob)];
        await Promise.all([join(a), join(b)]);
        b.emit("typing", { conversationId: groupId, isTyping: true });
        await settle();
        expect(eventsOf(a, "typing")).toEqual([{ conversationId: groupId, userId: bob.id, isTyping: true }]);
    });
});

describe("leaving and joining", () => {
    it("carol is removed: her open chat stops getting messages at once, and she can't send or read any more", async () => {
        const [a, c] = [await connectAs(alice), await connectAs(carol)];
        await Promise.all([join(a), join(c)]);
        await api(alice).del(`/api/groups/${groupId}/members/${carol.id}`).expect(200);
        await api(alice).post(`/api/groups/${groupId}/keys`, { epoch: 2, keys: lockedKeys([alice.id, bob.id]) }).expect(201);
        await settle();
        c.received.length = 0;
        expect((await send(a, "after carol", 2)).success).toBe(true);
        await settle();
        expect(eventsOf(c, "newMessage")).toEqual([]);
        expect((await send(c, "still here?", 2)).success).toBe(false);
        await api(carol).get(`/api/conversations/${groupId}/messages`).expect(403);
    });

    it("dave joins later: none of the history from before, and none of it unread", async () => {
        const a = await connectAs(alice);
        await send(a, "before dave");
        await api(alice).post(`/api/groups/${groupId}/invites`, { userIds: [dave.id], keys: lockedKeys([dave.id]), epoch: 1 }).expect(201);
        await settle(20);
        await acceptInvite(dave);
        await send(a, "welcome dave");
        const seen = await history(dave);
        expect(seen.filter((m) => m.messageType !== "system")).toHaveLength(1);
        expect(seen.map((m) => m.system?.kind ?? "text")).toEqual(["joined", "text"]);
        expect((await myGroup(dave)).unreadCount).toBe(1);
        expect((await myGroup(bob)).unreadCount).toBe(2);
    });

    it("the history has lines for created, joined, left and removed (who, and who removed them); never unread, never the preview", async () => {
        await api(carol).post(`/api/groups/${groupId}/leave`).expect(200);
        await api(alice).del(`/api/groups/${groupId}/members/${bob.id}`).expect(200);
        const lines = (await history(alice)).map((m) => [m.system.kind, m.system.user._id, m.system.by?._id ?? null]);
        expect((await history(alice)).at(-1).system).toMatchObject({ user: { username: "bob_gc" }, by: { username: "alice_gc" } });
        expect(lines).toEqual([["created", alice.id, null], ["joined", bob.id, null], ["joined", carol.id, null], ["left", carol.id, null], ["removed", bob.id, alice.id]]);
        const listed = await myGroup(alice);
        expect(listed.unreadCount).toBe(0);
        expect(listed.lastMessage).toBeNull();
    });

    it("a member who joins sees the line live in an open chat", async () => {
        await api(alice).post(`/api/groups/${groupId}/invites`, { userIds: [dave.id], keys: lockedKeys([dave.id]), epoch: 1 }).expect(201);
        const b = await connectAs(bob);
        await join(b);
        await acceptInvite(dave);
        await settle();
        expect(eventsOf(b, "newMessage").map((m) => [m.messageType, m.system?.kind, m.system?.user?._id, m.system?.user?.username])).toEqual([["system", "joined", dave.id, "dave_gc"]]);
        expect(JSON.stringify(eventsOf(b, "newMessage"))).not.toMatch(/email|password/);
    });
});

describe("receipts in a group", () => {
    it("delivered when every other member has it; read when every other member who shares receipts has read it", async () => {
        const [a, b, c] = [await connectAs(alice), await connectAs(bob), await connectAs(carol)];
        await Promise.all([join(a)]);
        await api(carol).patch("/api/users/me", { readReceipts: false }).expect(200);
        try {
            const { message } = await send(a, "who has seen this?");
            const receipts = () => eventsOf(a, "receipt").filter((r) => r.conversationId === groupId).at(-1);
            await emit(b, "markDelivered", groupId);
            await settle();
            // carol's app hasn't got it yet: the time is from before the message (ticks: "sent")
            expect(new Date(receipts().deliveredAt) < new Date(message.createdAt)).toBe(true);
            await emit(c, "markDelivered", groupId);
            await settle();
            expect(new Date(receipts().deliveredAt) >= new Date(message.createdAt)).toBe(true);
            expect(new Date(receipts().readAt) < new Date(message.createdAt)).toBe(true); // not read yet
            await emit(b, "markRead", groupId);
            await settle();
            // carol doesn't share read receipts: bob's read is enough
            expect(new Date(receipts().readAt) >= new Date(message.createdAt)).toBe(true);
            // and carol, who doesn't share them, sees nobody's reads
            expect((await myGroup(carol)).receipts.readAt).toBeNull();
            expect(JSON.stringify(await myGroup(alice))).not.toMatch(/readReceipts|lastReadAt|lastDeliveredAt/);
        } finally {
            await api(carol).patch("/api/users/me", { readReceipts: true }).expect(200);
        }
    });
});

describe("files in a group", () => {
    const encryptedFile = () => randomBytes(64);
    const upload = (user) => request(app).post(`/api/conversations/${groupId}/uploads`).query({ kind: "file" }).set("Cookie", user.cookie).set("Content-Type", "application/octet-stream").send(encryptedFile());

    it("members upload and download; outsiders and removed members can't", async () => {
        const { fileId } = (await upload(bob).expect(201)).body;
        await upload(eve).expect(403);
        await api(carol).get(`/api/uploads/${fileId}`).expect(200);
        await api(eve).get(`/api/uploads/${fileId}`).expect(403);
        await api(alice).del(`/api/groups/${groupId}/members/${carol.id}`).expect(200);
        await api(carol).get(`/api/uploads/${fileId}`).expect(403);
    });
});
