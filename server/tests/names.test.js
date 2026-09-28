import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import User from "../src/models/user.model.js";
import { connectTestDb, disconnectTestDb, registerAndLogin, PASSWORD, TEST_KEYS } from "./helpers.js";

let viewer;

beforeAll(async () => {
    await connectTestDb();
    viewer = await registerAndLogin("viewer_nm");
});

afterAll(disconnectTestDb);

let count = 0;
const register = (fields) => {
    count += 1;
    const username = fields.username ?? `name_user_${count}`;
    return request(app).post("/api/users").send({ username, email: `${username}@test.dev`, password: PASSWORD, state: "delhi", ...TEST_KEYS, ...fields });
};
const update = (fields, cookie = viewer.cookie) => request(app).patch("/api/users/me").set("Cookie", cookie).send(fields);

describe("display name at registration", () => {
    it("is saved, with the spaces tidied and the letters in one Unicode form", async () => {
        // "e" followed by a combining accent (two characters) becomes one accented character.
        const res = await register({ username: "rene_d", name: "  Rene\u0301   Das  " });
        expect(res.status).toBe(201);
        expect(res.body.createdUser.name).toBe("Ren\u00E9 Das");
    });

    it("takes Hindi and other scripts", async () => {
        const res = await register({ name: "प्रशांत कुमार" });
        expect(res.status).toBe(201);
        expect(res.body.createdUser.name).toBe("प्रशांत कुमार");
    });

    it("is not unique: two people can have the same name", async () => {
        expect((await register({ name: "Aman" })).status).toBe(201);
        expect((await register({ name: "Aman" })).status).toBe(201);
    });

    it("falls back to the username when an older app sends none", async () => {
        const res = await register({ username: "old_app_user" });
        expect(res.status).toBe(201);
        expect(res.body.createdUser.name).toBe("old_app_user");
    });

    it.each([
        ["empty", ""],
        ["only spaces", "   "],
        ["no letter or number", "!!! ..."],
        ["longer than 40 characters", "a".repeat(41)],
        ["a zero-width space", "Riya\u200BNair"],
        ["a right-to-left override", "Riya\u202Egnp.exe"],
        ["a control character", "Riya\u0007"],
    ])("refuses a name that is %s", async (_label, name) => {
        const res = await register({ name });
        expect(res.status).toBe(400);
        expect(res.body.errors.name).toMatch(/name/i);
    });

    it.each([["null", null], ["a number", 42], ["an object", { $gt: "" }]])("refuses a name that is %s", async (_label, name) => {
        const res = await register({ name });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe("Name must be text");
    });
});

describe("changing the name", () => {
    it("works from settings", async () => {
        const res = await update({ name: "Viewer  Sharma " });
        expect(res.status).toBe(200);
        expect(res.body.updatedUser.name).toBe("Viewer Sharma");
        expect((await User.findById(viewer.id)).name).toBe("Viewer Sharma");
    });

    it("can't be emptied, hidden or turned into something that isn't text", async () => {
        for (const name of ["", "  ", "\u200B", null, 7]) {
            expect((await update({ name })).status).toBe(400);
        }
        expect((await User.findById(viewer.id)).name).toBe("Viewer Sharma");
    });
});

describe("where the name appears", () => {
    let priya;
    beforeAll(async () => {
        priya = await registerAndLogin("priya_nm");
        await update({ name: "Priya Menon" }, priya.cookie);
    });

    it("in search results and the public profile, next to the username", async () => {
        const search = await request(app).get("/api/users/search").query({ q: "priya_" }).set("Cookie", viewer.cookie);
        expect(search.body.users).toEqual([expect.objectContaining({ username: "priya_nm", name: "Priya Menon" })]);
        const profile = await request(app).get("/api/users/priya_nm").set("Cookie", viewer.cookie);
        expect(profile.body.user).toMatchObject({ username: "priya_nm", name: "Priya Menon" });
    });

    it("in a conversation's participants", async () => {
        await request(app).post("/api/conversations").set("Cookie", viewer.cookie).send({ otherUserId: priya.id }).expect(200);
        const list = await request(app).get("/api/conversations").set("Cookie", viewer.cookie).expect(200);
        const other = list.body.conversations[0].participants.find((p) => p.username === "priya_nm");
        expect(other.name).toBe("Priya Menon");
    });

    it("but people are found by username only, never by name (names repeat)", async () => {
        const byName = await request(app).get("/api/users/search").query({ q: "Priya Menon" }).set("Cookie", viewer.cookie);
        expect(byName.status).toBe(200);
        expect(byName.body.users).toEqual([]);
        const byNameStart = await request(app).get("/api/users/search").query({ q: "menon" }).set("Cookie", viewer.cookie);
        expect(byNameStart.body.users).toEqual([]);
    });
});
