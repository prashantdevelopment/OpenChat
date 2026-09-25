import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer } from "http";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import Message from "../src/models/message.model.js";
import Conversation from "../src/models/conversation.model.js";
import { connectTestDb, disconnectTestDb, registerAndLogin } from "./helpers.js";

let io, url;
let alice, bob, carol, conversationId;
const openSockets = [];

// A real HTTP + Socket.IO server on a random free port (listen(0)).
beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer);
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

        const first = await emitWithAck(a, "sendMessage", { conversationId, content: "  hello bob  " });
        const second = await emitWithAck(b, "sendMessage", { conversationId, content: "hi alice" });
        await waitForDelivery();

        expect(first.success).toBe(true);
        expect(first.message.content).toBe("hello bob"); // trimmed
        expect(second.success).toBe(true);
        expect(toB.map((m) => m.content)).toEqual(["hello bob", "hi alice"]);
        expect(toA.map((m) => m.content)).toEqual(["hello bob", "hi alice"]);
        expect(toC).toEqual([]);
    });

    it("saves the message and updates the conversation's last message", async () => {
        const a = await connectAs(alice);
        const res = await emitWithAck(a, "sendMessage", { conversationId, content: "saved?" });

        const saved = await Message.findById(res.message._id);
        expect(saved.content).toBe("saved?");
        const conversation = await Conversation.findById(conversationId);
        expect(conversation.lastMessage).toBe("saved?");
        expect(conversation.lastMessageAt.getTime()).toBe(saved.createdAt.getTime());
    });

    it("takes the sender from the login, never from the client", async () => {
        const a = await connectAs(alice);
        const res = await emitWithAck(a, "sendMessage", { conversationId, content: "spoof", sender: carol.id });
        expect(res.message.sender).toBe(alice.id);
    });

    it("refuses a message from an outsider", async () => {
        const c = await connectAs(carol);
        const res = await emitWithAck(c, "sendMessage", { conversationId, content: "let me in" });
        expect(res.success).toBe(false);
        expect(res.message).toMatch(/not a participant/);
    });

    it.each([
        ["a null payload", null, /empty/],
        ["an invalid conversation id", { conversationId: "bad-id", content: "x" }, /Invalid conversation id/],
        ["an unknown conversation", { conversationId: "64b000000000000000000000", content: "x" }, /not found/],
        ["non-string content", { content: 123 }, /empty/],
        ["object content", { content: { $gt: "" } }, /empty/],
        ["whitespace-only content", { content: "   " }, /empty/],
        ["content over 2000 characters", { content: "a".repeat(2001) }, /longer than 2000/],
    ])("rejects %s", async (_name, data, message) => {
        const a = await connectAs(alice);
        const payload = data && !("conversationId" in data) ? { conversationId, ...data } : data;
        const res = await emitWithAck(a, "sendMessage", payload);
        expect(res.success).toBe(false);
        expect(res.message).toMatch(message);
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

        const res = await emitWithAck(bobTab, "sendMessage", { conversationId, content: "sidebar ping" });
        await waitForDelivery();

        const [toAlice1, toAlice2, toBob, toCarol] = updates;
        expect(toAlice1).toHaveLength(1);
        expect(toAlice2).toHaveLength(1);
        expect(toBob).toHaveLength(1);       // the sender's other tabs need it too
        expect(toCarol).toEqual([]);         // outsiders get nothing
        expect(newMessages).toEqual([]);     // full messages stay in the conversation room

        expect(toAlice1[0]).toMatchObject({
            _id: conversationId,
            lastMessage: "sidebar ping",
            lastMessageAt: res.message.createdAt,
        });
    });

    it("sends only the summary: no participants, no emails, no message body fields", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        const toAlice = collectUpdates(a);
        await emitWithAck(b, "sendMessage", { conversationId, content: "just the summary" });
        await waitForDelivery();
        expect(Object.keys(toAlice[0]).sort()).toEqual(["_id", "lastMessage", "lastMessageAt", "unreadCount"]);
    });

    it("does not send an update when the message is rejected", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        const toAlice = collectUpdates(a);
        await emitWithAck(b, "sendMessage", { conversationId, content: "   " });
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
        emitWithAck(socket, "sendMessage", { conversationId: readerConversationId, content });
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
        expect(conversation.lastMessage).toBe("sent while reading");
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
        a.emit("sendMessage", { conversationId: "bad-id", content: "x" });           // no ack
        a.emit("sendMessage", { conversationId: "bad-id", content: "x" }, "notafn"); // ack is not a function
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
        await emitWithAck(b, "sendMessage", { conversationId, content: "after leave" });
        await waitForDelivery();
        expect(toA).toEqual([]);
    });
});
