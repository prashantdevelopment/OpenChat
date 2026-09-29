import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import app from "../src/app.js";
import Conversation from "../src/models/conversation.model.js";
import GroupInvite from "../src/models/groupInvite.model.js";
import GroupKeyEpoch from "../src/models/groupKeyEpoch.model.js";
import { connectTestDb, disconnectTestDb, lockedKeys, registerAndLogin } from "./helpers.js";

// alice creates; bob and carol join; dave declines; eve is an outsider.
let alice, bob, carol, dave, eve;

const api = (user) => ({
    get: (path) => request(app).get(path).set("Cookie", user.cookie),
    post: (path, body) => request(app).post(path).set("Cookie", user.cookie).send(body),
    del: (path) => request(app).delete(path).set("Cookie", user.cookie),
});
const keysOf = (user, groupId) => api(user).get(`/api/groups/${groupId}/keys`);
const inviteFor = async (user, groupId) => (await api(user).get("/api/group-invites").expect(200)).body.invites.find((i) => String(i.group._id) === String(groupId));
const accept = async (user, groupId) => api(user).post(`/api/group-invites/${(await inviteFor(user, groupId))._id}/accept`).expect(200);
const epochDoc = (groupId, epoch) => GroupKeyEpoch.findOne({ group: groupId, epoch }).lean();
const rotate = (user, groupId, epoch, ids) => api(user).post(`/api/groups/${groupId}/keys`, { epoch, keys: lockedKeys(ids) });
const holders = async (groupId, epoch) => (await epochDoc(groupId, epoch)).keys.map((k) => String(k.user)).sort();

// A group of alice with bob and carol invited; returns its id and the keys sent.
const newGroup = async (invited = [bob, carol]) => {
    const keys = lockedKeys([alice.id, ...invited.map((u) => u.id)]);
    const { group } = (await api(alice).post("/api/groups", { groupId: new mongoose.Types.ObjectId().toString(), name: "Goa trip", userIds: invited.map((u) => u.id), keys }).expect(201)).body;
    return { groupId: group._id, keys };
};

beforeAll(async () => {
    await connectTestDb();
    [alice, bob, carol, dave, eve] = await Promise.all(["alice_k", "bob_k", "carol_k", "dave_k", "eve_k"].map(registerAndLogin));
    for (const other of [bob, carol, dave]) {
        const { conversation } = (await api(alice).post("/api/conversations", { otherUserId: other.id }).expect(200)).body;
        await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageAt: new Date() } });
    }
});
afterAll(disconnectTestDb);
beforeEach(async () => {
    await Promise.all([GroupInvite.deleteMany({}), Conversation.deleteMany({ type: "group" }), GroupKeyEpoch.deleteMany({})]);
});

describe("the first key, made with the group", () => {
    it("the creator's browser picks the group's id (the copies are bound to it); a used or bad id is refused", async () => {
        const groupId = new mongoose.Types.ObjectId().toString();
        const body = { groupId, name: "Goa trip", userIds: [bob.id], keys: lockedKeys([alice.id, bob.id]) };
        expect((await api(alice).post("/api/groups", body).expect(201)).body.group._id).toBe(groupId);
        await api(alice).post("/api/groups", body).expect(409);
        await api(alice).post("/api/groups", { ...body, groupId: "nope" }).expect(400);
        await api(alice).post("/api/groups", { ...body, groupId: undefined }).expect(400);
    });

    it("a copy for the creator and each invitee is required, exactly them, well formed; otherwise no group", async () => {
        const post = (keys) => api(alice).post("/api/groups", { groupId: new mongoose.Types.ObjectId().toString(), name: "Goa trip", userIds: [bob.id], keys });
        expect((await post(undefined).expect(400)).body.message).toMatch(/Keys are missing/);
        expect((await post(lockedKeys([alice.id])).expect(400)).body.message).toMatch(/every person/);
        expect((await post(lockedKeys([alice.id, bob.id, eve.id])).expect(400)).body.message).toMatch(/only for the people/);
        const [a, b] = lockedKeys([alice.id, bob.id]);
        await post([a, { ...b, ciphertext: Buffer.alloc(47).toString("base64") }]).expect(400);
        await post([a, { ...b, iv: Buffer.alloc(16).toString("base64") }]).expect(400);
        await post([a, { ...b, ciphertext: "not base64!" }]).expect(400);
        expect(await Conversation.countDocuments({ type: "group" })).toBe(0);
        expect(await GroupKeyEpoch.countDocuments()).toBe(0);
    });

    it("stored as epoch 1, locked by the creator, for alice, bob and carol", async () => {
        const { groupId, keys } = await newGroup();
        const doc = await epochDoc(groupId, 1);
        expect(doc.keys.map((k) => String(k.user)).sort()).toEqual([alice.id, bob.id, carol.id].sort());
        expect(doc.keys.every((k) => String(k.wrappedBy) === alice.id)).toBe(true);
        expect(doc.keys.find((k) => String(k.user) === bob.id).ciphertext).toBe(keys.find((k) => k.userId === bob.id).ciphertext);
    });
});

