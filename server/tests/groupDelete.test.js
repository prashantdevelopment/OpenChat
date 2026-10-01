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
import storage from "../src/storage/index.js";
import { removeOrphanUploads } from "../src/services/upload.service.js";
import { connectTestDb, disconnectTestDb, encrypted, lockedKeys, registerAndLogin } from "./helpers.js";

// Clean deletes (step 78): an admin deletes a group, or its last member
// leaves: nothing of it is left in any collection or in storage. Uploads no
// message uses are removed after a day. alice (admin), bob and carol are
// members; dave has an open invite; eve is an outsider.
let io, url, alice, bob, carol, dave, eve, groupId;
const openSockets = [];

const api = (user) => ({
    get: (path) => request(app).get(path).set("Cookie", user.cookie),
    post: (path, body) => request(app).post(path).set("Cookie", user.cookie).send(body),
    del: (path) => request(app).delete(path).set("Cookie", user.cookie),
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
const uploadFile = async (user, conversationId) =>
    (await request(app).post(`/api/conversations/${conversationId}/uploads`).query({ kind: "image" }).set("Cookie", user.cookie).set("Content-Type", "application/octet-stream").send(randomBytes(1024)).expect(201)).body.fileId;
const sendPhoto = async (socket, user, conversationId, extra = {}) => {
    const fileId = await uploadFile(user, conversationId);
    const reply = await emit(socket, "sendMessage", { conversationId, clientId: randomUUID(), ...encrypted("photo"), messageType: "image", attachment: { fileId }, ...extra });
    expect(reply.success).toBe(true);
    return fileId;
};
const acceptInvite = async (user) => {
    const [invite] = (await api(user).get("/api/group-invites").expect(200)).body.invites;
    await api(user).post(`/api/group-invites/${invite._id}/accept`).expect(200);
};
const inStorage = (fileId) => storage.read(fileId).then(() => true, () => false);
// Everything that could still hold something of the group.
const leftovers = async (id, fileIds) => ({
    group: await Conversation.countDocuments({ _id: id }),
    messages: await Message.countDocuments({ conversationId: id }),
    epochs: await GroupKeyEpoch.countDocuments({ group: id }),
    invites: await GroupInvite.countDocuments({ group: id }),
    uploads: await Upload.countDocuments({ conversationId: id }),
    files: (await Promise.all(fileIds.map(inStorage))).filter(Boolean).length,
});
const NOTHING = { group: 0, messages: 0, epochs: 0, invites: 0, uploads: 0, files: 0 };

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 50 });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    [alice, bob, carol, dave, eve] = await Promise.all(["alice_gd", "bob_gd", "carol_gd", "dave_gd", "eve_gd"].map(registerAndLogin));
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
    await Promise.all([GroupInvite.deleteMany({}), Conversation.deleteMany({ type: "group" }), GroupKeyEpoch.deleteMany({}), Message.deleteMany({}), Upload.deleteMany({})]);
    groupId = new mongoose.Types.ObjectId().toString();
    await api(alice).post("/api/groups", { groupId, name: "Goa trip", userIds: [bob.id, carol.id, dave.id], keys: lockedKeys([alice.id, bob.id, carol.id, dave.id]) }).expect(201);
    await acceptInvite(bob);
    await acceptInvite(carol);
});
afterEach(() => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
});

