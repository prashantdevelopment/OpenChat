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
import Upload from "../src/models/upload.model.js";
import User from "../src/models/user.model.js";
import storage from "../src/storage/index.js";
import { connectTestDb, disconnectTestDb, encrypted, lockedKeys, readText, registerAndLogin } from "./helpers.js";

// "Delete for everyone" on the server (step 76). 1:1: alice and bob, eve is
// an outsider. Group: alice, bob and carol.
let io, url, alice, bob, carol, eve, chatId, groupId;
const openSockets = [];

const api = (user) => ({
    get: (path) => request(app).get(path).set("Cookie", user.cookie),
    post: (path, body) => request(app).post(path).set("Cookie", user.cookie).send(body),
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
const send = async (socket, conversationId, text, extra = {}) => {
    const reply = await emit(socket, "sendMessage", { conversationId, clientId: randomUUID(), ...encrypted(text), ...extra });
    expect(reply.success).toBe(true);
    return reply.message;
};
const remove = (socket, conversationId, messageId) => emit(socket, "deleteMessage", { conversationId, messageId });
const history = async (user, conversationId) => (await api(user).get(`/api/conversations/${conversationId}/messages`).expect(200)).body.messages;
const minutesAgo = (messageId, minutes) =>
    Message.collection.updateOne({ _id: new mongoose.Types.ObjectId(messageId) }, { $set: { createdAt: new Date(Date.now() - minutes * 60 * 1000) } });

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 50 });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    [alice, bob, carol, eve] = await Promise.all(["alice_dm", "bob_dm", "carol_dm", "eve_dm"].map(registerAndLogin));
});
afterAll(async () => {
    io.close();
    await disconnectTestDb();
});
beforeEach(async () => {
    await Promise.all([Conversation.deleteMany({}), GroupInvite.deleteMany({}), GroupKeyEpoch.deleteMany({}), Message.deleteMany({}), Upload.deleteMany({})]);
    await User.updateMany({}, { $unset: { readReceipts: "" } });
    chatId = (await api(alice).post("/api/conversations", { otherUserId: bob.id }).expect(200)).body.conversation._id;
});
afterEach(() => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
});

describe("delete for everyone: 1:1", () => {
    it("alice deletes her unread message: it is gone from the database and history; both sides are told, with the previous message as the preview and bob's unread count", async () => {
        const [a, b] = [await connectAs(alice), await connectAs(bob)];
        await send(a, chatId, "first");
        const second = await send(a, chatId, "oops");
        expect(await remove(a, chatId, second._id)).toEqual({ success: true });
        await settle();

        expect(await Message.exists({ _id: second._id })).toBeNull();
        expect((await history(bob, chatId)).map(readText)).toEqual(["first"]);
        for (const [socket, unread] of [[a, 0], [b, 1]]) {
            const [event] = eventsOf(socket, "messageDeleted");
            expect(event).toMatchObject({ conversationId: chatId, messageId: second._id, unreadCount: unread, lastMessage: { sender: alice.id } });
            expect(readText(event.lastMessage)).toBe("first");
        }
        const stored = await Conversation.findById(chatId);
        expect(readText(stored.lastMessage)).toBe("first");
    });

    it("the only message: the chat has no preview any more (as before the first message)", async () => {
        const a = await connectAs(alice);
        const only = await send(a, chatId, "hello?");
        expect((await remove(a, chatId, only._id)).success).toBe(true);
        const stored = await Conversation.findById(chatId);
        expect(stored.lastMessage).toBeNull();
        expect(stored.lastMessageAt).toBeNull();
    });

    it("an older message: the preview stays on the newest one", async () => {
        const a = await connectAs(alice);
        const older = await send(a, chatId, "older");
        await send(a, chatId, "newest");
        expect((await remove(a, chatId, older._id)).success).toBe(true);
        expect(readText((await Conversation.findById(chatId)).lastMessage)).toBe("newest");
    });

    it("only the sender: bob can't delete alice's message", async () => {
        const [a, b] = [await connectAs(alice), await connectAs(bob)];
        const message = await send(a, chatId, "mine");
        expect(await remove(b, chatId, message._id)).toMatchObject({ success: false, reason: "notYours" });
        expect(await Message.exists({ _id: message._id })).not.toBeNull();
    });

    it("only within 15 minutes", async () => {
        const a = await connectAs(alice);
        const recent = await send(a, chatId, "14 minutes ago");
        const old = await send(a, chatId, "16 minutes ago");
        await minutesAgo(recent._id, 14);
        await minutesAgo(old._id, 16);
        expect(await remove(a, chatId, old._id)).toMatchObject({ success: false, reason: "tooLate" });
        expect((await remove(a, chatId, recent._id)).success).toBe(true);
    });

    it("not once bob has read it", async () => {
        const [a, b] = [await connectAs(alice), await connectAs(bob)];
        const message = await send(a, chatId, "read me");
        await emit(b, "markRead", chatId);
        expect(await remove(a, chatId, message._id)).toMatchObject({ success: false, reason: "seen" });
        // A message after bob read the chat is unread again: it can go.
        await settle(20);
        const later = await send(a, chatId, "after");
        expect((await remove(a, chatId, later._id)).success).toBe(true);
    });

    it("read receipts off: bob's read isn't shown to alice, so it doesn't stop her either (a delete can't tell her he read it)", async () => {
        const [a, b] = [await connectAs(alice), await connectAs(bob)];
        await api(bob).patch("/api/users/me", { readReceipts: false }).expect(200);
        const message = await send(a, chatId, "read me");
        await emit(b, "markRead", chatId);
        expect((await remove(a, chatId, message._id)).success).toBe(true);
    });

    it("a photo: the message, its upload record and the file in storage are all removed; bob can't download it any more", async () => {
        const a = await connectAs(alice);
        const bytes = randomBytes(2048);
        const { fileId } = (await request(app).post(`/api/conversations/${chatId}/uploads`).query({ kind: "image" }).set("Cookie", alice.cookie).set("Content-Type", "application/octet-stream").send(bytes).expect(201)).body;
        const message = await send(a, chatId, "photo details", { messageType: "image", attachment: { fileId } });
        expect(Buffer.compare(await storage.read(fileId), bytes)).toBe(0);

        expect((await remove(a, chatId, message._id)).success).toBe(true);
        expect(await Upload.exists({ _id: fileId })).toBeNull();
        await expect(storage.read(fileId)).rejects.toThrow();
        await api(bob).get(`/api/uploads/${fileId}`).expect(404);
    });

    it("call records stay", async () => {
        const a = await connectAs(alice);
        const call = await send(a, chatId, "voice call, 0:42", { messageType: "call" });
        expect(await remove(a, chatId, call._id)).toMatchObject({ success: false, reason: "notAllowed" });
    });

    it("twice (another tab, a retry): the second one finds nothing", async () => {
        const a = await connectAs(alice);
        const message = await send(a, chatId, "once");
        expect((await remove(a, chatId, message._id)).success).toBe(true);
        expect(await remove(a, chatId, message._id)).toMatchObject({ success: false, message: "Message not found" });
    });

    it("outsiders learn nothing and hear nothing; bad ids are refused", async () => {
        const [a, e] = [await connectAs(alice), await connectAs(eve)];
        const message = await send(a, chatId, "private");
        expect(await remove(e, chatId, message._id)).toMatchObject({ success: false, message: "User is not a participant in this conversation" });
        expect(await remove(e, chatId, new mongoose.Types.ObjectId().toString())).toMatchObject({ success: false, message: "User is not a participant in this conversation" });
        expect(await remove(a, chatId, "not-an-id")).toMatchObject({ success: false, message: "Invalid message id" });
        expect(await remove(a, chatId, new mongoose.Types.ObjectId().toString())).toMatchObject({ success: false, message: "Message not found" });
        // A message of another chat can't be deleted through this one.
        const otherChat = (await api(alice).post("/api/conversations", { otherUserId: eve.id }).expect(200)).body.conversation._id;
        const elsewhere = await send(a, otherChat, "to eve");
        expect(await remove(a, chatId, elsewhere._id)).toMatchObject({ success: false, message: "Message not found" });

        expect((await remove(a, chatId, message._id)).success).toBe(true);
        await settle();
        expect(eventsOf(e, "messageDeleted").filter((d) => d.conversationId === chatId)).toEqual([]);
    });
});

