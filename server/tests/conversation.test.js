import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { connectTestDb, disconnectTestDb, registerAndLogin } from "./helpers.js";

let alice, bob, carol;

beforeAll(async () => {
    await connectTestDb();
    alice = await registerAndLogin("alice_test");
    bob = await registerAndLogin("bobby_test");
    carol = await registerAndLogin("carol_test");
});
afterAll(disconnectTestDb);

const createConversation = (user, otherUserId) =>
    request(app).post("/api/conversations").set("Cookie", user.cookie).send({ otherUserId });

describe("POST /api/conversations", () => {
    it("requires login", async () => {
        expect((await request(app).post("/api/conversations").send({ otherUserId: bob.id })).status).toBe(401);
    });

    it.each([
        ["missing otherUserId", undefined, 400],
        ["an invalid id", "bad-id", 400],
        ["an object id (injection attempt)", { $gt: "" }, 400],
        ["an unknown user", "64b000000000000000000000", 404],
    ])("rejects %s", async (_name, otherUserId, status) => {
        const res = await createConversation(alice, otherUserId);
        expect(res.status).toBe(status);
        expect(res.body.success).toBe(false);
    });

    it("rejects a conversation with yourself", async () => {
        expect((await createConversation(alice, alice.id)).status).toBe(400);
    });

    it("handles two simultaneous creates: both succeed with the same conversation", async () => {
        const dave = await registerAndLogin("dave_test");
        const eve = await registerAndLogin("eve_test");
        const results = await Promise.all([
            createConversation(dave, eve.id),
            createConversation(eve, dave.id),
            createConversation(dave, eve.id),
        ]);
        expect(results.map((res) => res.status)).toEqual([200, 200, 200]);
        expect(new Set(results.map((res) => res.body.conversation._id)).size).toBe(1);
    });

    it("returns the same conversation no matter who creates it (no duplicates)", async () => {
        const fromAlice = await createConversation(alice, bob.id);
        const fromBob = await createConversation(bob, alice.id);
        expect(fromAlice.status).toBe(200);
        expect(fromBob.body.conversation._id).toBe(fromAlice.body.conversation._id);
    });
});

describe("GET /api/conversations", () => {
    it("lists only the user's own conversations, with participants populated", async () => {
        const res = await request(app).get("/api/conversations").set("Cookie", alice.cookie);
        expect(res.status).toBe(200);
        expect(res.body.conversations).toHaveLength(1);
        const usernames = res.body.conversations[0].participants.map((p) => p.username).sort();
        expect(usernames).toEqual(["alice_test", "bobby_test"]);

        const carolsList = await request(app).get("/api/conversations").set("Cookie", carol.cookie);
        expect(carolsList.body.conversations).toHaveLength(0);
    });
});

describe("GET /api/conversations/:id/messages", () => {
    let conversationId;
    beforeAll(async () => {
        conversationId = (await createConversation(alice, bob.id)).body.conversation._id;
    });

    const getMessages = (user, id) =>
        request(app).get(`/api/conversations/${id}/messages`).set("Cookie", user.cookie);

    it("lets a participant read the history", async () => {
        const res = await getMessages(bob, conversationId);
        expect(res.status).toBe(200);
        expect(res.body.messages).toEqual([]);
    });

    it("forbids a non-participant (403)", async () => {
        expect((await getMessages(carol, conversationId)).status).toBe(403);
    });

    it("rejects an invalid id with 400", async () => {
        expect((await getMessages(alice, "bad-id")).status).toBe(400);
    });

    it("returns 404 for an unknown conversation", async () => {
        expect((await getMessages(alice, "64b000000000000000000000")).status).toBe(404);
    });
});
