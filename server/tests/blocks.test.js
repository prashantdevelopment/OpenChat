import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { createServer } from "http";
import { randomUUID } from "crypto";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import Block from "../src/models/block.model.js";
import Report from "../src/models/report.model.js";
import { connectTestDb, disconnectTestDb, encrypted, registerAndLogin } from "./helpers.js";

let io, url;
let alice, bob, carol, dave, conversationId;
const openSockets = [];

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 100 });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    [alice, bob, carol, dave] = await Promise.all(["alice_blk", "bob_blk", "carol_blk", "dave_blk"].map(registerAndLogin));
    conversationId = (await request(app).post("/api/conversations").set("Cookie", alice.cookie).send({ otherUserId: bob.id })).body.conversation._id;
});

beforeEach(async () => {
    await Block.deleteMany({});
    await Report.deleteMany({});
});

afterEach(() => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
});

afterAll(async () => {
    io.close();
    await disconnectTestDb();
});

const api = (user) => ({
    get: (path) => request(app).get(path).set("Cookie", user.cookie),
    put: (path) => request(app).put(path).set("Cookie", user.cookie),
    del: (path) => request(app).delete(path).set("Cookie", user.cookie),
    post: (path, body) => request(app).post(path).set("Cookie", user.cookie).send(body),
});
const block = (by, target) => api(by).put(`/api/blocks/${target.id}`).expect(200);
const connectAs = (user) => new Promise((resolve, reject) => {
    const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false });
    openSockets.push(socket);
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
});
const emitWithAck = (socket, event, data) => socket.timeout(2000).emitWithAck(event, data);
const collect = (socket, event) => {
    const received = [];
    socket.on(event, (payload) => received.push(payload));
    return received;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 250));
const send = (socket, text) => emitWithAck(socket, "sendMessage", { conversationId, ...encrypted(text), clientId: randomUUID() });

describe("blocking: the API", () => {
    it("blocks, lists and unblocks (idempotent), public fields only", async () => {
        await block(alice, bob);
        await block(alice, bob); // twice is fine
        const list = (await api(alice).get("/api/blocks").expect(200)).body.users;
        expect(list.map((user) => user.username)).toEqual(["bob_blk"]);
        expect(Object.keys(list[0]).sort()).toEqual(["_id", "avatar", "bio", "publicKey", "state", "username"]);
        expect(await Block.countDocuments()).toBe(1);
        // Bob's own list is empty: a block is only listed for the blocker
        expect((await api(bob).get("/api/blocks").expect(200)).body.users).toEqual([]);

        await api(alice).del(`/api/blocks/${bob.id}`).expect(200);
        await api(alice).del(`/api/blocks/${bob.id}`).expect(200);
        expect((await api(alice).get("/api/blocks").expect(200)).body.users).toEqual([]);
    });

    it("rejects bad input: yourself, invalid or unknown ids, no login", async () => {
        expect((await api(alice).put(`/api/blocks/${alice.id}`).expect(400)).body.message).toMatch(/yourself/);
        await api(alice).put("/api/blocks/not-an-id").expect(400);
        await api(alice).put("/api/blocks/64b000000000000000000000").expect(404);
        await request(app).put(`/api/blocks/${bob.id}`).expect(401);
        await request(app).get("/api/blocks").expect(401);
    });
});

