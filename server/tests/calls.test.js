import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer } from "http";
import { randomUUID } from "crypto";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import { connectTestDb, disconnectTestDb, encrypted, registerAndLogin } from "./helpers.js";

let io, url;
let alice, bob, carol, conversationId;
const openSockets = [];

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 100 });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    [alice, bob, carol] = await Promise.all(["alice_call", "bob_call", "carol_call"].map(registerAndLogin));
    conversationId = (await request(app).post("/api/conversations").set("Cookie", alice.cookie).send({ otherUserId: bob.id })).body.conversation._id;
});

afterEach(() => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
});

afterAll(async () => {
    io.close();
    await disconnectTestDb();
});

const connectAs = (user) => new Promise((resolve, reject) => {
    const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false });
    openSockets.push(socket);
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
});
const emitWithAck = (socket, event, data) => socket.timeout(2000).emitWithAck(event, data);
const collect = (socket, event) => {
    const received = [];
    socket.on(event, (payload) => received.push(payload));
    return received;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
// Stand-in for a signal encrypted with the conversation key.
const signal = () => encrypted("v=0 o=- 1 2 IN IP4 127.0.0.1 a=fingerprint:sha-256 AB:CD");

describe("call signaling", () => {
    it("rings the callee's tabs with the caller's public profile, never the caller's own", async () => {
        const [a, b1, b2, c] = await Promise.all([connectAs(alice), connectAs(bob), connectAs(bob), connectAs(carol)]);
        const [toB1, toB2, toA, toC] = [collect(b1, "incomingCall"), collect(b2, "incomingCall"), collect(a, "incomingCall"), collect(c, "incomingCall")];
        const callId = randomUUID();
        const offer = signal();

        expect((await emitWithAck(a, "callUser", { conversationId, callId, offer })).success).toBe(true);
        await settle();

        expect(toB1).toHaveLength(1);
        expect(toB2).toHaveLength(1);
        expect(toB1[0]).toMatchObject({ callId, conversationId, media: "audio", offer });
        expect(Object.keys(toB1[0].from).sort()).toEqual(["_id", "avatar", "bio", "publicKey", "state", "username"]);
        expect(toB1[0].from.username).toBe("alice_call");
        expect(toA).toEqual([]);
        expect(toC).toEqual([]);
    });

    it("relays the answer and candidates to the caller, and stops the other tabs ringing", async () => {
        const [a, b1, b2] = await Promise.all([connectAs(alice), connectAs(bob), connectAs(bob)]);
        const answered = collect(a, "callAnswered");
        const candidatesForA = collect(a, "iceCandidate");
        const candidatesForB = collect(b1, "iceCandidate");
        const elsewhere = collect(b2, "callHandledElsewhere");
        const notToAnswerer = collect(b1, "callHandledElsewhere");
        const callId = randomUUID();

        await emitWithAck(a, "callUser", { conversationId, callId, offer: signal() });
        await emitWithAck(b1, "answerCall", { conversationId, callId, answer: signal() });
        await emitWithAck(b1, "iceCandidate", { conversationId, callId, candidate: signal() });
        await emitWithAck(a, "iceCandidate", { conversationId, callId, candidate: signal() });
        await settle();

        expect(answered).toHaveLength(1);
        expect(answered[0].callId).toBe(callId);
        expect(candidatesForA).toHaveLength(1);
        expect(candidatesForB).toHaveLength(1);
        expect(elsewhere).toEqual([{ callId }]);
        expect(notToAnswerer).toEqual([]);
    });

    it("ending (or declining) tells the other side and the other tabs", async () => {
        const [a, b1, b2] = await Promise.all([connectAs(alice), connectAs(bob), connectAs(bob)]);
        const endedForA = collect(a, "callEnded");
        const elsewhere = collect(b2, "callHandledElsewhere");
        const callId = randomUUID();

        await emitWithAck(a, "callUser", { conversationId, callId, offer: signal() });
        expect((await emitWithAck(b1, "endCall", { conversationId, callId, reason: "declined" })).success).toBe(true);
        await settle();
        expect(endedForA).toEqual([{ callId, conversationId, reason: "declined" }]);
        expect(elsewhere).toEqual([{ callId }]);
    });

    it("refuses outsiders", async () => {
        const [c, b] = await Promise.all([connectAs(carol), connectAs(bob)]);
        const toB = collect(b, "incomingCall");
        const res = await emitWithAck(c, "callUser", { conversationId, callId: randomUUID(), offer: signal() });
        expect(res.success).toBe(false);
        expect(res.message).toMatch(/not a participant/);
        for (const event of ["answerCall", "iceCandidate", "endCall"]) {
            const r = await emitWithAck(c, event, { conversationId, callId: randomUUID(), answer: signal(), candidate: signal(), reason: "ended" });
            expect(r.success).toBe(false);
        }
        await settle();
        expect(toB).toEqual([]);
    });

    it.each([
        ["a plain-text SDP instead of an encrypted one", { offer: { sdp: "v=0...", type: "offer" } }, /Invalid call signal/],
        ["an IV of the wrong size", { offer: { ...signal(), iv: "AAAA" } }, /Invalid call signal/],
        ["an oversized signal", { offer: { ciphertext: Buffer.alloc(40 * 1024).toString("base64"), iv: signal().iv } }, /Invalid call signal/],
        ["a bad call id", { callId: "../x" }, /Invalid call id/],
    ])("rejects %s", async (_name, change, message) => {
        const a = await connectAs(alice);
        const res = await emitWithAck(a, "callUser", { conversationId, callId: randomUUID(), offer: signal(), ...change });
        expect(res.success).toBe(false);
        expect(res.message).toMatch(message);
    });

    it("rejects an unknown end reason and survives malformed events", async () => {
        const a = await connectAs(alice);
        const res = await emitWithAck(a, "endCall", { conversationId, callId: randomUUID(), reason: "because" });
        expect(res.message).toBe("Invalid reason");
        a.emit("callUser", null);
        a.emit("iceCandidate", "nonsense");
        a.emit("answerCall", { conversationId: { $ne: null } }, "not a function");
        await settle();
        expect((await emitWithAck(a, "joinConversation", conversationId)).success).toBe(true);
    });
});
