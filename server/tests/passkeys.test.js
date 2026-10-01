import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomBytes } from "crypto";
import mongoose from "mongoose";
import request from "supertest";
import app from "../src/app.js";
import User from "../src/models/user.model.js";
import { MAX_PASSKEYS } from "../src/services/passkey.service.js";
import { connectTestDb, disconnectTestDb, registerAndLogin } from "./helpers.js";

// Passkey copies of the locked private key (step 79): only the user can add,
// list and remove theirs; the server only stores well-formed copies and never
// hands them out anywhere else.
let alice, bob;

const api = (user) => ({
    get: (path) => request(app).get(path).set("Cookie", user.cookie),
    post: (path, body) => request(app).post(path).set("Cookie", user.cookie).send(body),
    del: (path) => request(app).delete(path).set("Cookie", user.cookie),
});
const b64 = (bytes) => randomBytes(bytes).toString("base64");
const passkey = (extra = {}) => ({ credentialId: b64(32), salt: b64(32), data: b64(138), iv: b64(12), ...extra });
const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const PIXEL = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const addFrom = (user, userAgent, body) => request(app).post("/api/users/me/passkeys").set("Cookie", user.cookie).set("User-Agent", userAgent).send(body);
const list = async (user) => (await api(user).get("/api/users/me/passkeys").expect(200)).body.passkeys;

beforeAll(async () => {
    await connectTestDb();
    [alice, bob] = await Promise.all(["alice_pk", "bob_pk"].map(registerAndLogin));
});
afterAll(disconnectTestDb);
beforeEach(() => User.updateMany({}, { $set: { passkeyKeys: [] } }));

describe("passkey copies of the private key", () => {
    it("alice adds one: stored as sent, named after her device, listed for her", async () => {
        const sent = passkey();
        const { passkey: added } = (await addFrom(alice, EDGE, sent).expect(201)).body;
        expect(added).toMatchObject({ ...sent, name: "Edge on Windows" });
        expect(added._id).toBeTruthy();
        expect(await list(alice)).toEqual([expect.objectContaining({ ...sent, name: "Edge on Windows", _id: added._id })]);
    });

    it("the device name comes from the device, never from what is sent", async () => {
        const { passkey: added } = (await addFrom(alice, PIXEL, passkey({ name: "<b>Bank of India</b>" })).expect(201)).body;
        expect(added.name).toBe("Chrome on Android");
    });

    it("only well-formed copies: wrong sizes are refused", async () => {
        for (const bad of [
            { credentialId: "not base64!" },
            { credentialId: b64(8) },
            { salt: b64(16) },
            { iv: b64(16) },
            { data: b64(8) },
            { data: b64(600) },
        ]) {
            const res = await api(alice).post("/api/users/me/passkeys", passkey(bad));
            expect(res.status, JSON.stringify(bad).slice(0, 40)).toBe(400);
        }
        expect(await list(alice)).toEqual([]);
    });

    it("the same passkey can't be added twice", async () => {
        const sent = passkey();
        await api(alice).post("/api/users/me/passkeys", sent).expect(201);
        await api(alice).post("/api/users/me/passkeys", { ...sent, salt: b64(32) }).expect(409);
        expect(await list(alice)).toHaveLength(1);
    });

    it(`at most ${MAX_PASSKEYS} devices`, async () => {
        for (let i = 0; i < MAX_PASSKEYS; i++) await api(alice).post("/api/users/me/passkeys", passkey()).expect(201);
        const res = await api(alice).post("/api/users/me/passkeys", passkey()).expect(409);
        expect(res.body.message).toMatch(/Remove one first/);
    });

    it("removing one: gone from the list; again, or a bad id, is refused", async () => {
        const { passkey: added } = (await api(alice).post("/api/users/me/passkeys", passkey()).expect(201)).body;
        await addFrom(alice, PIXEL, passkey()).expect(201);
        await api(alice).del(`/api/users/me/passkeys/${added._id}`).expect(200);
        expect((await list(alice)).map((key) => key.name)).toEqual(["Chrome on Android"]);
        await api(alice).del(`/api/users/me/passkeys/${added._id}`).expect(404);
        await api(alice).del("/api/users/me/passkeys/not-an-id").expect(400);
    });

    it("each person only ever sees and removes their own", async () => {
        const { passkey: added } = (await api(alice).post("/api/users/me/passkeys", passkey()).expect(201)).body;
        expect(await list(bob)).toEqual([]);
        await api(bob).del(`/api/users/me/passkeys/${added._id}`).expect(404);
        expect(await list(alice)).toHaveLength(1);
    });

    it("never in any other response: not in /auth/me, not on her profile, not in search", async () => {
        const sent = passkey();
        await api(alice).post("/api/users/me/passkeys", sent).expect(201);
        const responses = [
            (await api(alice).get("/api/auth/me").expect(200)).body,
            (await api(bob).get("/api/users/alice_pk").expect(200)).body,
            (await api(bob).get("/api/users/search").query({ q: "alice" }).expect(200)).body,
        ];
        for (const body of responses) {
            expect(JSON.stringify(body)).not.toContain(sent.data);
            expect(JSON.stringify(body)).not.toContain("passkeyKeys");
        }
    });

    it("logged out: nothing", async () => {
        await request(app).get("/api/users/me/passkeys").expect(401);
        await request(app).post("/api/users/me/passkeys").send(passkey()).expect(401);
        await request(app).delete(`/api/users/me/passkeys/${new mongoose.Types.ObjectId()}`).expect(401);
    });
});