describe("who gets a copy back", () => {
    it("each member only their own copy, with who locked it and their public key; an invitee only after joining; an outsider never", async () => {
        const { groupId, keys } = await newGroup();
        const mine = (await keysOf(alice, groupId).expect(200)).body;
        expect(mine.currentEpoch).toBe(1);
        expect(mine.needsNewKey).toBe(false);
        expect(mine.keys).toEqual([{ epoch: 1, wrappedBy: { _id: alice.id, publicKey: expect.any(String) }, ciphertext: keys[0].ciphertext, iv: keys[0].iv }]);
        await keysOf(bob, groupId).expect(404); // invited, not a member yet
        await keysOf(eve, groupId).expect(404);
        await accept(bob, groupId);
        const bobs = (await keysOf(bob, groupId).expect(200)).body.keys;
        expect(bobs).toHaveLength(1);
        expect(bobs[0].ciphertext).toBe(keys.find((k) => k.userId === bob.id).ciphertext);
        expect(bobs[0].wrappedBy._id).toBe(alice.id);
        expect(JSON.stringify(bobs)).not.toContain(keys.find((k) => k.userId === carol.id).ciphertext);
    });

    it("who a new epoch must be locked for: the members and the people still invited", async () => {
        const { groupId } = await newGroup();
        await accept(bob, groupId);
        const { recipients } = (await keysOf(alice, groupId).expect(200)).body;
        expect(recipients.map((r) => r.username).sort()).toEqual(["alice_k", "bob_k", "carol_k"]);
        expect(recipients.every((r) => typeof r.publicKey === "string")).toBe(true);
        expect(JSON.stringify(recipients)).not.toMatch(/email|password/);
    });
});

describe("invites carry the latest key", () => {
    it("a copy for each new invitee, at the latest epoch; extras aren't stored", async () => {
        const { groupId } = await newGroup([bob]);
        const invite = (body) => api(alice).post(`/api/groups/${groupId}/invites`, { userIds: [carol.id], ...body });
        await invite({ epoch: 1 }).expect(400); // no keys
        expect((await invite({ epoch: 2, keys: lockedKeys([carol.id]) }).expect(409)).body.reason).toBe("epoch");
        await invite({ epoch: 1, keys: lockedKeys([carol.id, eve.id]) }).expect(201);
        expect(await holders(groupId, 1)).toEqual([alice.id, bob.id, carol.id].sort());
    });

    it("declining drops the copy; so does taking an invite back, and then the group needs a new key", async () => {
        const { groupId } = await newGroup([bob, carol, dave]);
        await api(dave).post(`/api/group-invites/${(await inviteFor(dave, groupId))._id}/decline`).expect(200);
        expect(await holders(groupId, 1)).not.toContain(dave.id);
        expect((await keysOf(alice, groupId).expect(200)).body.needsNewKey).toBe(false); // he never joined
        await api(alice).del(`/api/group-invites/${(await inviteFor(carol, groupId))._id}`).expect(200);
        expect(await holders(groupId, 1)).not.toContain(carol.id);
        expect((await keysOf(alice, groupId).expect(200)).body.needsNewKey).toBe(true);
        // no more invites with the old key
        const res = await api(alice).post(`/api/groups/${groupId}/invites`, { userIds: [carol.id], epoch: 1, keys: lockedKeys([carol.id]) });
        expect([res.status, res.body.reason]).toEqual([409, "rotate"]);
    });
});

