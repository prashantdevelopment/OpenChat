import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../src/app.js";
import Message from "../src/models/message.model.js";
import Conversation from "../src/models/conversation.model.js";
import { connectTestDb, disconnectTestDb, encrypted, readText, registerAndLogin } from "./helpers.js";

let alice, bob, carol, conversationId, tiesConversationId;
const TOTAL = 120;

beforeAll(async () => {
    await connectTestDb();
    // The test database was just dropped, so make sure the schema indexes exist.
    await Promise.all([Message.createIndexes(), Conversation.createIndexes()]);

    alice = await registerAndLogin("alice_test");
    bob = await registerAndLogin("bobby_test");
    carol = await registerAndLogin("carol_test");
    const create = async (user, other) =>
        (await request(app).post("/api/conversations").set("Cookie", user.cookie).send({ otherUserId: other.id }))
            .body.conversation._id;
    conversationId = await create(alice, bob);
    tiesConversationId = await create(alice, carol);

    // 120 messages, one second apart: "m1" is the oldest, "m120" the newest.
    const start = Date.now() - TOTAL * 1000;
    await Message.insertMany(
        Array.from({ length: TOTAL }, (_, i) => ({
            conversationId,
            sender: i % 2 ? alice.id : bob.id,
            ...encrypted(`m${i + 1}`),
            createdAt: new Date(start + i * 1000),
        })),
    );
    // 7 messages with the exact same timestamp, to test the _id tie-breaker.
    const sameTime = new Date();
    await Message.insertMany(
        Array.from({ length: 7 }, (_, i) => ({
            conversationId: tiesConversationId,
            sender: carol.id,
            ...encrypted(`tie${i + 1}`),
            createdAt: sameTime,
        })),
    );
});
afterAll(disconnectTestDb);

const getPage = (id, query = {}, user = alice) =>
    request(app).get(`/api/conversations/${id}/messages`).query(query).set("Cookie", user.cookie);
const contents = (res) => res.body.messages.map(readText);

describe("GET /api/conversations/:id/messages (pagination)", () => {
    it("returns the newest 50, oldest first, and says there is more", async () => {
        const res = await getPage(conversationId);
        expect(res.status).toBe(200);
        expect(res.body.messages).toHaveLength(50);
        expect(contents(res)[0]).toBe("m71");
        expect(contents(res).at(-1)).toBe("m120");
        expect(res.body.hasMore).toBe(true);
    });

    it("walks back through every page: each message exactly once, in order", async () => {
        const seen = [];
        let before;
        let pages = 0;
        do {
            const res = await getPage(conversationId, before ? { before } : {});
            expect(res.status).toBe(200);
            seen.unshift(...contents(res));
            before = res.body.messages[0]?._id;
            pages++;
            if (!res.body.hasMore) break;
        } while (pages < 10);

        expect(pages).toBe(3); // 50 + 50 + 20
        expect(seen).toEqual(Array.from({ length: TOTAL }, (_, i) => `m${i + 1}`));
    });

    it("respects a custom limit", async () => {
        const res = await getPage(conversationId, { limit: 5 });
        expect(contents(res)).toEqual(["m116", "m117", "m118", "m119", "m120"]);
        expect(res.body.hasMore).toBe(true);
    });

    it("says hasMore: false on the last page", async () => {
        const first = await getPage(conversationId, { limit: 100 });
        const last = await getPage(conversationId, { limit: 100, before: first.body.messages[0]._id });
        expect(contents(last)).toHaveLength(20);
        expect(last.body.hasMore).toBe(false);
    });

    it("does not skip or repeat messages that share a timestamp", async () => {
        const seen = [];
        let before;
        for (let i = 0; i < 10; i++) {
            const res = await getPage(tiesConversationId, { limit: 2, ...(before ? { before } : {}) });
            seen.unshift(...contents(res));
            before = res.body.messages[0]?._id;
            if (!res.body.hasMore) break;
        }
        expect(seen.sort()).toEqual(["tie1", "tie2", "tie3", "tie4", "tie5", "tie6", "tie7"]);
    });

    it.each([
        ["0", "0"],
        ["101", "101"],
        ["not a number", "abc"],
        ["a fraction", "2.5"],
    ])("rejects limit=%s with 400", async (_name, limit) => {
        expect((await getPage(conversationId, { limit })).status).toBe(400);
    });

    it("rejects an invalid 'before' id with 400", async () => {
        expect((await getPage(conversationId, { before: "bad-id" })).status).toBe(400);
    });

    it("rejects a 'before' message from another conversation", async () => {
        const other = await getPage(tiesConversationId, { limit: 1 });
        const res = await getPage(conversationId, { before: other.body.messages[0]._id });
        expect(res.status).toBe(400);
    });

    it("still forbids outsiders", async () => {
        expect((await getPage(conversationId, {}, carol)).status).toBe(403);
    });
});

describe("indexes (explain)", () => {
    // Stringify the plan so the check works for both query engines' plan shapes.
    const planOf = async (query) => JSON.stringify((await query.explain("queryPlanner")).queryPlanner?.winningPlan ?? {});

    it("history page uses the message index, with no in-memory sort", async () => {
        const plan = await planOf(
            Message.find({ conversationId: new mongoose.Types.ObjectId(conversationId) })
                .sort({ createdAt: -1, _id: -1 })
                .limit(51),
        );
        expect(plan).toContain("conversationId_1_createdAt_-1__id_-1");
        expect(plan).not.toContain("COLLSCAN");
        expect(plan).not.toContain('"stage":"SORT"');
    });

    it("unread count query uses the message index", async () => {
        const plan = await planOf(
            Message.find({
                conversationId: new mongoose.Types.ObjectId(conversationId),
                sender: { $ne: new mongoose.Types.ObjectId(alice.id) },
                createdAt: { $gt: new Date(Date.now() - 10_000) },
            }),
        );
        expect(plan).toContain("conversationId_1_createdAt_-1__id_-1");
        expect(plan).not.toContain("COLLSCAN");
    });

    it("conversation list uses the participants index, with no in-memory sort", async () => {
        const plan = await planOf(
            Conversation.find({ participants: new mongoose.Types.ObjectId(alice.id) }).sort({ lastMessageAt: -1 }),
        );
        expect(plan).toContain("participants_1_lastMessageAt_-1");
        expect(plan).not.toContain("COLLSCAN");
        expect(plan).not.toContain('"stage":"SORT"');
    });
});
