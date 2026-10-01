import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import User from "../src/models/user.model.js";
import { DEFAULT_MAX_USERS, maxUsers } from "../src/services/signupLimit.service.js";
import { connectTestDb, disconnectTestDb, PASSWORD, TEST_KEYS } from "./helpers.js";

// At most MAX_USERS accounts for now (step 85): new sign-ups are refused once
// it is reached, everyone who has an account still logs in.
const register = (username) =>
    request(app).post("/api/users").send({ username, email: `${username}@test.dev`, password: PASSWORD, state: "delhi", ...TEST_KEYS });
const providers = async () => (await request(app).get("/api/auth/providers").expect(200)).body;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(async () => {
    delete process.env.MAX_USERS;
    await User.deleteMany({});
});

describe("the limit", () => {
    it("is 150 unless MAX_USERS says otherwise; a value that isn't a whole number above 0 is refused", () => {
        expect(DEFAULT_MAX_USERS).toBe(150);
        expect(maxUsers()).toBe(150);
        process.env.MAX_USERS = "500";
        expect(maxUsers()).toBe(500);
        for (const bad of ["abc", "0", "-5", "2.5"]) {
            process.env.MAX_USERS = bad;
            expect(() => maxUsers(), bad).toThrow(/MAX_USERS/);
        }
    });

    it("up to the limit, people sign up as usual; then a new sign-up is refused with a clear message", async () => {
        process.env.MAX_USERS = "3";
        for (const name of ["user_a", "user_b", "user_c"]) await register(name).expect(201);
        const refused = await register("user_d").expect(503);
        expect(refused.body.message).toMatch(/OpenChat is full for now: the first 3 people are in/);
        expect(await User.countDocuments()).toBe(3);
        expect(await User.exists({ username: "user_d" })).toBeNull();
    });

    it("the sign-up page knows: providers say full only once it is", async () => {
        process.env.MAX_USERS = "2";
        await register("user_a").expect(201);
        expect((await providers()).full).toBe(false);
        await register("user_b").expect(201);
        expect((await providers()).full).toBe(true);
    });

    it("everyone who has an account still logs in when it is full", async () => {
        process.env.MAX_USERS = "1";
        await register("user_a").expect(201);
        await register("user_b").expect(503);
        const login = await request(app).post("/api/auth/login").send({ identifier: "user_a", password: PASSWORD }).expect(200);
        expect(login.body.user.username).toBe("user_a");
    });

    it("two sign-ups at the very same moment never go past it", async () => {
        process.env.MAX_USERS = "2";
        await register("user_a").expect(201);
        const results = await Promise.all(["user_b", "user_c", "user_d"].map(register));
        expect(results.filter((res) => res.status === 201).length).toBeLessThanOrEqual(1);
        expect(results.filter((res) => res.status !== 201).every((res) => res.status === 503)).toBe(true);
        expect(await User.countDocuments()).toBeLessThanOrEqual(2);
    });

    it("raising the limit lets people in again", async () => {
        process.env.MAX_USERS = "1";
        await register("user_a").expect(201);
        await register("user_b").expect(503);
        process.env.MAX_USERS = "2";
        await register("user_b").expect(201);
    });
});
