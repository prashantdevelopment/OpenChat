import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer } from "http";
import { randomUUID } from "crypto";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import Message from "../src/models/message.model.js";
import Conversation from "../src/models/conversation.model.js";
import { connectTestDb, disconnectTestDb, encrypted, readText, registerAndLogin } from "./helpers.js";

// Short, so the presence tests do not wait 5 seconds.
const PRESENCE_GRACE_MS = 400;
let io, url;
let alice, bob, carol, conversationId;
const openSockets = [];

// A real HTTP + Socket.IO server on a random free port (listen(0)).
beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: PRESENCE_GRACE_MS });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;

    alice = await registerAndLogin("alice_test");
    bob = await registerAndLogin("bobby_test");
    carol = await registerAndLogin("carol_test");
    const res = await request(app)
        .post("/api/conversations")
        .set("Cookie", alice.cookie)
        .send({ otherUserId: bob.id });
    conversationId = res.body.conversation._id;
});

afterEach(() => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
});

afterAll(async () => {
    io.close();
    await disconnectTestDb();
});

// Connects as a user by sending their auth cookie, like the browser does.
const connectAs = (user) =>
    new Promise((resolve, reject) => {
        const socket = connectClient(url, {
            extraHeaders: user ? { cookie: user.cookie } : {},
            reconnection: false,
        });
        openSockets.push(socket);
        socket.on("connect", () => resolve(socket));
        socket.on("connect_error", reject);
    });

// Emits an event and waits for the server's ack (fails the test after 2s).
const emitWithAck = (socket, event, data) => socket.timeout(2000).emitWithAck(event, data);

// Collects "newMessage" events a socket receives.
const collectMessages = (socket) => {
    const received = [];
    socket.on("newMessage", (message) => received.push(message));
    return received;
};

const waitForDelivery = () => new Promise((resolve) => setTimeout(resolve, 200));

describe("socket authentication", () => {
    it("rejects a connection without a cookie", async () => {
        await expect(connectAs(null)).rejects.toThrow(/Authentication token is missing/);
    });

    it("rejects a forged token", async () => {
        await expect(connectAs({ cookie: "token=abc.def.ghi" })).rejects.toThrow(/Invalid authentication token/);
    });
});

describe("joinConversation", () => {
    it("lets participants join", async () => {
        const socket = await connectAs(alice);
        expect(await emitWithAck(socket, "joinConversation", conversationId)).toEqual({ success: true });
    });

    it("refuses an outsider", async () => {
        const socket = await connectAs(carol);
        const res = await emitWithAck(socket, "joinConversation", conversationId);
        expect(res.success).toBe(false);
        expect(res.message).toMatch(/not a participant/);
    });

    it("rejects an invalid id", async () => {
        const socket = await connectAs(alice);
        expect(await emitWithAck(socket, "joinConversation", "bad-id")).toEqual({
            success: false,
            message: "Invalid conversation id",
        });
    });
});

