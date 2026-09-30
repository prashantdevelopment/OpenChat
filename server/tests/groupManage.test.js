import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { createServer } from "http";
import mongoose from "mongoose";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import Conversation from "../src/models/conversation.model.js";
import GroupInvite from "../src/models/groupInvite.model.js";
import GroupKeyEpoch from "../src/models/groupKeyEpoch.model.js";
import Message from "../src/models/message.model.js";
import { connectTestDb, disconnectTestDb, lockedKeys, registerAndLogin } from "./helpers.js";

// Group management (step 70). alice is the admin; bob and carol are members;
// dave chats with bob only; eve is an outsider.
let io, url, alice, bob, carol, dave, eve, groupId;
const openSockets = [];

const api = (user) => ({
    get: (path) => request(app).get(path).set("Cookie", user.cookie),
    post: (path, body) => request(app).post(path).set("Cookie", user.cookie).send(body),
    del: (path) => request(app).delete(path).set("Cookie", user.cookie),
    patch: (path, body) => request(app).patch(path).set("Cookie", user.cookie).send(body),
});
const chatWithMessage = async (a, b) => {
    const { conversation } = (await api(a).post("/api/conversations", { otherUserId: b.id }).expect(200)).body;
    await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageAt: new Date() } });
};
const acceptInvite = async (user) => {
    const [invite] = (await api(user).get("/api/group-invites").expect(200)).body.invites;
    await api(user).post(`/api/group-invites/${invite._id}/accept`).expect(200);
};
const info = async (user) => (await api(user).get(`/api/groups/${groupId}`).expect(200)).body.group;
const lines = async (user) => (await api(user).get(`/api/conversations/${groupId}/messages`).expect(200)).body.messages.filter((m) => m.messageType === "system").map((m) => m.system);
const connectAs = (user) => new Promise((resolve, reject) => {
    const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false });
    openSockets.push(socket);
    socket.received = [];
    socket.onAny((event, data) => socket.received.push({ event, data }));
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
});
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 50 });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    [alice, bob, carol, dave, eve] = await Promise.all(["alice_gm", "bob_gm", "carol_gm", "dave_gm", "eve_gm"].map(registerAndLogin));
    await chatWithMessage(alice, bob);
    await chatWithMessage(alice, carol);
    await chatWithMessage(bob, dave);
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

describe("renaming", () => {
    it("an admin renames: same name rules, a line in the chat, members told live", async () => {
        const b = await connectAs(bob);
        const res = await api(alice).patch(`/api/groups/${groupId}`, { name: "  Goa   2026 " }).expect(200);
        expect(res.body.group.name).toBe("Goa 2026");
        expect((await lines(bob)).at(-1)).toMatchObject({ kind: "renamed", name: "Goa 2026", user: { username: "alice_gm" } });
        await settle();
        expect(b.received.some((r) => r.event === "groupsChanged")).toBe(true);
        expect((await api(alice).patch(`/api/groups/${groupId}`, { name: "!!!" }).expect(400)).body.errors.name).toMatch(/letter or a number/);
        expect((await api(alice).patch(`/api/groups/${groupId}`, { name: "x".repeat(51) }).expect(400)).body.errors.name).toMatch(/50/);
        await api(alice).patch(`/api/groups/${groupId}`, { name: { $ne: "" } }).expect(400);
        await api(alice).patch(`/api/groups/${groupId}`, {}).expect(400);
        expect((await info(bob)).name).toBe("Goa 2026");
    });

    it("members who aren't admins, and outsiders, can't", async () => {
        expect((await api(bob).patch(`/api/groups/${groupId}`, { name: "Bob's trip" }).expect(403)).body.message).toMatch(/Only admins/);
        await api(eve).patch(`/api/groups/${groupId}`, { name: "Eve's trip" }).expect(404);
        expect((await info(alice)).name).toBe("Goa trip");
    });
});

describe("who may invite", () => {
    it("an admin lets all members invite: then bob invites dave (his chat); only true or false; only admins switch it", async () => {
        const invite = () => api(bob).post(`/api/groups/${groupId}/invites`, { userIds: [dave.id], keys: lockedKeys([dave.id]), epoch: 1 });
        await invite().expect(403);
        await api(bob).patch(`/api/groups/${groupId}`, { membersCanInvite: true }).expect(403);
        await api(alice).patch(`/api/groups/${groupId}`, { membersCanInvite: "yes" }).expect(400);
        expect((await api(alice).patch(`/api/groups/${groupId}`, { membersCanInvite: true }).expect(200)).body.group.membersCanInvite).toBe(true);
        await invite().expect(201);
        expect((await lines(alice)).map((l) => l.kind)).not.toContain("renamed");
    });
});

describe("admins", () => {
    it("an admin makes bob an admin: a line in the chat; then bob can remove people and rename", async () => {
        await api(alice).post(`/api/groups/${groupId}/admins/${bob.id}`).expect(200);
        expect((await info(carol)).admins.sort()).toEqual([alice.id, bob.id].sort());
        expect((await lines(carol)).at(-1)).toMatchObject({ kind: "admin", user: { username: "bob_gm" }, by: { username: "alice_gm" } });
        await api(bob).patch(`/api/groups/${groupId}`, { name: "Goa trip!" }).expect(200);
        await api(bob).del(`/api/groups/${groupId}/members/${carol.id}`).expect(200);
    });

    it("only admins; only members; not twice", async () => {
        expect((await api(bob).post(`/api/groups/${groupId}/admins/${carol.id}`).expect(403)).body.message).toMatch(/Only admins/);
        await api(eve).post(`/api/groups/${groupId}/admins/${eve.id}`).expect(404);
        await api(alice).post(`/api/groups/${groupId}/admins/${eve.id}`).expect(404);
        await api(alice).post(`/api/groups/${groupId}/admins/nope`).expect(400);
        await api(alice).post(`/api/groups/${groupId}/admins/${alice.id}`).expect(409);
        expect((await info(alice)).admins).toEqual([alice.id]);
    });
});
