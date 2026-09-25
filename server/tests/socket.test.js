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