describe("sendMessage between two users", () => {
    it("delivers A -> B and B -> A in real time, and only to the room", async () => {
        const [a, b, c] = await Promise.all([connectAs(alice), connectAs(bob), connectAs(carol)]);
        await emitWithAck(a, "joinConversation", conversationId);
        await emitWithAck(b, "joinConversation", conversationId);
        const [toA, toB, toC] = [collectMessages(a), collectMessages(b), collectMessages(c)];

        const first = await emitWithAck(a, "sendMessage", { conversationId, ...encrypted("hello bob") });
        const second = await emitWithAck(b, "sendMessage", { conversationId, ...encrypted("hi alice") });
        await waitForDelivery();

        expect(first.success).toBe(true);
        expect(readText(first.message)).toBe("hello bob");
        expect(first.message).not.toHaveProperty("content"); // the server never sees text
        expect(second.success).toBe(true);
        expect(toB.map(readText)).toEqual(["hello bob", "hi alice"]);
        expect(toA.map(readText)).toEqual(["hello bob", "hi alice"]);
        expect(toC).toEqual([]);
    });

    it("saves the message and updates the conversation's last message", async () => {
        const a = await connectAs(alice);
        const res = await emitWithAck(a, "sendMessage", { conversationId, ...encrypted("saved?") });

        const saved = await Message.findById(res.message._id);
        expect(readText(saved)).toBe("saved?");
        const conversation = await Conversation.findById(conversationId);
        expect(readText(conversation.lastMessage)).toBe("saved?");
        expect(conversation.lastMessageAt.getTime()).toBe(saved.createdAt.getTime());
    });

    it("takes the sender from the login, never from the client", async () => {
        const a = await connectAs(alice);
        const res = await emitWithAck(a, "sendMessage", { conversationId, ...encrypted("spoof"), sender: carol.id });
        expect(res.message.sender).toBe(alice.id);
    });

    it("refuses a message from an outsider", async () => {
        const c = await connectAs(carol);
        const res = await emitWithAck(c, "sendMessage", { conversationId, ...encrypted("let me in") });
        expect(res.success).toBe(false);
        expect(res.message).toMatch(/not a participant/);
    });

    it.each([
        ["a null payload", null, /missing or invalid/],
        ["an invalid conversation id", { conversationId: "bad-id", ...encrypted("x") }, /Invalid conversation id/],
        ["an unknown conversation", { conversationId: "64b000000000000000000000", ...encrypted("x") }, /not found/],
        ["plain text instead of ciphertext", { content: "hello" }, /missing or invalid/],
        ["ciphertext that is not base64", { ciphertext: "not base64!", iv: encrypted("x").iv }, /missing or invalid/],
        ["an object as ciphertext", { ciphertext: { $gt: "" }, iv: encrypted("x").iv }, /missing or invalid/],
        ["an IV of the wrong size", { ciphertext: encrypted("x").ciphertext, iv: "AAAA" }, /IV must be 12 bytes/],
        ["an empty message (tag only)", encrypted(""), /empty/],
        ["more than 2000 characters' worth of ciphertext", encrypted("a".repeat(8001)), /longer than 2000/],
    ])("rejects %s", async (_name, data, message) => {
        const a = await connectAs(alice);
        const payload = data && !("conversationId" in data) ? { conversationId, ...data } : data;
        const res = await emitWithAck(a, "sendMessage", payload);
        expect(res.success).toBe(false);
        expect(res.message).toMatch(message);
    });
});

describe("message order", () => {
    it("keeps the order in which one connection sent its messages", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        await emitWithAck(b, "joinConversation", conversationId);
        const toB = collectMessages(b);
        const sent = Array.from({ length: 20 }, (_, i) => `quick ${i}`);

        // All at once, without waiting for each reply (like fast typing).
        const acks = await Promise.all(sent.map((text) => emitWithAck(a, "sendMessage", { conversationId, ...encrypted(text) })));
        await waitForDelivery();

        expect(acks.map((ack) => readText(ack.message))).toEqual(sent);
        expect(toB.map(readText)).toEqual(sent);
        const saved = await Message.find({ _id: { $in: acks.map((ack) => ack.message._id) } }).sort({ createdAt: 1, _id: 1 });
        expect(saved.map(readText)).toEqual(sent);
    });
});

