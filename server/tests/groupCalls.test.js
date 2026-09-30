import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { createServer } from "http";
import { randomUUID } from "crypto";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import Conversation from "../src/models/conversation.model.js";
import { connectTestDb, disconnectTestDb, encrypted, registerAndLogin } from "./helpers.js";

// Group calls (step 71): seven members (the call holds six) and an outsider.
let io, url, people, outsider, groupId;
const openSockets = [];

const connectAs = (user) => new Promise((resolve, reject) => {
    const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false });
    openSockets.push(socket);
    socket.received = [];
    socket.onAny((event, data) => socket.received.push({ event, data }));
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
});
const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const emit = (socket, event, data) => socket.timeout(2000).emitWithAck(event, data);
const eventsOf = (socket, name) => socket.received.filter((r) => r.event === name).map((r) => r.data);
const join = (socket, extra = {}) => emit(socket, "groupCallJoin", { groupId, callId: randomUUID(), media: "video", ...extra });
const signal = (socket, to, extra = {}) => emit(socket, "groupCallSignal", { groupId, callId: extra.callId, to, kind: "offer", data: encrypted("sdp"), ...extra });

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 50 });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    people = await Promise.all(["a", "b", "c", "d", "e", "f", "g"].map((n) => registerAndLogin(`${n}_gcall`)));
    outsider = await registerAndLogin("x_gcall");
});
afterAll(async () => {
    io.close();
    await disconnectTestDb();
});
beforeEach(async () => {
    await Conversation.deleteMany({ type: "group" });
    const [a] = people;
    const group = await Conversation.create({
        type: "group", name: "Goa trip", participants: people.map((p) => p.id), admins: [a.id], createdBy: a.id,
        joinedAt: Object.fromEntries(people.map((p) => [p.id, new Date()])),
    });
    groupId = String(group._id);
});
afterEach(async () => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
    await settle(100);
});

describe("starting and joining", () => {
    it("a member starts: the others ring (with the group and who calls), the outsider hears nothing, every member sees the call", async () => {
        const [a, b, c] = await Promise.all(people.slice(0, 3).map(connectAs));
        const x = await connectAs(outsider);
        const callId = randomUUID();
        const started = await join(a, { callId, media: "audio" });
        expect(started).toMatchObject({ success: true, callId, media: "audio", participants: [] });
        await settle();
        for (const s of [b, c]) {
            expect(eventsOf(s, "groupCallRinging")).toEqual([expect.objectContaining({ groupId, groupName: "Goa trip", callId, media: "audio", from: expect.objectContaining({ username: "a_gcall" }) })]);
            expect(eventsOf(s, "groupCallUpdated").at(-1)).toMatchObject({ active: true, callId, participants: [people[0].id] });
        }
        expect(eventsOf(a, "groupCallRinging")).toEqual([]);
        expect(x.received).toEqual([]);
        expect(JSON.stringify(eventsOf(b, "groupCallRinging"))).not.toMatch(/email|password/);
    });

    it("joining: the joiner learns who is in it (and connects to them); they learn someone joined", async () => {
        const [a, b, c] = await Promise.all(people.slice(0, 3).map(connectAs));
        const { callId } = await join(a);
        expect(await join(b, { callId: randomUUID() })).toMatchObject({ callId, participants: [people[0].id] });
        const third = await join(c);
        expect(third.participants.sort()).toEqual([people[0].id, people[1].id].sort());
        await settle();
        expect(eventsOf(a, "groupCallPeerJoined").map((e) => e.userId)).toEqual([people[1].id, people[2].id]);
        expect((await emit(b, "groupCallState", { groupId })).participants.sort()).toEqual(people.slice(0, 3).map((p) => p.id).sort());
    });

    it("outsiders can't start, join or ask about it; bad ids and media are refused", async () => {
        const [a] = await Promise.all([connectAs(people[0])]);
        const x = await connectAs(outsider);
        expect((await join(x)).success).toBe(false);
        await join(a);
        expect((await join(x)).success).toBe(false);
        expect((await emit(x, "groupCallState", { groupId })).success).toBe(false);
        const b = await connectAs(people[1]);
        await emit(a, "groupCallLeave", { groupId });
        expect((await join(b, { callId: "nope" })).success).toBe(false);
        expect((await join(b, { media: "hologram" })).success).toBe(false);
        expect((await emit(b, "groupCallJoin", { groupId: "nope", callId: randomUUID(), media: "audio" })).success).toBe(false);
    });

    it("at most six people", async () => {
        const sockets = await Promise.all(people.map(connectAs));
        const { callId } = await join(sockets[0]);
        for (const s of sockets.slice(1, 6)) expect((await join(s, { callId })).success).toBe(true);
        expect(await join(sockets[6], { callId })).toMatchObject({ success: false, reason: "full" });
    });
});

