import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "http";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import User from "../src/models/user.model.js";
import Conversation from "../src/models/conversation.model.js";
import { PASSWORD, TEST_KEYS, connectTestDb, disconnectTestDb, registerAndLogin } from "./helpers.js";

// Everything that must never reach another user.
const BOB_EMAIL = "bobby_test@test.dev";
const expectNothingPrivate = (payload, { allowOwnEmail } = {}) => {
    const json = JSON.stringify(payload);
    if (!allowOwnEmail) expect(json).not.toContain(BOB_EMAIL);
    expect(json).not.toContain('"password"');
    expect(json).not.toContain("$2b$");       // bcrypt hash prefix
    expect(json).not.toContain("lastReadAt");
    // Locked private keys: only ever for their owner, at login (step 16).
    expect(json).not.toContain("encryptedPrivateKey");
    expect(json).not.toContain(TEST_KEYS.encryptedPrivateKey.data);
};

let io, url, alice, bob, conversationId;
const sockets = [];

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;

    alice = await registerAndLogin("alice_test");
    bob = await registerAndLogin("bobby_test");
    conversationId = (await request(app).post("/api/conversations").set("Cookie", bob.cookie).send({ otherUserId: alice.id }))
        .body.conversation._id;
});
afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    io.close();
    await disconnectTestDb();
});

const connectAs = (user) =>
    new Promise((resolve) => {
        const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false });
        sockets.push(socket);
        socket.on("connect", () => resolve(socket));
    });

describe("what alice can see about bob", () => {
    it("REST responses never contain bob's email, password hash or read times", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        await b.timeout(2000).emitWithAck("sendMessage", { conversationId, content: "hi alice" });
        // Bob reads, so the conversation now stores his lastReadAt.
        await b.timeout(2000).emitWithAck("markRead", conversationId);
        a.disconnect();

        const responses = await Promise.all([
            request(app).get("/api/conversations").set("Cookie", alice.cookie),
            request(app).post("/api/conversations").set("Cookie", alice.cookie).send({ otherUserId: bob.id }),
            request(app).get("/api/users/search?q=bob").set("Cookie", alice.cookie),
            request(app).get(`/api/conversations/${conversationId}/messages`).set("Cookie", alice.cookie),
        ]);
        for (const res of responses) {
            expect(res.status).toBe(200);
            expectNothingPrivate(res.body);
        }
    });

    it("conversation participants carry only public fields", async () => {
        const res = await request(app).get("/api/conversations").set("Cookie", alice.cookie);
        for (const participant of res.body.conversations[0].participants) {
            expect(Object.keys(participant).sort()).toEqual(["_id", "avatar", "state", "username"]);
        }
    });

    it("socket events and acks are clean too", async () => {
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        await a.timeout(2000).emitWithAck("joinConversation", conversationId);
        const received = [];
        for (const event of ["newMessage", "conversationUpdated", "conversationRead"]) {
            a.on(event, (payload) => received.push(payload));
        }

        const ack = await b.timeout(2000).emitWithAck("sendMessage", { conversationId, content: "socket check" });
        await a.timeout(2000).emitWithAck("markRead", conversationId);
        await new Promise((resolve) => setTimeout(resolve, 200));

        expect(received.length).toBeGreaterThanOrEqual(3);
        expectNothingPrivate(received);
        expectNothingPrivate(ack);
    });
});

describe("a user's own data", () => {
    it("login, /me, register and profile update return the user's own email but never the password", async () => {
        const responses = await Promise.all([
            request(app).post("/api/auth/login").send({ identifier: "bobby_test", password: PASSWORD }),
            request(app).get("/api/auth/me").set("Cookie", bob.cookie),
            request(app).patch("/api/users/me").set("Cookie", bob.cookie).send({ bio: "hello" }),
            request(app).post("/api/users").send({ username: "newbie", email: "newbie@test.dev", password: PASSWORD, state: "goa", ...TEST_KEYS }),
        ]);
        for (const res of responses) {
            expect(res.status).toBeLessThan(300);
            expectNothingPrivate(res.body, { allowOwnEmail: true });
        }
    });
});

describe("model safety nets (toJSON)", () => {
    it("a user loaded WITH the password hash still serializes without it", async () => {
        const user = await User.findById(bob.id).select("+password");
        expect(user.password).toMatch(/^\$2b\$/);          // the server can use it...
        expect(JSON.stringify(user)).not.toContain("$2b$"); // ...but it never leaves as JSON
    });

    it("a conversation serializes without lastReadAt, while the server can still read it", async () => {
        const conversation = await Conversation.findById(conversationId);
        expect(conversation.lastReadAt.get(bob.id)).toBeInstanceOf(Date);
        expect(JSON.stringify(conversation)).not.toContain("lastReadAt");
    });
});