describe("retries with the same clientId (no duplicate messages)", () => {
    // The unique index is what stops two copies; the test database starts empty.
    beforeAll(() => Message.createIndexes());

    it("saves a retried message once, confirms both sends and announces it once", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        await emitWithAck(b, "joinConversation", conversationId);
        const toB = collectMessages(b);
        const payload = { conversationId, clientId: randomUUID(), ...encrypted("sent twice") };

        const first = await emitWithAck(a, "sendMessage", payload);
        const retry = await emitWithAck(a, "sendMessage", payload);
        await waitForDelivery();

        expect(first.success && retry.success).toBe(true);
        expect(retry.message._id).toBe(first.message._id);
        expect(retry.message.clientId).toBe(payload.clientId);
        expect(await Message.countDocuments({ clientId: payload.clientId })).toBe(1);
        expect(toB.map(readText)).toEqual(["sent twice"]);
    });

    it("keeps one copy when the same message arrives twice at the same moment", async () => {
        const a = await connectAs(alice);
        const payload = { conversationId, clientId: randomUUID(), ...encrypted("race") };
        const [one, two] = await Promise.all([
            emitWithAck(a, "sendMessage", payload),
            emitWithAck(a, "sendMessage", payload),
        ]);
        expect(one.success && two.success).toBe(true);
        expect(one.message._id).toBe(two.message._id);
        expect(await Message.countDocuments({ clientId: payload.clientId })).toBe(1);
    });

    it("treats the same clientId from another user as a different message", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        const clientId = randomUUID();
        const fromA = await emitWithAck(a, "sendMessage", { conversationId, clientId, ...encrypted("a") });
        const fromB = await emitWithAck(b, "sendMessage", { conversationId, clientId, ...encrypted("b") });
        expect(fromA.success && fromB.success).toBe(true);
        expect(fromA.message._id).not.toBe(fromB.message._id);
    });

    it("refuses a clientId reused in another conversation", async () => {
        const res = await request(app).post("/api/conversations").set("Cookie", alice.cookie).send({ otherUserId: carol.id });
        const otherConversationId = res.body.conversation._id;
        const a = await connectAs(alice);
        const clientId = randomUUID();
        await emitWithAck(a, "sendMessage", { conversationId, clientId, ...encrypted("here") });
        const reused = await emitWithAck(a, "sendMessage", { conversationId: otherConversationId, clientId, ...encrypted("there") });
        expect(reused.success).toBe(false);
        expect(reused.message).toMatch(/already used/);
        expect(await Message.countDocuments({ clientId })).toBe(1);
    });

    it.each([
        ["a clientId that is not a UUID", "123"],
        ["an object as clientId", { $ne: null }],
    ])("rejects %s", async (_name, clientId) => {
        const a = await connectAs(alice);
        const res = await emitWithAck(a, "sendMessage", { conversationId, clientId, ...encrypted("x") });
        expect(res.success).toBe(false);
        expect(res.message).toMatch(/clientId must be a UUID/);
    });
});

describe("conversationUpdated (sidebar updates through personal rooms)", () => {
    const collectUpdates = (socket) => {
        const received = [];
        socket.on("conversationUpdated", (update) => received.push(update));
        return received;
    };

    it("reaches both participants on every tab, without joining the conversation", async () => {
        // No joinConversation here: only the automatic personal room.
        const [aliceTab1, aliceTab2, bobTab, carolTab] = await Promise.all([
            connectAs(alice), connectAs(alice), connectAs(bob), connectAs(carol),
        ]);
        const updates = [aliceTab1, aliceTab2, bobTab, carolTab].map(collectUpdates);
        const newMessages = collectMessages(aliceTab1);

        const res = await emitWithAck(bobTab, "sendMessage", { conversationId, ...encrypted("sidebar ping") });
        await waitForDelivery();

        const [toAlice1, toAlice2, toBob, toCarol] = updates;
        expect(toAlice1).toHaveLength(1);
        expect(toAlice2).toHaveLength(1);
        expect(toBob).toHaveLength(1);       // the sender's other tabs need it too
        expect(toCarol).toEqual([]);         // outsiders get nothing
        expect(newMessages).toEqual([]);     // full messages stay in the conversation room

        expect(toAlice1[0]).toMatchObject({
            _id: conversationId,
            lastMessageAt: res.message.createdAt,
        });
        // The preview is still encrypted, with the sender needed to decrypt it.
        expect(readText(toAlice1[0].lastMessage)).toBe("sidebar ping");
        expect(toAlice1[0].lastMessage.sender).toBe(bob.id);
    });

    it("sends only the summary: no participants, no emails, no message body fields", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        const toAlice = collectUpdates(a);
        await emitWithAck(b, "sendMessage", { conversationId, ...encrypted("just the summary") });
        await waitForDelivery();
        expect(Object.keys(toAlice[0]).sort()).toEqual(["_id", "lastMessage", "lastMessageAt", "unreadCount"]);
    });

    it("does not send an update when the message is rejected", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        const toAlice = collectUpdates(a);
        await emitWithAck(b, "sendMessage", { conversationId, ...encrypted("") });
        await waitForDelivery();
        expect(toAlice).toEqual([]);
    });
});