describe("blocking: what it stops (both directions)", () => {
    it("messages: neither can send, the history stays readable", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        expect((await send(a, "before the block")).success).toBe(true);
        await block(alice, bob);

        const fromBob = await send(b, "after the block");
        const fromAlice = await send(a, "after the block too");
        expect(fromBob).toMatchObject({ success: false, message: "You can't send messages in this chat" });
        expect(fromAlice).toMatchObject({ success: false, message: "You can't send messages in this chat" });

        const history = (await api(bob).get(`/api/conversations/${conversationId}/messages`).expect(200)).body.messages;
        expect(history).toHaveLength(1);

        await api(alice).del(`/api/blocks/${bob.id}`).expect(200);
        expect((await send(b, "after unblocking")).success).toBe(true);
    });

    it("files: no upload into the chat", async () => {
        await block(bob, alice);
        const res = await api(alice).post(`/api/conversations/${conversationId}/uploads?kind=file`)
            .set("Content-Type", "application/octet-stream")
            .send(Buffer.alloc(64, 1))
            .expect(403);
        expect(res.body.message).toBe("You can't send files in this chat");
    });

    it("calls: no call rings, whoever blocked whom", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        const rings = collect(b, "incomingCall");
        await block(bob, alice); // bob blocked alice; alice tries to call bob
        const res = await emitWithAck(a, "callUser", { conversationId, callId: randomUUID(), media: "audio", offer: encrypted("sdp") });
        expect(res).toMatchObject({ success: false, message: "You can't call this person" });
        await settle();
        expect(rings).toEqual([]);
    });

    it("a new chat can't be started; an existing one still opens", async () => {
        await block(carol, dave);
        const res = await api(dave).post("/api/conversations", { otherUserId: carol.id }).expect(403);
        expect(res.body.message).toBe("You can't message this person");
        await api(carol).post("/api/conversations", { otherUserId: dave.id }).expect(403);

        await block(alice, bob);
        const existing = await api(alice).post("/api/conversations", { otherUserId: bob.id }).expect(200);
        expect(existing.body.conversation._id).toBe(conversationId);
    });

    it("search and Discover: neither finds the other; outsiders still find both", async () => {
        await block(alice, bob);
        const search = async (user, q) => (await api(user).get(`/api/users/search?q=${q}`).expect(200)).body.users.map((u) => u.username);
        const discover = async (user) => (await api(user).get("/api/users/discover?state=delhi").expect(200)).body.users.map((u) => u.username);
        expect(await search(alice, "bob_")).toEqual([]);
        expect(await search(bob, "alice_")).toEqual([]);
        expect(await discover(alice)).not.toContain("bob_blk");
        expect(await discover(bob)).not.toContain("alice_blk");
        expect(await search(carol, "bob_")).toEqual(["bob_blk"]);
        expect(await discover(carol)).toEqual(expect.arrayContaining(["alice_blk", "bob_blk"]));
    });

    it("profile: 404 for the blocked person; the blocker sees blockedByMe (to unblock)", async () => {
        await block(alice, bob);
        const forBob = await api(bob).get("/api/users/alice_blk").expect(404);
        expect(forBob.body.message).toBe("User not found"); // same as a wrong name
        const forAlice = await api(alice).get("/api/users/bob_blk").expect(200);
        expect(forAlice.body.user.blockedByMe).toBe(true);
        expect((await api(carol).get("/api/users/alice_blk").expect(200)).body.user.blockedByMe).toBe(false);
        expect((await api(alice).get("/api/users/alice_blk").expect(200)).body.user.blockedByMe).toBe(false);
    });

    it("chat list: only the blocker sees blockedByMe; no online status or last seen across the block", async () => {
        const b = await connectAs(bob);
        await settle();
        await block(alice, bob);
        const aliceView = (await api(alice).get("/api/conversations").expect(200)).body.conversations.find((c) => c._id === conversationId);
        const bobView = (await api(bob).get("/api/conversations").expect(200)).body.conversations.find((c) => c._id === conversationId);
        expect(aliceView.blockedByMe).toBe(true);
        expect(bobView.blockedByMe).toBe(false); // bob is never told
        const bobSeenByAlice = aliceView.participants.find((p) => p._id === bob.id);
        const aliceSeenByBob = bobView.participants.find((p) => p._id === alice.id);
        expect(bobSeenByAlice).toMatchObject({ online: false, lastSeen: null });
        expect(aliceSeenByBob).toMatchObject({ online: false, lastSeen: null });
        b.disconnect();
    });

    it("presence: going on or offline isn't sent across a block", async () => {
        await block(bob, alice);
        const a = await connectAs(alice);
        const presence = collect(a, "presence");
        const b = await connectAs(bob);
        await settle();
        b.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 400)); // past the grace period
        expect(presence.filter((p) => p.userId === bob.id)).toEqual([]);
    });

    it("receipts: reading and receiving aren't reported across a block", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        await emitWithAck(a, "joinConversation", conversationId);
        expect((await send(a, "read me")).success).toBe(true);
        await block(bob, alice);
        const receipts = collect(a, "receipt");
        await emitWithAck(b, "markDelivered", conversationId);
        await emitWithAck(b, "markRead", conversationId);
        await settle();
        expect(receipts).toEqual([]);
    });

    it("typing: the blocker stays out of the live room, so the other's typing never reaches them", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        const typingAtAlice = collect(a, "typing");
        await emitWithAck(a, "joinConversation", conversationId);
        await emitWithAck(b, "joinConversation", conversationId);
        await block(alice, bob); // alice's sockets leave the room now
        await settle();
        b.emit("typing", { conversationId, isTyping: true });
        // Joining again (opening the chat) keeps her out as well
        expect((await emitWithAck(a, "joinConversation", conversationId)).success).toBe(true);
        b.emit("typing", { conversationId, isTyping: true });
        await settle();
        expect(typingAtAlice).toEqual([]);
    });

    it("live: the blocker's tabs get blocksChanged; the blocked person only sees them go offline", async () => {
        const [a1, a2, b] = await Promise.all([connectAs(alice), connectAs(alice), connectAs(bob)]);
        const [changed1, changed2, changedAtBob, presenceAtBob] = [collect(a1, "blocksChanged"), collect(a2, "blocksChanged"), collect(b, "blocksChanged"), collect(b, "presence")];
        await block(alice, bob);
        await settle();
        expect(changed1).toEqual([{ userId: bob.id, blocked: true }]);
        expect(changed2).toEqual([{ userId: bob.id, blocked: true }]);
        expect(changedAtBob).toEqual([]);
        expect(presenceAtBob).toEqual([{ userId: alice.id, online: false, lastSeen: null }]);

        await api(alice).del(`/api/blocks/${bob.id}`).expect(200);
        await settle();
        expect(changed1.at(-1)).toEqual({ userId: bob.id, blocked: false });
        expect(presenceAtBob.at(-1)).toMatchObject({ userId: alice.id, online: true });
    });

    it("a block by one side stays when the other side unblocks nothing", async () => {
        await block(alice, bob);
        await api(bob).del(`/api/blocks/${alice.id}`).expect(200); // bob never blocked alice
        const b = await connectAs(bob);
        expect((await send(b, "still blocked")).success).toBe(false);
    });
});