describe("signals", () => {
    it("go only between two people in the same call, to the right one, and must look encrypted", async () => {
        const [a, b, c] = await Promise.all(people.slice(0, 3).map(connectAs));
        const x = await connectAs(outsider);
        const { callId } = await join(a);
        await join(b);
        expect((await signal(a, people[1].id, { callId })).success).toBe(true);
        await settle();
        const [got] = eventsOf(b, "groupCallSignal");
        expect(got).toMatchObject({ groupId, callId, from: people[0].id, kind: "offer" });
        expect(eventsOf(c, "groupCallSignal")).toEqual([]);
        expect((await signal(a, people[2].id, { callId })).success).toBe(false); // c isn't in the call
        expect((await signal(c, people[0].id, { callId })).success).toBe(false); // nor can c send
        expect((await signal(x, people[0].id, { callId })).success).toBe(false);
        expect((await signal(a, people[1].id, { callId: randomUUID() })).success).toBe(false); // another call
        expect((await signal(a, people[1].id, { callId, kind: "chat" })).success).toBe(false);
        expect((await signal(a, people[1].id, { callId, data: { ciphertext: "plain text!", iv: "x" } })).success).toBe(false);
        expect((await signal(a, people[0].id, { callId })).success).toBe(false); // to myself
    });
});

describe("leaving", () => {
    it("leaving tells the others; when the last one leaves, the call is over for every member", async () => {
        const [a, b, c] = await Promise.all(people.slice(0, 3).map(connectAs));
        const { callId } = await join(a);
        await join(b);
        await emit(b, "groupCallLeave", { groupId });
        await settle();
        expect(eventsOf(a, "groupCallPeerLeft")).toEqual([{ groupId, callId, userId: people[1].id }]);
        await emit(a, "groupCallLeave", { groupId });
        await settle();
        expect(eventsOf(c, "groupCallUpdated").at(-1)).toEqual({ groupId, active: false });
    });

    it("an app that disconnects leaves the call", async () => {
        const [a, b] = await Promise.all(people.slice(0, 2).map(connectAs));
        await join(a);
        await join(b);
        b.disconnect();
        await settle();
        expect(eventsOf(a, "groupCallPeerLeft").map((e) => e.userId)).toEqual([people[1].id]);
    });

    it("someone removed from the group is out of its call too", async () => {
        const [a, b] = await Promise.all(people.slice(0, 2).map(connectAs));
        await join(a);
        await join(b);
        await request(app).delete(`/api/groups/${groupId}/members/${people[1].id}`).set("Cookie", people[0].cookie).expect(200);
        await settle();
        expect(eventsOf(a, "groupCallPeerLeft").map((e) => e.userId)).toEqual([people[1].id]);
        expect((await emit(a, "groupCallState", { groupId })).participants).toEqual([people[0].id]);
    });

    it("the same person joining from another device: the first one drops out, signals go to the new one", async () => {
        const [a, b] = await Promise.all(people.slice(0, 2).map(connectAs));
        const { callId } = await join(a);
        await join(b);
        const b2 = await connectAs(people[1]);
        await join(b2);
        await settle();
        expect(eventsOf(b, "groupCallHandledElsewhere")).toEqual([{ groupId, callId }]);
        await signal(a, people[1].id, { callId });
        await settle();
        expect(eventsOf(b2, "groupCallSignal")).toHaveLength(1);
        expect(eventsOf(b, "groupCallSignal")).toHaveLength(0);
        expect((await signal(b, people[0].id, { callId })).success).toBe(false); // the old device is out
    });
});