describe("unread counts and markRead", () => {
    // A fresh pair, so earlier tests' messages don't affect the counts.
    let reader, writer, readerConversationId;
    beforeAll(async () => {
        reader = await registerAndLogin("reader_test");
        writer = await registerAndLogin("writer_test");
        const res = await request(app)
            .post("/api/conversations")
            .set("Cookie", writer.cookie)
            .send({ otherUserId: reader.id });
        readerConversationId = res.body.conversation._id;
    });

    const listFor = async (user) => {
        const res = await request(app).get("/api/conversations").set("Cookie", user.cookie);
        return res.body.conversations.find((c) => c._id === readerConversationId);
    };
    const send = (socket, content) =>
        emitWithAck(socket, "sendMessage", { conversationId: readerConversationId, ...encrypted(content) });
    const collect = (socket, event) => {
        const received = [];
        socket.on(event, (payload) => received.push(payload));
        return received;
    };

    it("counts the other user's messages for the reader, never your own", async () => {
        const [r, w] = await Promise.all([connectAs(reader), connectAs(writer)]);
        const toReader = collect(r, "conversationUpdated");
        const toWriter = collect(w, "conversationUpdated");

        await send(w, "one");
        await send(w, "two");
        await waitForDelivery();

        expect(toReader.map((u) => u.unreadCount)).toEqual([1, 2]);
        expect(toWriter.map((u) => u.unreadCount)).toEqual([0, 0]);
        expect((await listFor(reader)).unreadCount).toBe(2);
        expect((await listFor(writer)).unreadCount).toBe(0);
    });

    it("never exposes lastReadAt in the conversation list", async () => {
        expect(await listFor(reader)).not.toHaveProperty("lastReadAt");
    });

    it("markRead clears the count and tells every tab of the reader, not the writer", async () => {
        const [readerTab1, readerTab2, w] = await Promise.all([connectAs(reader), connectAs(reader), connectAs(writer)]);
        const [toTab1, toTab2, toWriter] = [collect(readerTab1, "conversationRead"), collect(readerTab2, "conversationRead"), collect(w, "conversationRead")];

        expect(await emitWithAck(readerTab1, "markRead", readerConversationId)).toEqual({ success: true });
        await waitForDelivery();

        expect(toTab1).toEqual([{ _id: readerConversationId }]);
        expect(toTab2).toEqual([{ _id: readerConversationId }]);
        expect(toWriter).toEqual([]);
        expect((await listFor(reader)).unreadCount).toBe(0);
    });

    it("counts only messages that arrive after the last read", async () => {
        const [r, w] = await Promise.all([connectAs(reader), connectAs(writer)]);
        const toReader = collect(r, "conversationUpdated");
        await send(w, "three");
        await waitForDelivery();
        expect(toReader[0].unreadCount).toBe(1);
        expect((await listFor(reader)).unreadCount).toBe(1);
    });

    it("sends the sidebar update before the message itself", async () => {
        const [r, w] = await Promise.all([connectAs(reader), connectAs(writer)]);
        await emitWithAck(r, "joinConversation", readerConversationId);
        const order = [];
        r.on("conversationUpdated", () => order.push("conversationUpdated"));
        r.on("newMessage", () => order.push("newMessage"));
        await send(w, "order check");
        await waitForDelivery();
        expect(order).toEqual(["conversationUpdated", "newMessage"]);
    });

    it("markRead at the same moment as a new message does not lose the last message", async () => {
        const [r, w] = await Promise.all([connectAs(reader), connectAs(writer)]);
        await Promise.all([
            send(w, "sent while reading"),
            emitWithAck(r, "markRead", readerConversationId),
        ]);
        const conversation = await Conversation.findById(readerConversationId);
        expect(readText(conversation.lastMessage)).toBe("sent while reading");
        expect(conversation.lastReadAt.get(reader.id)).toBeInstanceOf(Date);
    });

    it.each([
        ["an invalid id", "bad-id", /Invalid conversation id/],
        ["an unknown conversation", "64b000000000000000000000", /not found/],
    ])("rejects markRead with %s", async (_name, id, message) => {
        const r = await connectAs(reader);
        const res = await emitWithAck(r, "markRead", id);
        expect(res.success).toBe(false);
        expect(res.message).toMatch(message);
    });

    it("refuses markRead from an outsider", async () => {
        const c = await connectAs(carol);
        const res = await emitWithAck(c, "markRead", readerConversationId);
        expect(res.success).toBe(false);
        expect(res.message).toMatch(/not a participant/);
    });
});

