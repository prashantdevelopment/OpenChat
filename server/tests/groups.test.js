import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer } from "http";
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import Conversation from "../src/models/conversation.model.js";
import GroupInvite from "../src/models/groupInvite.model.js";
import { connectTestDb, disconnectTestDb, encrypted, lockedKeys, registerAndLogin } from "./helpers.js";

// alice creates groups; bob and carol join; dave declines; eve is an outsider
// (no chat with anyone); frank chats with alice but no message was ever sent.
let io, url, alice, bob, carol, dave, eve, frank;
const chats = {};

const api = (user) => ({
    get: (path) => request(app).get(path).set("Cookie", user.cookie),
    post: (path, body) => request(app).post(path).set("Cookie", user.cookie).send(body),
    del: (path) => request(app).delete(path).set("Cookie", user.cookie),
});
// A 1:1 chat between two users; `message`: someone wrote in it.
const chat = async (a, b, { message = true } = {}) => {
    const { conversation } = (await api(a).post("/api/conversations", { otherUserId: b.id }).expect(200)).body;
    if (message) await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageAt: new Date() } });
    return conversation._id;
};
const createGroup = (user, body) =>
    api(user).post("/api/groups", { groupId: new mongoose.Types.ObjectId().toString(), keys: lockedKeys([user.id, ...(Array.isArray(body.userIds) ? body.userIds : [])].filter((id) => typeof id === "string")), ...body });
// Invite with their copies of the group's latest key (as a browser does).
const sendInvite = async (user, groupId, userIds, status) => {
    const epoch = (await api(user).get(`/api/groups/${groupId}/keys`)).body.currentEpoch ?? 1;
    return api(user).post(`/api/groups/${groupId}/invites`, { userIds, keys: lockedKeys(userIds), epoch }).expect(status);
};
const invitesOf = async (user) => (await api(user).get("/api/group-invites").expect(200)).body.invites;
const inviteFor = async (user, groupId) => (await invitesOf(user)).find((invite) => String(invite.group._id) === String(groupId));

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 50 });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    [alice, bob, carol, dave, eve, frank] = await Promise.all(["alice_g", "bob_g", "carol_g", "dave_g", "eve_g", "frank_g"].map(registerAndLogin));
    for (const other of [bob, carol, dave]) chats[other.id] = await chat(alice, other);
    await chat(bob, carol);
    await chat(alice, frank, { message: false });
});
afterAll(async () => {
    io.close();
    await disconnectTestDb();
});
beforeEach(async () => {
    await GroupInvite.deleteMany({});
    await Conversation.deleteMany({ type: "group" });
});