describe("reports", () => {
    it("stores a report (no message content), and can block at the same time", async () => {
        const res = await api(alice).post("/api/reports", { userId: bob.id, reason: "harassment", details: "  Keeps sending rude messages  ", conversationId, alsoBlock: true }).expect(201);
        expect(res.body).toMatchObject({ success: true, blocked: true });
        const report = await Report.findOne().lean();
        expect(report).toMatchObject({ reason: "harassment", details: "Keeps sending rude messages", status: "open" });
        expect(String(report.reporter)).toBe(alice.id);
        expect(String(report.reported)).toBe(bob.id);
        expect(String(report.conversationId)).toBe(conversationId);
        expect(await Block.exists({ blocker: alice.id, blocked: bob.id })).toBeTruthy();
    });

    it("without blocking, and without a chat", async () => {
        const res = await api(carol).post("/api/reports", { userId: dave.id, reason: "spam" }).expect(201);
        expect(res.body.blocked).toBe(false);
        expect(await Block.countDocuments()).toBe(0);
    });

    it("rejects bad input", async () => {
        const bad = async (body, status) => (await api(alice).post("/api/reports", body).expect(status)).body.message;
        expect(await bad({ userId: bob.id, reason: "bored" }, 400)).toBe("Choose a reason");
        expect(await bad({ userId: bob.id }, 400)).toBe("Choose a reason");
        expect(await bad({ userId: alice.id, reason: "spam" }, 400)).toMatch(/yourself/);
        expect(await bad({ userId: "nope", reason: "spam" }, 400)).toBe("Invalid user id");
        expect(await bad({ userId: "64b000000000000000000000", reason: "spam" }, 404)).toBe("User not found");
        expect(await bad({ userId: bob.id, reason: "spam", details: "x".repeat(501) }, 400)).toMatch(/500/);
        expect(await bad({ userId: bob.id, reason: "spam", details: { $gt: "" } }, 400)).toMatch(/500/);
        expect(await bad({ userId: bob.id, reason: "spam", alsoBlock: "yes" }, 400)).toMatch(/alsoBlock/);
        // A chat that isn't between the two: carol reports bob "from" alice and bob's chat
        const res = await api(carol).post("/api/reports", { userId: bob.id, reason: "spam", conversationId }).expect(403);
        expect(res.body.message).toMatch(/not a participant/);
        await request(app).post("/api/reports").send({ userId: bob.id, reason: "spam" }).expect(401);
        expect(await Report.countDocuments()).toBe(0);
    });

    it("the reporter's chat must be with the reported person", async () => {
        const res = await api(alice).post("/api/reports", { userId: carol.id, reason: "spam", conversationId }).expect(400);
        expect(res.body.message).toBe("That chat is not with this person");
    });

    it("limits: the same person once a day, at most 10 reports a day", async () => {
        await api(alice).post("/api/reports", { userId: bob.id, reason: "spam" }).expect(201);
        expect((await api(alice).post("/api/reports", { userId: bob.id, reason: "other" }).expect(409)).body.message).toBe("You already reported this person today");
        // Yesterday's reports don't count
        await Report.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } }); // createdAt is immutable in Mongoose
        await api(alice).post("/api/reports", { userId: bob.id, reason: "spam" }).expect(201);
        // Fill today up to 10 (made directly, other people)
        const others = Array.from({ length: 9 }, () => ({ reporter: alice.id, reported: randomObjectId(), reason: "spam" }));
        await Report.insertMany(others);
        const res = await api(alice).post("/api/reports", { userId: carol.id, reason: "spam" }).expect(429);
        expect(res.body.message).toMatch(/tomorrow/);
    });
});

const randomObjectId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