describe("an admin deletes a group", () => {
    it("everything of it goes: the group, messages, key epochs, invites, upload records and the files in storage", async () => {
        const [a, b] = [await connectAs(alice), await connectAs(bob)];
        const files = [await sendPhoto(a, alice, groupId, { epoch: 1 }), await sendPhoto(b, bob, groupId, { epoch: 1 })];
        await emit(a, "sendMessage", { conversationId: groupId, clientId: randomUUID(), ...encrypted("see you"), epoch: 1 });
        // A file uploaded but never sent goes too.
        files.push(await uploadFile(carol, groupId));
        expect(await leftovers(groupId, files)).toMatchObject({ group: 1, uploads: 3, files: 3 });

        await api(alice).del(`/api/groups/${groupId}`).expect(200);
        expect(await leftovers(groupId, files)).toEqual(NOTHING);
    });

    it("members are told at once (who deleted it), their open chats leave its room; dave's invite disappears; eve hears nothing", async () => {
        const [a, b, c, d, e] = await Promise.all([alice, bob, carol, dave, eve].map(connectAs));
        await Promise.all([a, b, c].map((socket) => emit(socket, "joinConversation", groupId)));
        await api(alice).del(`/api/groups/${groupId}`).expect(200);
        await settle();
        for (const socket of [a, b, c]) expect(eventsOf(socket, "groupDeleted")).toEqual([{ groupId, name: "Goa trip", byId: alice.id }]);
        expect(eventsOf(d, "groupInvitesChanged").length).toBeGreaterThan(0);
        expect(eventsOf(e, "groupDeleted")).toEqual([]);
        // Out of the room, and nothing can be sent or read any more.
        expect((await emit(b, "sendMessage", { conversationId: groupId, clientId: randomUUID(), ...encrypted("hello?"), epoch: 1 })).success).toBe(false);
        await api(bob).get(`/api/conversations/${groupId}/messages`).expect(404);
        expect((await api(dave).get("/api/group-invites").expect(200)).body.invites).toEqual([]);
        expect((await api(bob).get("/api/groups").expect(200)).body.groups).toEqual([]);
    });

    it("a group call in it ends for everyone in it", async () => {
        const [b, c] = [await connectAs(bob), await connectAs(carol)];
        expect((await emit(b, "groupCallJoin", { groupId, callId: randomUUID(), media: "audio" })).success).toBe(true);
        expect((await emit(c, "groupCallJoin", { groupId, callId: randomUUID(), media: "audio" })).success).toBe(true);
        await api(alice).del(`/api/groups/${groupId}`).expect(200);
        await settle();
        expect(eventsOf(b, "groupCallUpdated").at(-1)).toMatchObject({ groupId, active: false });
        expect(eventsOf(c, "groupCallUpdated").at(-1)).toMatchObject({ groupId, active: false });
    });

    it("only admins: a member gets 403, an outsider 404 (the group stays)", async () => {
        await api(bob).del(`/api/groups/${groupId}`).expect(403);
        await api(eve).del(`/api/groups/${groupId}`).expect(404);
        await api(eve).del("/api/groups/not-an-id").expect(400);
        expect(await Conversation.countDocuments({ _id: groupId })).toBe(1);
    });

    it("a second admin can delete it too", async () => {
        await api(alice).post(`/api/groups/${groupId}/admins/${bob.id}`).expect(200);
        await api(bob).del(`/api/groups/${groupId}`).expect(200);
        expect(await Conversation.countDocuments({ _id: groupId })).toBe(0);
    });
});

describe("the last member leaves", () => {
    it("the group ends the same way: nothing left, files removed from storage too", async () => {
        const b = await connectAs(bob);
        const files = [await sendPhoto(b, bob, groupId, { epoch: 1 })];
        await api(bob).post(`/api/groups/${groupId}/leave`).expect(200);
        await api(carol).post(`/api/groups/${groupId}/leave`).expect(200);
        // A new key isn't needed any more: alice is alone, then leaves too.
        expect(await Upload.countDocuments({ conversationId: groupId })).toBe(1);
        const a = await connectAs(alice);
        await api(alice).post(`/api/groups/${groupId}/leave`).expect(200);
        await settle();
        expect(await leftovers(groupId, files)).toEqual(NOTHING);
        expect(eventsOf(a, "groupDeleted")).toEqual([{ groupId, name: "Goa trip", byId: null }]);
    });
});

describe("uploads no message uses", () => {
    const age = (fileId, hours) => Upload.collection.updateOne({ _id: fileId }, { $set: { createdAt: new Date(Date.now() - hours * 60 * 60 * 1000) } });

    it("are removed after a day (record and file); used ones and newer ones stay", async () => {
        const b = await connectAs(bob);
        const used = await sendPhoto(b, bob, groupId, { epoch: 1 });
        const unusedOld = await uploadFile(bob, groupId);
        const unusedNew = await uploadFile(bob, groupId);
        await age(used, 48);
        await age(unusedOld, 25);
        await age(unusedNew, 23);

        expect(await removeOrphanUploads()).toBe(1);
        expect(await Upload.exists({ _id: unusedOld })).toBeNull();
        expect(await inStorage(unusedOld)).toBe(false);
        for (const kept of [used, unusedNew]) {
            expect(await Upload.exists({ _id: kept })).not.toBeNull();
            expect(await inStorage(kept)).toBe(true);
        }
    });

    it("also a file left behind by a chat that is gone (its removal failed earlier)", async () => {
        const fileId = await uploadFile(bob, groupId);
        await Promise.all([Conversation.deleteOne({ _id: groupId }), Message.deleteMany({ conversationId: groupId })]);
        await age(fileId, 30);
        expect(await removeOrphanUploads()).toBe(1);
        expect(await inStorage(fileId)).toBe(false);
    });
});