describe("creating a group", () => {
    it("the creator is the only member and its admin; the people chosen are invited, not added", async () => {
        const res = await createGroup(alice, { name: "  Goa   trip ", userIds: [bob.id, carol.id] }).expect(201);
        const { group } = res.body;
        expect(group).toMatchObject({ type: "group", name: "Goa trip", admins: [alice.id], createdBy: alice.id, membersCanInvite: false });
        expect(group.members.map((m) => m.username)).toEqual(["alice_g"]);
        expect(group.invites.map((i) => [i.to.username, i.status])).toEqual(expect.arrayContaining([["bob_g", "pending"], ["carol_g", "pending"]]));
        expect(JSON.stringify(res.body)).not.toMatch(/email|password|googleId|lastReadAt/);
    });

    it("a name is required, at most 50 characters, with a letter or number and no hidden characters", async () => {
        expect((await createGroup(alice, { userIds: [bob.id] }).expect(400)).body.errors.name).toMatch(/required/);
        expect((await createGroup(alice, { name: "x".repeat(51), userIds: [bob.id] }).expect(400)).body.errors.name).toMatch(/50/);
        expect((await createGroup(alice, { name: "!!!", userIds: [bob.id] }).expect(400)).body.errors.name).toMatch(/letter or a number/);
        expect((await createGroup(alice, { name: "Goa‮trip", userIds: [bob.id] }).expect(400)).body.errors.name).toMatch(/aren't allowed/);
        expect((await createGroup(alice, { name: { $gt: "" }, userIds: [bob.id] }).expect(400)).body.errors.name).toMatch(/required/);
    });

    it("someone must be invited; ids must be valid", async () => {
        await createGroup(alice, { name: "Solo" }).expect(400);
        await createGroup(alice, { name: "Solo", userIds: [] }).expect(400);
        await createGroup(alice, { name: "Bad", userIds: ["nope"] }).expect(400);
        await createGroup(alice, { name: "Self", userIds: [alice.id] }).expect(400);
        expect(await Conversation.countDocuments({ type: "group" })).toBe(0);
    });

    it("login required", async () => {
        await request(app).post("/api/groups").send({ name: "x", userIds: [bob.id] }).expect(401);
        await request(app).get("/api/groups").expect(401);
        await request(app).get("/api/group-invites").expect(401);
    });
});

describe("who can be invited", () => {
    it("only people you already chat with: not a stranger, not a chat nobody wrote in; then no group is created", async () => {
        expect((await createGroup(alice, { name: "Strangers", userIds: [bob.id, eve.id] }).expect(403)).body.message).toMatch(/already chat with/);
        await createGroup(alice, { name: "Silent", userIds: [frank.id] }).expect(403);
        expect(await Conversation.countDocuments({ type: "group" })).toBe(0);
        expect(await GroupInvite.countDocuments()).toBe(0);
    });

    it("never across a block, either way", async () => {
        await request(app).put(`/api/blocks/${bob.id}`).set("Cookie", alice.cookie).expect(200);
        expect((await createGroup(alice, { name: "Blocked", userIds: [bob.id] }).expect(403)).body.message).toMatch(/can't invite/);
        await request(app).delete(`/api/blocks/${bob.id}`).set("Cookie", alice.cookie).expect(200);
        await request(app).put(`/api/blocks/${alice.id}`).set("Cookie", bob.cookie).expect(200);
        await createGroup(alice, { name: "Blocked", userIds: [bob.id] }).expect(403);
        await request(app).delete(`/api/blocks/${alice.id}`).set("Cookie", bob.cookie).expect(200);
        await createGroup(alice, { name: "Fine again", userIds: [bob.id] }).expect(201);
    });

    it("an unknown user", async () => {
        await createGroup(alice, { name: "Ghost", userIds: [new mongoose.Types.ObjectId().toString()] }).expect(404);
    });
});

describe("answering an invite", () => {
    it("the invitee sees it: group name and size, who invited; nobody else does", async () => {
        const { group } = (await createGroup(alice, { name: "Goa trip", userIds: [bob.id] }).expect(201)).body;
        const invite = await inviteFor(bob, group._id);
        expect(invite).toMatchObject({ group: { name: "Goa trip", memberCount: 1 }, from: { username: "alice_g" } });
        expect(JSON.stringify(invite)).not.toMatch(/email|password/);
        expect(await invitesOf(eve)).toEqual([]);
        expect(await invitesOf(alice)).toEqual([]);
    });

    it("accept: bob becomes a member and sees the group; the outsider can't see it", async () => {
        const { group } = (await createGroup(alice, { name: "Goa trip", userIds: [bob.id, carol.id] }).expect(201)).body;
        const invite = await inviteFor(bob, group._id);
        const joined = (await api(bob).post(`/api/group-invites/${invite._id}/accept`).expect(200)).body.group;
        expect(joined.members.map((m) => m.username).sort()).toEqual(["alice_g", "bob_g"]);
        expect(joined.joinedAt[bob.id]).toBeTruthy();
        expect((await api(bob).get("/api/groups").expect(200)).body.groups.map((g) => g.name)).toEqual(["Goa trip"]);
        await api(bob).get(`/api/groups/${group._id}`).expect(200);
        expect((await api(eve).get(`/api/groups/${group._id}`).expect(404)).body.message).toBe("Group not found");
        expect((await api(eve).get("/api/groups").expect(200)).body.groups).toEqual([]);
        // carol hasn't answered: invited, not a member
        await api(carol).get(`/api/groups/${group._id}`).expect(404);
        expect(await invitesOf(bob)).toEqual([]);
    });

    it("decline: dave isn't added, alice sees 'declined'; the group can't invite him again for a week", async () => {
        const { group } = (await createGroup(alice, { name: "Goa trip", userIds: [dave.id] }).expect(201)).body;
        const invite = await inviteFor(dave, group._id);
        await api(dave).post(`/api/group-invites/${invite._id}/decline`).expect(200);
        const seen = (await api(alice).get(`/api/groups/${group._id}`).expect(200)).body.group;
        expect(seen.members).toHaveLength(1);
        expect(seen.invites.map((i) => [i.to.username, i.status])).toEqual([["dave_g", "declined"]]);
        expect((await sendInvite(alice, group._id, [dave.id], 409)).body.message).toMatch(/declined recently/);
        await GroupInvite.updateOne({ _id: invite._id }, { $set: { respondedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } });
        await sendInvite(alice, group._id, [dave.id], 201);
        // A declined invite can't be accepted afterwards
        expect((await api(dave).post(`/api/group-invites/${invite._id}/accept`).expect(409)).body.message).toMatch(/declined/);
    });

    it("only the invitee can answer; twice doesn't work; bad ids are refused", async () => {
        const { group } = (await createGroup(alice, { name: "Goa trip", userIds: [bob.id] }).expect(201)).body;
        const invite = await inviteFor(bob, group._id);
        await api(eve).post(`/api/group-invites/${invite._id}/accept`).expect(404);
        await api(alice).post(`/api/group-invites/${invite._id}/accept`).expect(404);
        await api(bob).post("/api/group-invites/nope/accept").expect(400);
        const [first, second] = await Promise.all([
            api(bob).post(`/api/group-invites/${invite._id}/accept`),
            api(bob).post(`/api/group-invites/${invite._id}/accept`),
        ]);
        expect([first.status, second.status].sort()).toEqual([200, 409]);
        const stored = await Conversation.findById(group._id);
        expect(stored.participants.map(String).filter((id) => id === bob.id)).toHaveLength(1);
    });

    it("an invite expires after 7 days: can't be accepted, isn't listed, and the person can be invited again", async () => {
        const { group } = (await createGroup(alice, { name: "Goa trip", userIds: [bob.id] }).expect(201)).body;
        const invite = await inviteFor(bob, group._id);
        await GroupInvite.updateOne({ _id: invite._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        expect(await invitesOf(bob)).toEqual([]);
        expect((await api(bob).post(`/api/group-invites/${invite._id}/accept`)).status).toBe(409); // already marked expired by the listing
        await sendInvite(alice, group._id, [bob.id], 201);
        const fresh = await inviteFor(bob, group._id);
        await GroupInvite.updateOne({ _id: fresh._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        expect((await api(bob).post(`/api/group-invites/${fresh._id}/accept`).expect(410)).body.message).toMatch(/expired/);
    });
});

describe("inviting more people and cancelling", () => {
    const groupWithBob = async () => {
        const { group } = (await createGroup(alice, { name: "Goa trip", userIds: [bob.id] }).expect(201)).body;
        await api(bob).post(`/api/group-invites/${(await inviteFor(bob, group._id))._id}/accept`).expect(200);
        return group._id;
    };

    it("admins invite; other members only when the group allows it; outsiders never", async () => {
        const groupId = await groupWithBob();
        expect((await sendInvite(bob, groupId, [carol.id], 403)).body.message).toMatch(/Only admins/);
        await sendInvite(eve, groupId, [carol.id], 404);
        await Conversation.updateOne({ _id: groupId }, { $set: { membersCanInvite: true } });
        await sendInvite(bob, groupId, [carol.id], 201); // bob chats with carol
        expect((await inviteFor(carol, groupId)).from.username).toBe("bob_g");
    });

    it("the member's own chats count, not the admin's (bob can't invite dave, whom only alice chats with)", async () => {
        const groupId = await groupWithBob();
        await Conversation.updateOne({ _id: groupId }, { $set: { membersCanInvite: true } });
        await sendInvite(bob, groupId, [dave.id], 403);
    });

    it("members and people already invited: a member is refused, a second invite changes nothing", async () => {
        const groupId = await groupWithBob();
        await sendInvite(alice, groupId, [bob.id], 400);
        expect((await sendInvite(alice, groupId, [carol.id], 201)).body.invited).toBe(1);
        expect((await sendInvite(alice, groupId, [carol.id], 201)).body.invited).toBe(0);
        expect(await GroupInvite.countDocuments({ group: groupId, to: carol.id })).toBe(1);
    });

    it("the inviter or an admin cancels a pending invite; it can't be accepted then; others can't cancel", async () => {
        const groupId = await groupWithBob();
        await Conversation.updateOne({ _id: groupId }, { $set: { membersCanInvite: true } });
        await sendInvite(bob, groupId, [carol.id], 201);
        const invite = await inviteFor(carol, groupId);
        await api(eve).del(`/api/group-invites/${invite._id}`).expect(404);
        await api(carol).del(`/api/group-invites/${invite._id}`).expect(404);
        // bob (a member, not an admin) can't take back an invite someone else sent
        await sendInvite(alice, groupId, [dave.id], 201);
        await api(bob).del(`/api/group-invites/${(await inviteFor(dave, groupId))._id}`).expect(404);
        await api(alice).del(`/api/group-invites/${invite._id}`).expect(200); // admin, not the inviter
        expect((await api(carol).post(`/api/group-invites/${invite._id}/accept`).expect(409)).body.message).toMatch(/cancelled/);
        await api(alice).del(`/api/group-invites/${invite._id}`).expect(409);
    });

    it("a member who isn't admin sees only the invites they sent", async () => {
        const groupId = await groupWithBob();
        await sendInvite(alice, groupId, [carol.id], 201);
        expect((await api(bob).get(`/api/groups/${groupId}`).expect(200)).body.group.invites).toEqual([]);
        expect((await api(alice).get(`/api/groups/${groupId}`).expect(200)).body.group.invites).toHaveLength(1);
    });
});

describe("limits", () => {
    const fillGroup = async (groupId, members) => {
        const fake = Array.from({ length: members }, () => new mongoose.Types.ObjectId());
        await Conversation.updateOne({ _id: groupId }, { $push: { participants: { $each: fake } } });
    };

    it("at most 50 members, pending invites included", async () => {
        const { group } = (await createGroup(alice, { name: "Big", userIds: [bob.id] }).expect(201)).body;
        await fillGroup(group._id, 47); // alice + 47 + bob invited = 49
        await sendInvite(alice, group._id, [carol.id, dave.id], 400);
        await sendInvite(alice, group._id, [carol.id], 201); // 50
        await sendInvite(alice, group._id, [dave.id], 400);
        await createGroup(alice, { name: "Too big", userIds: Array.from({ length: 50 }, () => new mongoose.Types.ObjectId().toString()) }).expect(400);
    });

    it("accepting into a full group fails, and the invite stays open", async () => {
        const { group } = (await createGroup(alice, { name: "Full", userIds: [bob.id] }).expect(201)).body;
        await fillGroup(group._id, 49); // 50 members now
        const invite = await inviteFor(bob, group._id);
        expect((await api(bob).post(`/api/group-invites/${invite._id}/accept`).expect(409)).body.message).toMatch(/full/);
        expect((await GroupInvite.findById(invite._id)).status).toBe("pending");
        expect((await Conversation.findById(group._id)).participants).toHaveLength(50);
    });

    it("at most 100 invites sent per day", async () => {
        const { group } = (await createGroup(alice, { name: "Busy", userIds: [bob.id] }).expect(201)).body;
        const other = new mongoose.Types.ObjectId();
        await GroupInvite.insertMany(Array.from({ length: 99 }, () => ({ group: other, from: alice.id, to: new mongoose.Types.ObjectId() })));
        expect((await sendInvite(alice, group._id, [carol.id], 429)).body.message).toMatch(/too many invites/);
    });
});

describe("groups and the 1:1 paths", () => {
    const connectAs = (user) => new Promise((resolve, reject) => {
        const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false });
        socket.on("connect", () => resolve(socket));
        socket.on("connect_error", reject);
    });

    it("not in the 1:1 chat list and no calls; messages only with the group key's epoch; outsiders nothing", async () => {
        const { group } = (await createGroup(alice, { name: "Goa trip", userIds: [bob.id] }).expect(201)).body;
        const list = (await api(alice).get("/api/conversations").expect(200)).body.conversations;
        expect(list.map((c) => c._id)).not.toContain(group._id);
        await api(alice).get(`/api/conversations/${group._id}/messages`).expect(200);
        await api(eve).get(`/api/conversations/${group._id}/messages`).expect(403);
        const socket = await connectAs(alice);
        try {
            const sent = await socket.timeout(2000).emitWithAck("sendMessage", { conversationId: group._id, clientId: randomUUID(), ...encrypted("hi") });
            expect([sent.success, sent.reason]).toEqual([false, "epoch"]);
            const called = await socket.timeout(2000).emitWithAck("callUser", { conversationId: group._id, callId: randomUUID(), media: "audio", offer: encrypted("sdp") });
            expect(called.success).toBe(false);
        } finally {
            socket.disconnect();
        }
    });

    it("sharing a group doesn't make people contacts: no online status between members who don't chat", async () => {
        const { group } = (await createGroup(alice, { name: "Goa trip", userIds: [carol.id, dave.id] }).expect(201)).body;
        for (const user of [carol, dave]) await api(user).post(`/api/group-invites/${(await inviteFor(user, group._id))._id}/accept`).expect(200);
        const d = await connectAs(dave);
        const seen = [];
        d.on("presence", (presence) => seen.push(presence.userId));
        const c = await connectAs(carol);
        await new Promise((resolve) => setTimeout(resolve, 300));
        d.disconnect();
        c.disconnect();
        expect(seen).not.toContain(carol.id);
    });

    it("1:1 chats from before groups (no type) still work", async () => {
        await Conversation.updateOne({ _id: chats[bob.id] }, { $unset: { type: "" } });
        const list = (await api(alice).get("/api/conversations").expect(200)).body.conversations;
        expect(list.map((c) => c._id)).toContain(String(chats[bob.id]));
        await api(alice).get(`/api/conversations/${chats[bob.id]}/messages`).expect(200);
    });
});
