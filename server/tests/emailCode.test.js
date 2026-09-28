import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";

// Before the app loads: email codes on, a (fake) Brevo account.
vi.hoisted(() => {
    process.env.EMAIL_VERIFICATION = "on";
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.EMAIL_FROM = "openchat.sender@gmail.com";
});

import request from "supertest";
import app from "../src/app.js";
import EmailCode from "../src/models/emailCode.model.js";
import { connectTestDb, disconnectTestDb, PASSWORD, TEST_KEYS } from "./helpers.js";

const realFetch = globalThis.fetch;
let sent; // emails "sent" through Brevo in this test
let brevo; // how Brevo answers: "ok" | "refuse" | "down"

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(() => {
    sent = [];
    brevo = "ok";
    globalThis.fetch = vi.fn(async (url, options) => {
        if (brevo === "down") throw new TypeError("fetch failed");
        sent.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
        return new Response(brevo === "ok" ? '{"messageId":"x"}' : '{"message":"sender not verified"}', { status: brevo === "ok" ? 201 : 400 });
    });
});
afterEach(() => {
    globalThis.fetch = realFetch;
});

const askCode = (email) => request(app).post("/api/users/email-code").send({ email });
const codeFrom = (mail) => mail.body.textContent.match(/\b(\d{6})\b/)?.[1];
// Lets the next code be asked for at once (as if a minute passed).
const skipWait = (email) => EmailCode.updateOne({ email }, { $set: { lastSentAt: new Date(Date.now() - 61_000) } });
let n = 0;
const register = (email, code, fields = {}) => {
    n += 1;
    return request(app).post("/api/users").send({ username: `mailuser_${n}`, name: "Mail User", email, password: PASSWORD, state: "delhi", ...TEST_KEYS, code, ...fields });
};

