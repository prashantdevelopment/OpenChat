import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

// Before the app loads: a (fake) Cloudflare TURN key is configured.
vi.hoisted(() => {
    process.env.CLOUDFLARE_TURN_KEY_ID = "test-key-id";
    process.env.CLOUDFLARE_TURN_KEY_API_TOKEN = "test-token";
});

import request from "supertest";
import app from "../src/app.js";
import { connectTestDb, disconnectTestDb, registerAndLogin } from "./helpers.js";

let alice;
const realFetch = globalThis.fetch;

beforeAll(async () => {
    await connectTestDb();
    alice = await registerAndLogin("alice_ice");
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

afterAll(async () => {
    await disconnectTestDb();
});

const CLOUDFLARE_ANSWER = {
    iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
        {
            urls: [
                "turn:turn.cloudflare.com:3478?transport=udp",
                "turn:turn.cloudflare.com:53?transport=udp",
                "turns:turn.cloudflare.com:443?transport=tcp",
            ],
            username: "short-lived-user",
            credential: "short-lived-secret",
        },
    ],
};

const ask = () => request(app).get("/api/calls/ice-servers").set("Cookie", alice.cookie);

describe("ICE servers for calls (Cloudflare TURN configured)", () => {
    it("asks Cloudflare for short-lived credentials with the server's token, and passes them on without port 53", async () => {
        const calls = [];
        globalThis.fetch = vi.fn(async (url, options) => {
            calls.push({ url: String(url), options });
            return new Response(JSON.stringify(CLOUDFLARE_ANSWER), { status: 201 });
        });
        const res = await ask().expect(200);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/test-key-id/credentials/generate-ice-servers");
        expect(calls[0].options.method).toBe("POST");
        expect(calls[0].options.headers.Authorization).toBe("Bearer test-token");
        expect(JSON.parse(calls[0].options.body).ttl).toBe(4 * 60 * 60);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body.iceServers).toEqual([
            { urls: ["stun:stun.cloudflare.com:3478"] },
            { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "short-lived-user", credential: "short-lived-secret" },
        ]);
        // The API token itself never reaches the browser
        expect(JSON.stringify(res.body)).not.toContain("test-token");
    });

    it("Cloudflare down or refusing: STUN only, the call can still try to connect directly", async () => {
        globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401 }));
        const refused = await ask().expect(200);
        expect(refused.body.iceServers.every((server) => server.urls.every((u) => u.startsWith("stun:")))).toBe(true);
        globalThis.fetch = vi.fn(async () => { throw new Error("network down"); });
        const down = await ask().expect(200);
        expect(down.body.iceServers[0].urls).toContain("stun:stun.cloudflare.com:3478");
    });

    it("only for logged-in users (relays cost money)", async () => {
        globalThis.fetch = vi.fn();
        await request(app).get("/api/calls/ice-servers").expect(401);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});