describe("robustness", () => {
    it("survives malformed events that used to crash the server", async () => {
        const a = await connectAs(alice);
        a.emit("sendMessage", { conversationId: "bad-id", ...encrypted("x") });           // no ack
        a.emit("sendMessage", { conversationId: "bad-id", ...encrypted("x") }, "notafn"); // ack is not a function
        a.emit("joinConversation", Buffer.alloc(12));                                // binary id
        a.emit("leaveConversation", { weird: true });
        await waitForDelivery();

        // Still alive: a normal request on the same connection works.
        const res = await emitWithAck(a, "joinConversation", conversationId);
        expect(res.success).toBe(true);
    });

    it("stops delivering after leaveConversation", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        await emitWithAck(a, "joinConversation", conversationId);
        await emitWithAck(b, "joinConversation", conversationId);
        const toA = collectMessages(a);

        a.emit("leaveConversation", conversationId);
        await waitForDelivery();
        await emitWithAck(b, "sendMessage", { conversationId, ...encrypted("after leave") });
        await waitForDelivery();
        expect(toA).toEqual([]);
    });
});

describe("presence (online / last seen)", () => {
    // Own users, so other tests' connections and conversations don't interfere.
    let ana, ben, chetan;
    beforeAll(async () => {
        [ana, ben, chetan] = await Promise.all(["ana_pres", "ben_pres", "chetan_pres"].map(registerAndLogin));
        await request(app).post("/api/conversations").set("Cookie", ana.cookie).send({ otherUserId: ben.id });
    });

    const collectPresence = (socket) => {
        const received = [];
        socket.on("presence", (event) => received.push(event));
        return received;
    };
    const afterGrace = () => new Promise((resolve) => setTimeout(resolve, PRESENCE_GRACE_MS + 150));
    const presenceOf = async (viewer, userId) => {
        const res = await request(app).get("/api/conversations").set("Cookie", viewer.cookie);
        return res.body.conversations.flatMap((c) => c.participants).find((p) => p._id === userId);
    };

    it("tells contacts when someone comes online, and nobody else", async () => {
        const [b, c] = await Promise.all([connectAs(ben), connectAs(chetan)]);
        const [toBen, toChetan] = [collectPresence(b), collectPresence(c)];
        const a = await connectAs(ana);
        await waitForDelivery();

        expect(toBen).toEqual([{ userId: ana.id, online: true }]);
        expect(toChetan).toEqual([]);
        expect((await presenceOf(ben, ana.id)).online).toBe(true);

        a.disconnect();
        await afterGrace();
    });

    it("counts tabs: only the last one closing makes the user offline, after a grace period", async () => {
        const b = await connectAs(ben);
        const toBen = collectPresence(b);
        const tab1 = await connectAs(ana);
        const tab2 = await connectAs(ana);
        await waitForDelivery();
        expect(toBen).toEqual([{ userId: ana.id, online: true }]); // not twice

        tab1.disconnect();
        await afterGrace();
        expect(toBen).toHaveLength(1); // still online in tab 2

        const before = Date.now();
        tab2.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(toBen).toHaveLength(1); // grace period: not offline yet
        expect((await presenceOf(ben, ana.id)).online).toBe(true);

        await afterGrace();
        expect(toBen).toHaveLength(2);
        const offline = toBen[1];
        expect(offline).toMatchObject({ userId: ana.id, online: false });
        expect(new Date(offline.lastSeen).getTime()).toBeGreaterThanOrEqual(before);

        const seen = await presenceOf(ben, ana.id);
        expect(seen.online).toBe(false);
        expect(seen.lastSeen).toBe(offline.lastSeen); // saved in the database
    });

    it("a quick reconnect (page reload) is not reported at all", async () => {
        const b = await connectAs(ben);
        const a = await connectAs(ana);
        await afterGrace();
        const toBen = collectPresence(b);

        a.disconnect();
        await connectAs(ana); // back within the grace period
        await afterGrace();
        expect(toBen).toEqual([]);
    });

    it("never shows last seen or online status in search results", async () => {
        const res = await request(app).get("/api/users/search").query({ q: "ana_pres" }).set("Cookie", chetan.cookie);
        expect(res.body.users[0]).not.toHaveProperty("lastSeen");
        expect(res.body.users[0]).not.toHaveProperty("online");
    });
});

