import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import request from "supertest";
import app from "../src/app.js";
import Session from "../src/models/session.model.js";
import { describeDevice } from "../src/session.js";
import { connectTestDb, disconnectTestDb, registerAndLogin, PASSWORD } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const WINDOWS_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0";

beforeAll(async () => {
    await connectTestDb();
    await registerAndLogin("sam_sess");
    await registerAndLogin("other_sess");
});
afterAll(disconnectTestDb);

const login = (username, { remember, ua = ANDROID } = {}) =>
    request(app).post("/api/auth/login").set("User-Agent", ua).send({ identifier: username, password: PASSWORD, ...(remember === undefined ? {} : { remember }) });
const cookieOf = (res) => (res.headers["set-cookie"] ?? []).find((c) => c.startsWith("token="));
const tokenOf = (res) => cookieOf(res).split(";")[0].slice("token=".length);
const sessionOf = (token) => Session.findOne({ tokenHash: createHash("sha256").update(token).digest("hex") });
const me = (token) => request(app).get("/api/auth/me").set("Cookie", `token=${token}`);

describe("staying logged in (like Instagram)", () => {
    it("'keep me logged in' (the default): a 60-day cookie, a session for 60 idle days, at most a year", async () => {
        const res = await login("sam_sess");
        expect(res.status).toBe(200);
        expect(cookieOf(res)).toMatch(/Max-Age=5184000/); // 60 days
        expect(cookieOf(res)).toMatch(/HttpOnly/);
        expect(cookieOf(res)).toMatch(/SameSite=Strict/);
        const session = await sessionOf(tokenOf(res));
        expect(session.remember).toBe(true);
        expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(59.9 * DAY);
        expect(session.absoluteExpiresAt.getTime() - Date.now()).toBeGreaterThan(364.9 * DAY);
    });

    it("without it (a shared computer): a browser-session cookie and at most a day", async () => {
        const res = await login("sam_sess", { remember: false });
        expect(cookieOf(res)).not.toMatch(/Max-Age|Expires/);
        const session = await sessionOf(tokenOf(res));
        expect(session.remember).toBe(false);
        expect(session.absoluteExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(DAY);
    });

    it("only a hash of the token is stored", async () => {
        const token = tokenOf(await login("sam_sess"));
        const raw = await Session.findOne({}).lean();
        expect(JSON.stringify(await Session.find({}).lean())).not.toContain(token);
        expect(raw.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("used again after a day: renewed for another 60 days, and the cookie is sent again", async () => {
        const token = tokenOf(await login("sam_sess"));
        const session = await sessionOf(token);
        await Session.updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date(Date.now() - 20 * DAY), expiresAt: new Date(Date.now() + 40 * DAY) } });
        const res = await me(token);
        expect(res.status).toBe(200);
        expect(cookieOf(res)).toMatch(/Max-Age=5184000/);
        const renewed = await sessionOf(token);
        expect(renewed.expiresAt.getTime() - Date.now()).toBeGreaterThan(59.9 * DAY);
        expect(Date.now() - renewed.lastUsedAt.getTime()).toBeLessThan(60_000);
    });

    it("used again within a day: nothing written, no cookie sent (at most one renewal a day)", async () => {
        const token = tokenOf(await login("sam_sess"));
        const before = await sessionOf(token);
        const res = await me(token);
        expect(cookieOf(res)).toBeUndefined();
        expect((await sessionOf(token)).expiresAt.getTime()).toBe(before.expiresAt.getTime());
    });

    it("never past the one-year limit, however much it is used", async () => {
        const token = tokenOf(await login("sam_sess"));
        const session = await sessionOf(token);
        const hardEnd = new Date(Date.now() + 5 * DAY);
        await Session.updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date(Date.now() - 2 * DAY), absoluteExpiresAt: hardEnd, expiresAt: hardEnd } });
        await me(token).expect(200);
        expect((await sessionOf(token)).expiresAt.getTime()).toBe(hardEnd.getTime());
    });

    it("60 days without using it: logged out", async () => {
        const token = tokenOf(await login("sam_sess"));
        await Session.updateOne({ _id: (await sessionOf(token))._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        const res = await me(token);
        expect(res.status).toBe(401);
        expect(res.body.message).toBe("Invalid or expired token");
    });

    it("logging out deletes the session (it holds after a server restart: nothing kept in memory)", async () => {
        const token = tokenOf(await login("sam_sess"));
        await request(app).post("/api/auth/logout").set("Cookie", `token=${token}`).expect(200);
        expect(await sessionOf(token)).toBeNull();
        await me(token).expect(401);
    });

    it("the same for Google sign-in: ?remember=0 is carried through the Google round trip", async () => {
        // (Only the start is reachable without Google set up in this file; the round trip is in google.test.js.)
        expect((await request(app).get("/api/auth/google").query({ remember: "0" })).status).toBe(404);
    });
});

