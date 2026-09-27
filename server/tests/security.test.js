import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

// Before the app loads: trust one proxy, so each test can act from its own
// address (X-Forwarded-For) and the limits' counters don't mix.
vi.hoisted(() => {
    process.env.TRUST_PROXY = "1";
});

import { createServer } from "http";
import { randomUUID } from "crypto";
import request from "supertest";
import JWT from "jsonwebtoken";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import { JWT_SECRET } from "../src/config/env.js";
import { PASSWORD, TEST_KEYS, connectTestDb, disconnectTestDb, encrypted, registerAndLogin } from "./helpers.js";

let io, url;
let alice, bob, conversationId;
const openSockets = [];
let lastIp = 0;
const newIp = () => `10.0.0.${++lastIp}`;

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 100 });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    [alice, bob] = await Promise.all(["alice_sec", "bob_sec"].map(registerAndLogin));
    conversationId = (await request(app).post("/api/conversations").set("Cookie", alice.cookie).send({ otherUserId: bob.id })).body.conversation._id;
    process.env.RATE_LIMITS = "on"; // setup.js turns them off for the other files
});

afterEach(() => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
});

afterAll(async () => {
    process.env.RATE_LIMITS = "off";
    io.close();
    await disconnectTestDb();
});

const login = (identifier, password, ip) => request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send({ identifier, password });
const connect = (cookie, ip = newIp()) => new Promise((resolve, reject) => {
    const socket = connectClient(url, { extraHeaders: { cookie, "x-forwarded-for": ip }, reconnection: false });
    openSockets.push(socket);
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
});
const loginCookie = async (username) => (await login(username, PASSWORD, newIp()).expect(200)).headers["set-cookie"][0].split(";")[0];

