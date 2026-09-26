import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import User from "../src/models/user.model.js";
import { TEST_KEYS, connectTestDb, disconnectTestDb, registerAndLogin } from "./helpers.js";

let rahul;

beforeAll(async () => {
    await connectTestDb();
    rahul = await registerAndLogin("rahul_k");
    await registerAndLogin("rahul.sharma");
    await registerAndLogin("raj_99");
    await registerAndLogin("priya");
    // 25 users with the same prefix, inserted directly (fast) to test the limit.
    await User.insertMany(
        Array.from({ length: 25 }, (_, i) => ({
            username: `zed_user_${String(i).padStart(2, "0")}`,
            email: `zed${i}@test.dev`,
            password: "not-a-real-hash",
            state: "goa",
            ...TEST_KEYS,
        })),
    );
});
afterAll(disconnectTestDb);

const search = (q, cookie = rahul.cookie) =>
    request(app).get("/api/users/search").query(q === undefined ? {} : { q }).set("Cookie", cookie);
const usernames = (res) => res.body.users.map((user) => user.username);

describe("GET /api/users/search", () => {
    it("requires login", async () => {
        expect((await request(app).get("/api/users/search?q=ra")).status).toBe(401);
    });

    it("finds users whose username starts with the query, sorted", async () => {
        const res = await search("ra");
        expect(res.status).toBe(200);
        expect(usernames(res)).toEqual(["rahul.sharma", "raj_99"]);
    });

    it("never returns the searching user", async () => {
        expect(usernames(await search("rahul"))).toEqual(["rahul.sharma"]);
    });

    it("is case-insensitive and ignores surrounding spaces", async () => {
        expect(usernames(await search("  PRI "))).toEqual(["priya"]);
    });

    it("matches from the start only", async () => {
        expect(usernames(await search("iya"))).toEqual([]);
    });

    it("returns only public fields (no email, no password)", async () => {
        const [user] = (await search("priya")).body.users;
        expect(Object.keys(user).sort()).toEqual(["_id", "avatar", "publicKey", "state", "username"]);
    });

    it("returns at most 20 users", async () => {
        const res = await search("zed_user");
        expect(res.body.users).toHaveLength(20);
        expect(res.body.users[0].username).toBe("zed_user_00");
    });

    it.each([
        ["'.' as a wildcard", "."],
        ["'.*' as match-everything", ".*"],
        ["a catastrophic pattern", "(a+)+$"],
        ["a broken pattern", "[("],
    ])("treats regex characters literally: %s", async (_name, q) => {
        const res = await search(q);
        expect(res.status).toBe(200);
        expect(res.body.users).toEqual([]);
    });

    it("still finds usernames that contain a dot", async () => {
        expect(usernames(await search("rahul."))).toEqual(["rahul.sharma"]);
    });

    it.each([
        ["missing", undefined],
        ["empty", "   "],
        ["too long", "a".repeat(31)],
    ])("rejects a %s query with 400", async (_name, q) => {
        const res = await search(q);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("rejects a repeated query parameter (array) with 400", async () => {
        const res = await request(app).get("/api/users/search?q=ra&q=pr").set("Cookie", rahul.cookie);
        expect(res.status).toBe(400);
    });
});