describe("a new epoch", () => {

    it("only the next number, a copy for exactly the members and invitees; then it's the latest", async () => {
        const { groupId } = await newGroup();
        await accept(bob, groupId);
        expect((await rotate(bob, groupId, 1, [alice.id, bob.id, carol.id]).expect(409)).body.reason).toBe("epoch");
        await rotate(bob, groupId, 3, [alice.id, bob.id, carol.id]).expect(409);
        await rotate(bob, groupId, 2, [alice.id, bob.id]).expect(400); // carol (invited) missing
        await rotate(bob, groupId, 2, [alice.id, bob.id, carol.id, eve.id]).expect(400); // an outsider
        await rotate(eve, groupId, 2, [alice.id, bob.id, carol.id]).expect(404);
        await rotate(bob, groupId, 2, [alice.id, bob.id, carol.id]).expect(201);
        const aliceKeys = (await keysOf(alice, groupId).expect(200)).body;
        expect(aliceKeys.currentEpoch).toBe(2);
        expect(aliceKeys.keys.map((k) => [k.epoch, k.wrappedBy._id])).toEqual([[1, alice.id], [2, bob.id]]);
    });

    it("two members at the same moment: one wins, the other is told to use it", async () => {
        const { groupId } = await newGroup([bob]);
        await accept(bob, groupId);
        const results = await Promise.all([rotate(alice, groupId, 2, [alice.id, bob.id]), rotate(bob, groupId, 2, [alice.id, bob.id])]);
        expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
        expect(await GroupKeyEpoch.countDocuments({ group: groupId })).toBe(2);
    });
});

describe("leaving and removing: never the next key", () => {
    it("bob leaves: he can't get keys any more, the group needs a new key, and it can't include him", async () => {
        const { groupId } = await newGroup();
        await accept(bob, groupId);
        await accept(carol, groupId);
        await api(bob).post(`/api/groups/${groupId}/leave`).expect(200);
        await keysOf(bob, groupId).expect(404);
        expect((await keysOf(alice, groupId).expect(200)).body.needsNewKey).toBe(true);
        await rotate(carol, groupId, 2, [alice.id, bob.id, carol.id]).expect(400);
        await rotate(carol, groupId, 2, [alice.id, carol.id]).expect(201);
        expect(await holders(groupId, 2)).toEqual([alice.id, carol.id].sort());
        expect((await keysOf(alice, groupId).expect(200)).body.needsNewKey).toBe(false);
    });

    it("an admin removes carol: same; members who aren't admins can't remove anyone", async () => {
        const { groupId } = await newGroup();
        await accept(bob, groupId);
        await accept(carol, groupId);
        expect((await api(bob).del(`/api/groups/${groupId}/members/${carol.id}`).expect(403)).body.message).toMatch(/Only admins/);
        await api(eve).del(`/api/groups/${groupId}/members/${carol.id}`).expect(404);
        await api(alice).del(`/api/groups/${groupId}/members/${alice.id}`).expect(400);
        await api(alice).del(`/api/groups/${groupId}/members/${eve.id}`).expect(404);
        await api(alice).del(`/api/groups/${groupId}/members/${carol.id}`).expect(200);
        await keysOf(carol, groupId).expect(404);
        expect((await api(alice).get(`/api/groups/${groupId}`).expect(200)).body.group.members.map((m) => m.username).sort()).toEqual(["alice_k", "bob_k"]);
        expect((await keysOf(bob, groupId).expect(200)).body.needsNewKey).toBe(true);
    });

    it("the last admin leaves: the member there longest becomes admin; the last member leaves: the group and its keys are gone", async () => {
        const { groupId } = await newGroup();
        await accept(carol, groupId);
        await accept(bob, groupId);
        await Conversation.updateOne({ _id: groupId }, { $set: { [`joinedAt.${bob.id}`]: new Date(Date.now() - 60_000) } }); // bob first
        await api(alice).post(`/api/groups/${groupId}/leave`).expect(200);
        expect((await api(bob).get(`/api/groups/${groupId}`).expect(200)).body.group.admins).toEqual([bob.id]);
        await api(bob).post(`/api/groups/${groupId}/leave`).expect(200);
        await api(carol).post(`/api/groups/${groupId}/leave`).expect(200);
        expect(await Conversation.countDocuments({ _id: groupId })).toBe(0);
        expect(await GroupKeyEpoch.countDocuments({ group: groupId })).toBe(0);
    });
});
