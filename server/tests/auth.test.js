import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { PASSWORD, connectTestDb, disconnectTestDb, registerAndLogin } from "./helpers.js";

// Every error response must look the same: { success: false, message }.
const expectError = (res, status) => {
    expect(res.status).toBe(status);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.message).toBe("string");
};

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

describe("POST /api/users (register)", () => {
    const register = (body) => request(app).post("/api/users").send(body);

    it("creates a user and never returns the password", async () => {
        const res = await register({ username: "alice_test", email: "alice@test.dev", password: PASSWORD });
        expect(res.status).toBe(201);
        expect(res.body.createdUser.username).toBe("alice_test");
        expect(res.body.createdUser.password).toBeUndefined();
    });

    it("rejects a duplicate username with 409", async () => {
        expectError(await register({ username: "alice_test", email: "other@test.dev", password: PASSWORD }), 409);
    });

    it("reports which field failed model validation", async () => {
        const res = await register({ username: "carol_test", email: "not-an-email", password: PASSWORD });
        expectError(res, 400);
        expect(res.body.errors.email).toBeTypeOf("string");
    });

    describe("password policy", () => {
        let n = 0;
        const tryPassword = (password) =>
            register({ username: `policy_user${n++}`, email: `policy${n}@test.dev`, password });

        it.each([
            ["missing", undefined, /required/],
            ["not a string", { $ne: null }, /required/],
            ["shorter than 8", "Abc@123", /at least 8/],
            ["longer than 64", "a".repeat(65), /too long/],
            ["over bcrypt's 72-byte limit", "😀".repeat(30), /too long/],
            ["common", "password123", /too common/],
            ["common, other case", "PASSWORD123", /too common/],
        ])("rejects a %s password", async (_name, password, message) => {
            const res = await tryPassword(password);
            expectError(res, 400);
            expect(res.body.message).toMatch(message);
        });

        it.each([
            ["plain letters and digits", "Plain8chars"],
            ["a passphrase with spaces", "chai aur samosa at 5pm"],
            ["any symbols", "#hash!Pass$"],
            ["exactly 64 characters", "b".repeat(64)],
            ["Hindi", "मेरा पासवर्ड"],
        ])("accepts %s", async (_name, password) => {
            expect((await tryPassword(password)).status).toBe(201);
        });
    });
});

describe("POST /api/auth/login", () => {
    const login = (body) => request(app).post("/api/auth/login").send(body);

    it("logs in case-insensitively and sets an httpOnly cookie", async () => {
        const res = await login({ identifier: "ALICE_TEST", password: PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.user.password).toBeUndefined();
        expect(res.headers["set-cookie"][0]).toMatch(/token=.+HttpOnly/);
    });

    it("logs in with email too", async () => {
        expect((await login({ identifier: "alice@test.dev", password: PASSWORD })).status).toBe(200);
    });

    it("gives the same 401 for a wrong password and an unknown user", async () => {
        const wrongPassword = await login({ identifier: "alice_test", password: "Wrong@1234" });
        const unknownUser = await login({ identifier: "nobody_here", password: PASSWORD });
        expectError(wrongPassword, 401);
        expectError(unknownUser, 401);
        expect(wrongPassword.body.message).toBe(unknownUser.body.message);
    });

    it.each([
        ["an empty body", {}],
        ["an object identifier (NoSQL injection)", { identifier: { $ne: null }, password: PASSWORD }],
        ["an object password", { identifier: "alice_test", password: { $ne: null } }],
    ])("rejects %s with 400", async (_name, body) => {
        expectError(await login(body), 400);
    });

    it("rejects a request without any body with 400", async () => {
        expectError(await request(app).post("/api/auth/login"), 400);
    });

    it("rejects malformed JSON with 400", async () => {
        const res = await request(app)
            .post("/api/auth/login")
            .set("Content-Type", "application/json")
            .send('{"identifier": ');
        expectError(res, 400);
    });
});

describe("session: /api/auth/me and logout", () => {
    it("returns 401 without a cookie", async () => {
        expectError(await request(app).get("/api/auth/me"), 401);
    });

    it("returns 401 for a forged token", async () => {
        expectError(await request(app).get("/api/auth/me").set("Cookie", "token=abc.def.ghi"), 401);
    });

    it("returns the current user with a valid cookie", async () => {
        const { cookie } = await registerAndLogin("session_user");
        const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
        expect(res.status).toBe(200);
        expect(res.body.user.username).toBe("session_user");
    });

    it("logout clears the cookie", async () => {
        const res = await request(app).post("/api/auth/logout");
        expect(res.status).toBe(200);
        expect(res.headers["set-cookie"][0]).toMatch(/token=;/);
    });
});

describe("profile and password change", () => {
    let user;
    beforeAll(async () => {
        user = await registerAndLogin("profile_user");
    });

    it("updates the bio", async () => {
        const res = await request(app).patch("/api/users/me").set("Cookie", user.cookie).send({ bio: "hello" });
        expect(res.status).toBe(200);
        expect(res.body.updatedUser.bio).toBe("hello");
    });

    it("rejects an update with no allowed fields", async () => {
        expectError(await request(app).patch("/api/users/me").set("Cookie", user.cookie).send({}), 400);
    });

    it("rejects a bio that is not a string (CastError -> 400)", async () => {
        expectError(await request(app).patch("/api/users/me").set("Cookie", user.cookie).send({ bio: { a: 1 } }), 400);
    });

    const changePassword = (body) => request(app).patch("/api/users/me/password").set("Cookie", user.cookie).send(body);

    it("requires the current password", async () => {
        expectError(await changePassword({ newPassword: "Newer@1234" }), 400);
    });

    it("rejects a wrong current password", async () => {
        expectError(await changePassword({ currentPassword: "Wrong@1234", newPassword: "Newer@1234" }), 401);
    });

    it("applies the password policy to the new password", async () => {
        expectError(await changePassword({ currentPassword: PASSWORD, newPassword: "12345678" }), 400);
    });

    it("changes the password, and the new one works for login", async () => {
        expect((await changePassword({ currentPassword: PASSWORD, newPassword: "Newer@1234" })).status).toBe(200);
        const res = await request(app).post("/api/auth/login").send({ identifier: "profile_user", password: "Newer@1234" });
        expect(res.status).toBe(200);
    });
});

describe("unknown routes", () => {
    it("return JSON 404", async () => {
        expectError(await request(app).get("/api/does-not-exist"), 404);
    });

    it("POST /api/messages was removed (messages go through the socket)", async () => {
        expectError(await request(app).post("/api/messages").send({}), 404);
    });
});
