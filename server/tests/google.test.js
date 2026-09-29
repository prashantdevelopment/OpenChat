import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createHash } from "crypto";

// Before the app loads: a (fake) Google OAuth client is configured.
vi.hoisted(() => {
    process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
});

import request from "supertest";
import app from "../src/app.js";
import User from "../src/models/user.model.js";
import { connectTestDb, disconnectTestDb, registerAndLogin, PASSWORD, TEST_KEYS } from "./helpers.js";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const realFetch = globalThis.fetch;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(() => {
    globalThis.fetch = realFetch;
});

// A cookie's value and attributes from a response ("name=value; Path=...").
const cookieOf = (res, name) => (res.headers["set-cookie"] ?? []).find((c) => c.startsWith(`${name}=`));
const valueOf = (res, name) => cookieOf(res, name)?.split(";")[0];
const unsigned = (claims) => `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

// Starts a login, then plays Google: the token endpoint answers with an ID
// token built from `claims` (defaults: a valid one for this login).
const googleLogin = async ({ claims = {}, tokenStatus = 200, tamper = {}, extraCookies = [], remember } = {}) => {
    const start = await request(app).get("/api/auth/google").query(remember === false ? { remember: "0" } : {});
    const location = new URL(start.headers.location);
    const flow = valueOf(start, "google_flow");
    const { state, nonce } = Object.fromEntries(location.searchParams);
    const calls = [];
    globalThis.fetch = vi.fn(async (url, options) => {
        calls.push({ url: String(url), body: Object.fromEntries(new URLSearchParams(String(options.body))) });
        return new Response(JSON.stringify({ id_token: unsigned({
            iss: "https://accounts.google.com", aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600, nonce,
            sub: "google-sub-1", email: "Rahul.Kumar+news@gmail.com", email_verified: true, name: "Rahul Kumar", ...claims,
        }) }), { status: tokenStatus, headers: { "content-type": "application/json" } });
    });
    const callback = await request(app)
        .get("/api/auth/google/callback")
        .query({ code: "one-time-code", state: tamper.state ?? state })
        .set("Cookie", [...(tamper.noFlow ? [] : [flow]), ...extraCookies]);
    return { start, location, callback, calls, where: callback.headers.location ? new URL(callback.headers.location).pathname + new URL(callback.headers.location).search : null };
};

const completeBody = (fields = {}) => ({ username: "rahul.kumar", name: "Rahul Kumar", state: "delhi", ...TEST_KEYS, ...fields });

describe("Sign in with Google: starting", () => {
    it("says the button can be shown", async () => {
        expect((await request(app).get("/api/auth/providers")).body.google).toBe(true);
    });

    it("sends the browser to Google with state, nonce and PKCE (S256), asking for openid email profile", async () => {
        const res = await request(app).get("/api/auth/google");
        expect(res.status).toBe(303);
        const url = new URL(res.headers.location);
        expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
        const p = Object.fromEntries(url.searchParams);
        expect(p).toMatchObject({ client_id: CLIENT_ID, response_type: "code", scope: "openid email profile", code_challenge_method: "S256", redirect_uri: "http://localhost:" + process.env.PORT + "/api/auth/google/callback" });
        expect(p.state.length).toBeGreaterThanOrEqual(40);
        expect(p.nonce.length).toBeGreaterThanOrEqual(40);
        expect(p.code_challenge).toMatch(/^[\w-]{43}$/);
        // Never the secret in the browser's address bar.
        expect(res.headers.location).not.toContain("test-secret");
        const cookie = cookieOf(res, "google_flow");
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/SameSite=Lax/);
        expect(cookie).toMatch(/Path=\/api\/auth\/google/);
    });
});

describe("Sign in with Google: a new person", () => {
    let pending;

    it("the callback swaps the code with Google (secret + PKCE verifier) and sends them to the sign-up form", async () => {
        const { location, callback, calls, where } = await googleLogin();
        expect(callback.status).toBe(303);
        expect(where).toBe("/register/google");
        // The verifier sent to Google is the one the challenge was made from.
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
        expect(calls[0].body).toMatchObject({ code: "one-time-code", client_id: CLIENT_ID, client_secret: "test-secret", grant_type: "authorization_code" });
        expect(createHash("sha256").update(calls[0].body.code_verifier).digest("base64url")).toBe(location.searchParams.get("code_challenge"));
        // No session yet, and the login-in-progress cookie is gone.
        expect(valueOf(callback, "token")).toBeUndefined();
        expect(cookieOf(callback, "google_flow")).toMatch(/google_flow=;/);
        pending = valueOf(callback, "google_pending");
        expect(cookieOf(callback, "google_pending")).toMatch(/HttpOnly.*SameSite=Strict|SameSite=Strict.*HttpOnly/);
        expect(await User.countDocuments({ email: "rahul.kumar+news@gmail.com" })).toBe(0);
    });

    it("the form gets the Google email, name and a free username from the address", async () => {
        const res = await request(app).get("/api/auth/google/pending").set("Cookie", pending);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ kind: "signup", email: "rahul.kumar+news@gmail.com", name: "Rahul Kumar", suggestedUsername: "rahul.kumar" });
    });

    it("suggests the next free username when it is taken", async () => {
        await registerAndLogin("rahul.kumar");
        const res = await request(app).get("/api/auth/google/pending").set("Cookie", pending);
        expect(res.body.suggestedUsername).toBe("rahul.kumar2");
    });

    it("refuses the sign-up without the pending cookie, or with a changed one", async () => {
        expect((await request(app).post("/api/auth/google/complete").send(completeBody())).status).toBe(401);
        const forged = pending.slice(0, -4) + "AAAA";
        expect((await request(app).post("/api/auth/google/complete").set("Cookie", forged).send(completeBody())).status).toBe(401);
    });

    it("the pending cookie is never a login session", async () => {
        const token = pending.replace("google_pending=", "token=");
        expect((await request(app).get("/api/auth/me").set("Cookie", token)).status).toBe(401);
    });

    it("checks the form like registration does (taken username, missing keys)", async () => {
        expect((await request(app).post("/api/auth/google/complete").set("Cookie", pending).send(completeBody())).status).toBe(409);
        const noKeys = await request(app).post("/api/auth/google/complete").set("Cookie", pending).send({ username: "rahul.k", state: "delhi" });
        expect(noKeys.status).toBe(400);
    });

    let session;
    it("creates the account (Google's email, no password), logs in, clears the pending cookie", async () => {
        const res = await request(app).post("/api/auth/google/complete").set("Cookie", pending).send(completeBody({ username: "rahul.k" }));
        expect(res.status).toBe(201);
        expect(res.body.user).toMatchObject({ username: "rahul.k", name: "Rahul Kumar", email: "rahul.kumar+news@gmail.com", hasPassword: false, google: true });
        expect(res.body.user).not.toHaveProperty("googleId");
        expect(res.body.user).not.toHaveProperty("password");
        session = valueOf(res, "token");
        expect(cookieOf(res, "token")).toMatch(/HttpOnly/);
        expect(cookieOf(res, "google_pending")).toMatch(/google_pending=;/);
        const saved = await User.findOne({ username: "rahul.k" }).select("+password +googleId");
        expect(saved.googleId).toBe("google-sub-1");
        expect(saved.password).toBeUndefined();
    });

    it("/me says how the account signs in, without the Google id", async () => {
        const me = await request(app).get("/api/auth/me").set("Cookie", session);
        expect(me.body.user).toMatchObject({ username: "rahul.k", hasPassword: false, google: true });
        expect(me.body.user.encryptedPrivateKey).toBeTruthy();
        expect(me.body.user).not.toHaveProperty("googleId");
    });

    it("the same pending cookie can't make a second account", async () => {
        const res = await request(app).post("/api/auth/google/complete").set("Cookie", pending).send(completeBody({ username: "rahul.k2" }));
        expect(res.status).toBe(409);
    });

    it("next time, Google logs them straight in", async () => {
        const { callback, where } = await googleLogin();
        expect(where).toBe("/chat");
        const me = await request(app).get("/api/auth/me").set("Cookie", valueOf(callback, "token"));
        expect(me.body.user.username).toBe("rahul.k");
    });

    it("'keep me logged in' works the same through Google: 60 days by default, the browser session with ?remember=0", async () => {
        expect(cookieOf((await googleLogin()).callback, "token")).toMatch(/Max-Age=5184000/);
        const shortOne = cookieOf((await googleLogin({ remember: false })).callback, "token");
        expect(shortOne).toMatch(/^token=/);
        expect(shortOne).not.toMatch(/Max-Age|Expires/);
    });

    it("a Google account has no password to log in with or change", async () => {
        const login = await request(app).post("/api/auth/login").send({ identifier: "rahul.k", password: "anything-at-all" });
        expect(login.status).toBe(401);
        expect(login.body.message).toBe("Invalid username/email or password");
        const change = await request(app).patch("/api/users/me/password").set("Cookie", session)
            .send({ currentPassword: "x", newPassword: "a new long password", encryptedPrivateKey: TEST_KEYS.encryptedPrivateKey });
        expect(change.status).toBe(400);
    });

    it("other people never see the Google id", async () => {
        const viewer = await registerAndLogin("viewer_g");
        const res = await request(app).get("/api/users/rahul.k").set("Cookie", viewer.cookie);
        expect(res.body.user).not.toHaveProperty("googleId");
        expect(res.body.user).not.toHaveProperty("email");
    });
});

describe("Sign in with Google: refused", () => {
    const refused = async (options) => {
        const before = await User.countDocuments();
        const { callback, where } = await googleLogin(options);
        expect(valueOf(callback, "token")).toBeUndefined();
        expect(valueOf(callback, "google_pending")).toBeUndefined();
        expect(await User.countDocuments()).toBe(before);
        return where;
    };

    it.each([
        ["another app's ID token (audience)", { claims: { aud: "someone-else.apps.googleusercontent.com" } }],
        ["a token not issued by Google", { claims: { iss: "https://evil.example" } }],
        ["an expired token", { claims: { exp: Math.floor(Date.now() / 1000) - 3600 } }],
        ["a token made for another login (nonce)", { claims: { nonce: "not-this-one" } }],
        ["an email Google hasn't verified", { claims: { sub: "google-sub-2", email: "new@gmail.com", email_verified: false } }],
        ["a state that doesn't match (login CSRF)", { tamper: { state: "attacker-state" } }],
        ["no login started in this browser", { tamper: { noFlow: true } }],
        ["Google rejecting the code", { tokenStatus: 400 }],
    ])("%s", async (_label, options) => {
        expect(await refused(options)).toBe("/login?google=error");
    });

    it("the person pressing Cancel at Google", async () => {
        const res = await request(app).get("/api/auth/google/callback").query({ error: "access_denied" });
        expect(new URL(res.headers.location).search).toBe("?google=cancelled");
    });

    it("Google being unreachable", async () => {
        const start = await request(app).get("/api/auth/google");
        const state = new URL(start.headers.location).searchParams.get("state");
        globalThis.fetch = vi.fn(async () => { throw new TypeError("fetch failed"); });
        const res = await request(app).get("/api/auth/google/callback").query({ code: "c", state }).set("Cookie", valueOf(start, "google_flow"));
        expect(new URL(res.headers.location).search).toBe("?google=error");
    });
});

describe("Sign in with Google: an email that already has a password account", () => {
    let pending;
    beforeAll(async () => {
        await registerAndLogin("priya_pw"); // email priya_pw@test.dev
    });

    it("isn't logged in by Google alone: the login page asks for the password once", async () => {
        const { callback, where } = await googleLogin({ claims: { sub: "google-sub-priya", email: "priya_pw@test.dev", name: "Priya" } });
        expect(where).toBe("/login?google=link");
        expect(valueOf(callback, "token")).toBeUndefined();
        pending = valueOf(callback, "google_pending");
        expect((await request(app).get("/api/auth/google/pending").set("Cookie", pending)).body).toMatchObject({ kind: "link", email: "priya_pw@test.dev" });
    });

    it("the link cookie can't create a new account", async () => {
        const res = await request(app).post("/api/auth/google/complete").set("Cookie", pending).send(completeBody({ username: "priya_new" }));
        expect(res.status).toBe(401);
    });

    it("a wrong password doesn't connect it", async () => {
        const res = await request(app).post("/api/auth/login").set("Cookie", pending).send({ identifier: "priya_pw", password: "wrong password here" });
        expect(res.status).toBe(401);
        expect((await User.findOne({ username: "priya_pw" }).select("+googleId")).googleId).toBeUndefined();
    });

    it("another account's password doesn't connect it either", async () => {
        await registerAndLogin("someone_else");
        const res = await request(app).post("/api/auth/login").set("Cookie", pending).send({ identifier: "someone_else", password: PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.linkedGoogle).toBe(false);
        expect((await User.findOne({ username: "someone_else" }).select("+googleId")).googleId).toBeUndefined();
    });

    it("the right password connects Google; from then on Google logs straight in", async () => {
        const { callback } = await googleLogin({ claims: { sub: "google-sub-priya", email: "priya_pw@test.dev" } });
        pending = valueOf(callback, "google_pending");
        const res = await request(app).post("/api/auth/login").set("Cookie", pending).send({ identifier: "priya_pw", password: PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.linkedGoogle).toBe(true);
        expect(res.body.user).toMatchObject({ hasPassword: true, google: true });
        expect(cookieOf(res, "google_pending")).toMatch(/google_pending=;/);
        const again = await googleLogin({ claims: { sub: "google-sub-priya", email: "priya_pw@test.dev" } });
        expect(again.where).toBe("/chat");
    });

    it("an email connected to a different Google account is refused", async () => {
        const { where } = await googleLogin({ claims: { sub: "google-sub-other", email: "priya_pw@test.dev" } });
        expect(where).toBe("/login?google=taken");
    });
});