describe("email codes: sending", () => {
    let firstCode;
    it("the app is told email sign-up is available", async () => {
        expect((await request(app).get("/api/auth/providers")).body).toMatchObject({ emailSignup: true });
    });

    it("sends a 6-digit code through Brevo's API, from the verified sender", async () => {
        const res = await askCode("  Riya.Sen@Example.com ");
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, resendAfter: 60 });
        expect(sent).toHaveLength(1);
        expect(sent[0].url).toBe("https://api.brevo.com/v3/smtp/email");
        expect(sent[0].headers["api-key"]).toBe("test-brevo-key");
        expect(sent[0].body.sender).toEqual({ name: "OpenChat", email: "openchat.sender@gmail.com" });
        expect(sent[0].body.to).toEqual([{ email: "riya.sen@example.com" }]);
        const code = codeFrom(sent[0]);
        firstCode = code;
        expect(code).toMatch(/^\d{6}$/);
        expect(sent[0].body.subject).toContain(code);
        expect(sent[0].body.htmlContent).toContain(code);
    });

    it("keeps only a keyed hash of the code, never the code", async () => {
        const record = await EmailCode.findOne({ email: "riya.sen@example.com" }).lean();
        expect(firstCode).toMatch(/^\d{6}$/);
        expect(JSON.stringify(record)).not.toContain(firstCode);
        expect(record.codeHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("refuses an address that isn't one", async () => {
        for (const email of ["", "not-an-email", "a@b", null, 42, { $gt: "" }, `${"a".repeat(250)}@x.com`]) {
            const res = await askCode(email);
            expect(res.status).toBe(400);
            expect(res.body.errors?.email).toBeTruthy();
        }
        expect(sent).toHaveLength(0);
    });

    it("a new code only after a minute, and at most 5 an hour per address", async () => {
        expect((await askCode("wait@example.com")).status).toBe(200);
        const again = await askCode("wait@example.com");
        expect(again.status).toBe(429);
        expect(again.body.message).toMatch(/wait \d+ seconds/);
        for (let i = 2; i <= 5; i++) {
            await skipWait("wait@example.com");
            expect((await askCode("wait@example.com")).status).toBe(200);
        }
        await skipWait("wait@example.com");
        expect((await askCode("wait@example.com")).body.message).toMatch(/Too many codes/);
        expect(sent).toHaveLength(5);
    });

    it("Brevo refusing or unreachable: a clear error, no code saved", async () => {
        brevo = "refuse";
        expect((await askCode("brevo.down@example.com")).status).toBe(502);
        brevo = "down";
        expect((await askCode("brevo.down@example.com")).status).toBe(502);
        expect(await EmailCode.exists({ email: "brevo.down@example.com" })).toBeNull();
    });
});

describe("email codes: registering", () => {
    let code;
    beforeAll(async () => {
        sent = [];
        globalThis.fetch = vi.fn(async (url, options) => { sent.push({ body: JSON.parse(options.body) }); return new Response("{}", { status: 201 }); });
        await askCode("new.person@example.com");
        code = codeFrom(sent[0]);
    });

    it("needs the code", async () => {
        const res = await register("new.person@example.com", undefined);
        expect(res.status).toBe(400);
        expect(res.body.errors.code).toMatch(/6-digit code/);
    });

    it("a wrong code is refused (and counted)", async () => {
        const wrong = code === "000000" ? "111111" : "000000";
        const res = await register("new.person@example.com", wrong);
        expect(res.status).toBe(400);
        expect(res.body.errors.code).toBe("That code isn't right");
        expect((await EmailCode.findOne({ email: "new.person@example.com" })).attempts).toBe(1);
    });

    it("a code for another address doesn't work", async () => {
        const res = await register("someone.else@example.com", code);
        expect(res.status).toBe(400);
        expect(res.body.errors.code).toMatch(/expired/);
    });

    it("the right code creates the account and is used up", async () => {
        const res = await register("new.person@example.com", code);
        expect(res.status).toBe(201);
        expect(await EmailCode.exists({ email: "new.person@example.com" })).toBeNull();
        const again = await register("new.person@example.com", code, { username: "another_try" });
        expect(again.status).toBe(400);
    });

    it("5 wrong tries end the code, even for the right one after", async () => {
        sent = [];
        await askCode("guesser@example.com");
        const right = codeFrom(sent[0]);
        for (let i = 0; i < 5; i++) await register("guesser@example.com", String((Number(right) + 1 + i) % 1_000_000).padStart(6, "0"));
        const res = await register("guesser@example.com", right);
        expect(res.body.errors.code).toMatch(/Too many wrong tries/);
    });

    it("parallel guesses can't get more than 5 tries", async () => {
        sent = [];
        await askCode("parallel@example.com");
        const right = codeFrom(sent[0]);
        const wrong = right === "999999" ? "999998" : "999999";
        await Promise.all(Array.from({ length: 12 }, () => register("parallel@example.com", wrong)));
        expect((await EmailCode.findOne({ email: "parallel@example.com" })).attempts).toBe(5);
        expect((await register("parallel@example.com", right)).body.errors.code).toMatch(/Too many wrong tries/);
    });

    it("an expired code is refused", async () => {
        sent = [];
        await askCode("late@example.com");
        const right = codeFrom(sent[0]);
        await EmailCode.updateOne({ email: "late@example.com" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        expect((await register("late@example.com", right)).body.errors.code).toMatch(/expired/);
    });

    it("a new code replaces the old one", async () => {
        sent = [];
        await askCode("twice@example.com");
        const first = codeFrom(sent[0]);
        await skipWait("twice@example.com");
        await askCode("twice@example.com");
        const second = codeFrom(sent[1]);
        if (first !== second) expect((await register("twice@example.com", first)).body.errors.code).toBe("That code isn't right");
        expect((await register("twice@example.com", second)).status).toBe(201);
    });
});

describe("email codes: an address that already has an account", () => {
    it("gets the same answer as anyone, but its inbox is told there is an account (no code)", async () => {
        const existing = await askCode("new.person@example.com"); // registered above
        const fresh = await askCode("brand.new@example.com");
        // No way to tell accounts apart from the answer.
        expect(existing.status).toBe(fresh.status);
        expect(existing.body).toEqual(fresh.body);
        const mail = sent.find((m) => m.body.to[0].email === "new.person@example.com");
        expect(mail.body.subject).toBe("You already have an OpenChat account");
        expect(mail.body.textContent).toMatch(/\/login/);
        expect(codeFrom(mail)).toBeUndefined();
    });
});