describe("where you're logged in (Settings)", () => {
    let phone, laptop, other;
    beforeAll(async () => {
        await Session.deleteMany({});
        phone = tokenOf(await login("sam_sess", { ua: ANDROID }));
        laptop = tokenOf(await login("sam_sess", { ua: WINDOWS_EDGE }));
        other = tokenOf(await login("other_sess"));
    });

    it("lists the user's own sessions, this device first, the current one marked, no tokens", async () => {
        const res = await request(app).get("/api/auth/sessions").set("Cookie", `token=${phone}`);
        expect(res.status).toBe(200);
        expect(res.body.sessions.map((s) => [s.device, s.current])).toEqual([["Chrome on Android", true], ["Edge on Windows", false]]);
        expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|token/);
        expect(JSON.stringify(res.body)).not.toContain(phone);
    });

    it("needs a login", async () => {
        await request(app).get("/api/auth/sessions").expect(401);
    });

    it("can't end someone else's session", async () => {
        const theirs = (await sessionOf(other))._id;
        expect((await request(app).delete(`/api/auth/sessions/${theirs}`).set("Cookie", `token=${phone}`)).status).toBe(404);
        await me(other).expect(200);
    });

    it("'Log out' next to a device ends only that one", async () => {
        const laptopId = (await sessionOf(laptop))._id;
        await request(app).delete(`/api/auth/sessions/${laptopId}`).set("Cookie", `token=${phone}`).expect(200);
        await me(laptop).expect(401);
        await me(phone).expect(200);
        expect((await request(app).delete(`/api/auth/sessions/${laptopId}`).set("Cookie", `token=${phone}`)).status).toBe(404);
    });

    it("'Log out of all other devices' keeps this one", async () => {
        const a = tokenOf(await login("sam_sess"));
        const b = tokenOf(await login("sam_sess"));
        const res = await request(app).post("/api/auth/sessions/end-others").set("Cookie", `token=${phone}`);
        expect(res.body.ended).toBe(2);
        await me(a).expect(401);
        await me(b).expect(401);
        await me(phone).expect(200);
        await me(other).expect(200); // other people are untouched
    });

    it("ending the current session logs out (the cookie is cleared)", async () => {
        const id = (await sessionOf(phone))._id;
        const res = await request(app).delete(`/api/auth/sessions/${id}`).set("Cookie", `token=${phone}`);
        expect(res.status).toBe(200);
        expect(cookieOf(res)).toMatch(/token=;/);
        await me(phone).expect(401);
    });

    it("a malformed session id is a clean 400", async () => {
        const token = tokenOf(await login("sam_sess"));
        expect((await request(app).delete("/api/auth/sessions/not-an-id").set("Cookie", `token=${token}`)).status).toBe(400);
    });
});

describe("device names", () => {
    it.each([
        [ANDROID, "Chrome on Android"],
        [WINDOWS_EDGE, "Edge on Windows"],
        ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari on iPhone"],
        ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Gecko/20100101 Firefox/131.0", "Firefox on Mac"],
        ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36", "Samsung Internet on Android"],
        ["", "Browser"],
    ])("%#: %s", (ua, name) => {
        expect(describeDevice(ua)).toBe(name);
    });
});