describe("delete for everyone: groups", () => {
    beforeEach(async () => {
        // Only people alice has chatted with can be invited.
        for (const other of [bob, carol]) {
            const { conversation } = (await api(alice).post("/api/conversations", { otherUserId: other.id }).expect(200)).body;
            await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageAt: new Date() } });
        }
        groupId = new mongoose.Types.ObjectId().toString();
        await api(alice).post("/api/groups", { groupId, name: "Goa trip", userIds: [bob.id, carol.id], keys: lockedKeys([alice.id, bob.id, carol.id]) }).expect(201);
        for (const user of [bob, carol]) {
            const [invite] = (await api(user).get("/api/group-invites").expect(200)).body.invites;
            await api(user).post(`/api/group-invites/${invite._id}/accept`).expect(200);
        }
    });

    it("read by some members: it can still go; every member is told, carol's unread count drops", async () => {
        const [a, b, c] = [await connectAs(alice), await connectAs(bob), await connectAs(carol)];
        const message = await send(a, groupId, "hi all", { epoch: 1 });
        await emit(b, "markRead", groupId);
        expect((await remove(a, groupId, message._id)).success).toBe(true);
        await settle();
        for (const socket of [a, b, c]) expect(eventsOf(socket, "messageDeleted").at(-1)).toMatchObject({ conversationId: groupId, messageId: message._id, lastMessage: null, unreadCount: 0 });
        expect(await Message.exists({ _id: message._id })).toBeNull();
    });

    it("read by everyone: it stays", async () => {
        const [a, b, c] = [await connectAs(alice), await connectAs(bob), await connectAs(carol)];
        const message = await send(a, groupId, "hi all", { epoch: 1 });
        await emit(b, "markRead", groupId);
        await emit(c, "markRead", groupId);
        expect(await remove(a, groupId, message._id)).toMatchObject({ success: false, reason: "seen" });
    });

    it("members can't delete each other's messages, and 'joined' lines stay", async () => {
        const [a, b] = [await connectAs(alice), await connectAs(bob)];
        const message = await send(a, groupId, "alice's", { epoch: 1 });
        expect(await remove(b, groupId, message._id)).toMatchObject({ success: false, reason: "notYours" });
        const joined = await Message.findOne({ conversationId: groupId, messageType: "system", sender: bob.id });
        expect(await remove(b, groupId, joined._id.toString())).toMatchObject({ success: false, reason: "notAllowed" });
    });

    it("the preview goes back to the previous message, with its key epoch", async () => {
        const [a, b] = [await connectAs(alice), await connectAs(bob)];
        await send(b, groupId, "bob first", { epoch: 1 });
        const last = await send(a, groupId, "alice last", { epoch: 1 });
        expect((await remove(a, groupId, last._id)).success).toBe(true);
        await settle();
        const event = eventsOf(b, "messageDeleted").at(-1);
        expect(event.lastMessage).toMatchObject({ sender: bob.id, epoch: 1 });
        expect(readText(event.lastMessage)).toBe("bob first");
    });
});