describe("security headers (helmet)", () => {
    it("are on every response, and nothing says what the server runs", async () => {
        const res = await request(app).get("/api/health").expect(200);
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
        expect(res.headers["strict-transport-security"]).toMatch(/max-age=/);
        expect(res.headers["content-security-policy"]).toMatch(/default-src 'self'/);
        expect(res.headers["cross-origin-resource-policy"]).toBe("same-site");
        expect(res.headers["x-powered-by"]).toBeUndefined();
        // Errors too
        const missing = await request(app).get("/api/nope").expect(404);
        expect(missing.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("CORS still lets only the app's own address in", async () => {
        const ok = await request(app).get("/api/health").set("Origin", process.env.CLIENT_URL);
        expect(ok.headers["access-control-allow-origin"]).toBe(process.env.CLIENT_URL);
        const evil = await request(app).get("/api/health").set("Origin", "https://evil.example");
        // Always the app's address, never the asker's: the browser then refuses
        // to hand the response to any other site.
        expect(evil.headers["access-control-allow-origin"]).toBe(process.env.CLIENT_URL);
    });
});

describe("rate limits (HTTP)", () => {
    it("login: 10 tries per address and account, then 429 with Retry-After; another account still works", async () => {
        const ip = newIp();
        for (let i = 0; i < 10; i++) await login("alice_sec", "wrong-password", ip).expect(401);
        const blocked = await login("alice_sec", PASSWORD, ip).expect(429); // even the right password
        expect(blocked.body.message).toMatch(/^Too many login attempts\. Try again in \d+ minutes?\.$/);
        expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(800);
        await login("bob_sec", PASSWORD, ip).expect(200);
        // Someone else's address doesn't lock alice out
        await login("alice_sec", PASSWORD, newIp()).expect(200);
    });

    it("login: at most 30 tries per address across accounts", async () => {
        const ip = newIp();
        for (let i = 0; i < 30; i++) await login(`nobody_${i}`, "x", ip).expect(401);
        await login("nobody_31", "x", ip).expect(429);
    });

    it("register: 10 new accounts an hour per address", async () => {
        const ip = newIp();
        const register = (n) => request(app).post("/api/users").set("X-Forwarded-For", ip)
            .send({ username: `many_${n}`, email: `many_${n}@test.dev`, password: PASSWORD, state: "delhi", ...TEST_KEYS });
        for (let i = 0; i < 10; i++) await register(i).expect(201);
        expect((await register(10).expect(429)).body.message).toMatch(/^Too many new accounts from this network/);
    });

    it("password change: 5 tries per 15 minutes per user (no guessing it with a stolen session)", async () => {
        const cookie = await loginCookie("bob_sec");
        const change = () => request(app).patch("/api/users/me/password").set("Cookie", cookie).set("X-Forwarded-For", newIp())
            .send({ currentPassword: "guess", newPassword: "Another@123", encryptedPrivateKey: TEST_KEYS.encryptedPrivateKey });
        for (let i = 0; i < 5; i++) await change().expect(401);
        await change().expect(429); // per user: a new address doesn't help
    });

    it("search: 60 a minute per user", async () => {
        const cookie = await loginCookie("alice_sec");
        const ip = newIp();
        for (let i = 0; i < 60; i++) await request(app).get("/api/users/search?q=b").set("Cookie", cookie).set("X-Forwarded-For", ip).expect(200);
        await request(app).get("/api/users/search?q=b").set("Cookie", cookie).set("X-Forwarded-For", ip).expect(429);
    });

    it("every API request: 600 a minute per address", async () => {
        const ip = newIp();
        const results = await Promise.all(Array.from({ length: 601 }, () => request(app).get("/api/health").set("X-Forwarded-For", ip)));
        expect(results.filter((res) => res.status === 429)).toHaveLength(1);
    });
});

describe("rate limits (sockets)", () => {
    it("sendMessage: 30 in 10 seconds per user, then 'too often' (nothing saved)", async () => {
        const socket = await connect(await loginCookie("alice_sec"));
        const send = () => socket.timeout(2000).emitWithAck("sendMessage", { conversationId, ...encrypted("hi"), clientId: randomUUID() });
        const results = [];
        for (let i = 0; i < 31; i++) results.push(await send());
        expect(results.slice(0, 30).every((r) => r.success)).toBe(true);
        expect(results[30]).toEqual({ success: false, message: "You're doing that too often. Wait a moment and try again." });
    });

    it("typing beyond the limit is dropped silently", async () => {
        const [a, b] = await Promise.all([connect(await loginCookie("alice_sec")), connect(await loginCookie("bob_sec"))]);
        await a.timeout(2000).emitWithAck("joinConversation", conversationId);
        await b.timeout(2000).emitWithAck("joinConversation", conversationId);
        const seen = [];
        a.on("typing", (payload) => seen.push(payload));
        for (let i = 0; i < 25; i++) b.emit("typing", { conversationId, isTyping: i % 2 === 0 });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(seen).toHaveLength(20);
    });

    it("connections: 60 a minute per address", async () => {
        const cookie = await loginCookie("bob_sec");
        const ip = newIp();
        for (let i = 0; i < 60; i++) (await connect(cookie, ip)).disconnect();
        await expect(connect(cookie, ip)).rejects.toThrow("Too many connections");
    });
});

describe("sessions", () => {
    it("tokens are only accepted signed with HS256 by the server (no 'none', no other algorithm)", async () => {
        const claims = { userId: alice.id, jti: randomUUID() };
        const hs512 = JWT.sign(claims, JWT_SECRET, { algorithm: "HS512", expiresIn: "1h" });
        const none = JWT.sign(claims, null, { algorithm: "none" });
        const otherSecret = JWT.sign(claims, "x".repeat(40), { algorithm: "HS256", expiresIn: "1h" });
        for (const token of [hs512, none, otherSecret]) {
            await request(app).get("/api/auth/me").set("Cookie", `token=${token}`).expect(401);
            await expect(connect(`token=${token}`)).rejects.toThrow("Invalid authentication token");
        }
    });

    it("logout ends the session on the server: the old cookie stops working", async () => {
        const cookie = await loginCookie("alice_sec");
        await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
        await request(app).post("/api/auth/logout").set("Cookie", cookie).expect(200);
        const res = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
        expect(res.body.message).toBe("Invalid or expired token");
        await expect(connect(cookie)).rejects.toThrow("Invalid authentication token");
    });

    it("logout closes that session's sockets (told first), not the user's other sessions", async () => {
        const [phone, laptop] = [await loginCookie("bob_sec"), await loginCookie("bob_sec")];
        const [p1, p2, l1] = await Promise.all([connect(phone), connect(phone), connect(laptop)]);
        const told = [];
        const closed = [];
        for (const [name, socket] of [["p1", p1], ["p2", p2], ["l1", l1]]) {
            socket.on("sessionExpired", () => told.push(name));
            socket.on("disconnect", () => closed.push(name));
        }
        await request(app).post("/api/auth/logout").set("Cookie", phone).expect(200);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(told.sort()).toEqual(["p1", "p2"]);
        expect(closed.sort()).toEqual(["p1", "p2"]);
        expect(l1.connected).toBe(true);
    });

    it("a socket closes when its session expires (the token was only checked at connect)", async () => {
        const token = JWT.sign({ userId: alice.id }, JWT_SECRET, { algorithm: "HS256", expiresIn: "1s", jwtid: randomUUID() });
        const socket = await connect(`token=${token}`);
        const events = [];
        socket.on("sessionExpired", () => events.push("sessionExpired"));
        socket.on("disconnect", (reason) => events.push(reason));
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(events).toEqual(["sessionExpired", "io server disconnect"]);
        // And it can't come back with that token
        await expect(connect(`token=${token}`)).rejects.toThrow("Invalid authentication token");
    });

    it("changing the password logs out the user's other sessions (and their sockets), not this one", async () => {
        await registerAndLogin("carol_sec");
        const [current, other] = [await loginCookie("carol_sec"), await loginCookie("carol_sec")];
        const [mine, theirs] = await Promise.all([connect(current), connect(other)]);
        const told = [];
        theirs.on("sessionExpired", () => told.push("other"));
        mine.on("sessionExpired", () => told.push("current"));
        await request(app).patch("/api/users/me/password").set("Cookie", current).set("X-Forwarded-For", newIp())
            .send({ currentPassword: PASSWORD, newPassword: "Another@123", encryptedPrivateKey: TEST_KEYS.encryptedPrivateKey })
            .expect(200);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await request(app).get("/api/auth/me").set("Cookie", other).expect(401);
        await request(app).get("/api/auth/me").set("Cookie", current).expect(200);
        expect(told).toEqual(["other"]);
        expect(theirs.connected).toBe(false);
        expect(mine.connected).toBe(true);
    });

    it("sockets: only the app's own origin may connect from a browser", async () => {
        const cookie = await loginCookie("alice_sec");
        const withOrigin = (origin) => new Promise((resolve, reject) => {
            const socket = connectClient(url, { extraHeaders: { cookie, origin, "x-forwarded-for": newIp() }, reconnection: false, transports: ["websocket"] });
            openSockets.push(socket);
            socket.on("connect", () => resolve(socket));
            socket.on("connect_error", reject);
        });
        await expect(withOrigin("https://evil.example")).rejects.toThrow();
        expect((await withOrigin(process.env.CLIENT_URL)).connected).toBe(true);
    });

    it("login tokens carry their own id and last an hour", async () => {
        const token = (await loginCookie("alice_sec")).replace("token=", "");
        const claims = JWT.decode(token, { complete: true });
        expect(claims.header.alg).toBe("HS256");
        expect(claims.payload.jti).toMatch(/^[0-9a-f-]{36}$/);
        expect(claims.payload.exp - claims.payload.iat).toBe(3600);
    });
});
