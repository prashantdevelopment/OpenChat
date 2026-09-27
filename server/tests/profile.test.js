import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import User from "../src/models/user.model.js";
import { connectTestDb, disconnectTestDb, registerAndLogin } from "./helpers.js";

let viewer;

beforeAll(async () => {
    await connectTestDb();
    viewer = await registerAndLogin("viewer_1");
    const priya = await registerAndLogin("priya.k");
    await User.updateOne({ _id: priya.id }, { bio: "Loves filter coffee", state: "kerala", discoverable: false });
});

afterAll(disconnectTestDb);

const profile = (username, cookie = viewer.cookie) => request(app).get(`/api/users/${encodeURIComponent(username)}`).set("Cookie", cookie);

describe("GET /api/users/:username (public profile)", () => {
    it("needs a login", async () => {
        expect((await request(app).get("/api/users/priya.k")).status).toBe(401);
    });

    it("returns only public fields: username, bio, state, avatar, public key", async () => {
        const res = await profile("priya.k");
        expect(res.status).toBe(200);
        expect(res.body.user).toMatchObject({ username: "priya.k", bio: "Loves filter coffee", state: "kerala" });
        expect(res.body.user.publicKey).toBeTruthy();
        for (const secret of ["email", "password", "encryptedPrivateKey", "readReceipts", "discoverable", "lastSeen"]) {
            expect(res.body.user).not.toHaveProperty(secret);
        }
    });

    it("finds people who are hidden from Discover too (like search does)", async () => {
        expect((await profile("priya.k")).status).toBe(200);
    });

    it("ignores upper case in the address", async () => {
        expect((await profile("Priya.K")).body.user.username).toBe("priya.k");
    });

    it("unknown or impossible usernames: 404, not a regex match", async () => {
        expect((await profile("nobody_here")).status).toBe(404);
        expect((await profile("priya.*")).status).toBe(404);
        expect((await profile("p".repeat(31))).status).toBe(404);
    });

    it("does not shadow /users/search and /users/discover", async () => {
        expect((await request(app).get("/api/users/search?q=pri").set("Cookie", viewer.cookie)).body.users.map((u) => u.username)).toContain("priya.k");
        expect((await request(app).get("/api/users/discover?state=kerala").set("Cookie", viewer.cookie)).status).toBe(200);
    });
});