describe("typing indicator", () => {
    const collectTyping = (socket) => {
        const received = [];
        socket.on("typing", (event) => received.push(event));
        return received;
    };

    it("reaches the other participant with the chat open, not the typist or outsiders", async () => {
        const [a, b, c] = await Promise.all([connectAs(alice), connectAs(bob), connectAs(carol)]);
        await emitWithAck(a, "joinConversation", conversationId);
        await emitWithAck(b, "joinConversation", conversationId);
        const [toA, toB, toC] = [collectTyping(a), collectTyping(b), collectTyping(c)];

        a.emit("typing", { conversationId, isTyping: true });
        a.emit("typing", { conversationId, isTyping: false });
        await waitForDelivery();

        expect(toB).toEqual([
            { conversationId, userId: alice.id, isTyping: true },
            { conversationId, userId: alice.id, isTyping: false },
        ]);
        expect(toA).toEqual([]);
        expect(toC).toEqual([]);
    });

    it("ignores a socket that has not joined the conversation (outsider or not open)", async () => {
        const [b, c] = await Promise.all([connectAs(bob), connectAs(carol)]);
        await emitWithAck(b, "joinConversation", conversationId);
        const toB = collectTyping(b);

        c.emit("typing", { conversationId, isTyping: true }); // carol is not a participant
        const aNotJoined = await connectAs(alice);
        aNotJoined.emit("typing", { conversationId, isTyping: true }); // alice never joined on this socket
        await waitForDelivery();
        expect(toB).toEqual([]);
    });

    it("ignores malformed events without crashing", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        await emitWithAck(a, "joinConversation", conversationId);
        await emitWithAck(b, "joinConversation", conversationId);
        const toB = collectTyping(b);

        a.emit("typing", null);
        a.emit("typing", "not an object");
        a.emit("typing", { conversationId, isTyping: "yes" });
        a.emit("typing", { conversationId: { $ne: null }, isTyping: true });
        await waitForDelivery();
        expect(toB).toEqual([]);
        expect((await emitWithAck(a, "joinConversation", conversationId)).success).toBe(true); // still alive
    });
});
