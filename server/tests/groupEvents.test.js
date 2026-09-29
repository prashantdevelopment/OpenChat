import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";

// A throwaway VAPID key pair, and web-push replaced by a recorder.
await vi.hoisted(async () => {
    const { createECDH } = await import("crypto");
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    process.env.VAPID_PUBLIC_KEY = ecdh.getPublicKey().toString("base64url");
    process.env.VAPID_PRIVATE_KEY = ecdh.getPrivateKey().toString("base64url");
});
const pushes = vi.hoisted(() => []);
vi.mock("web-push", () => ({
    default: { sendNotification: vi.fn(async (subscription, body, options) => { pushes.push({ endpoint: subscription.endpoint, payload: JSON.parse(body), options }); return { statusCode: 201 }; }) },
}));

import { createServer } from "http";
import { createECDH, randomBytes } from "crypto";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import User from "../src/models/user.model.js";
import Conversation from "../src/models/conversation.model.js";
import GroupInvite from "../src/models/groupInvite.model.js";
import { connectTestDb, disconnectTestDb, registerAndLogin } from "./helpers.js";

// alice invites; bob joins, carol's invite is taken back, dave declines; eve
// is an outsider.
let io, url, alice, bob, carol, dave, eve;
const openSockets = [];

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 50 });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    [alice, bob, carol, dave, eve] = await Promise.all(["alice_ge", "bob_ge", "carol_ge", "dave_ge", "eve_ge"].map(registerAndLogin));
    await User.updateOne({ _id: alice.id }, { $set: { name: "Alice Rao" } });
    for (const other of [bob, carol, dave]) {
        const { conversation } = (await request(app).post("/api/conversations").set("Cookie", alice.cookie).send({ otherUserId: other.id }).expect(200)).body;
        await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageAt: new Date() } });
    }
    for (const user of [alice, bob, carol, dave, eve]) {
        const ecdh = createECDH("prime256v1");
        ecdh.generateKeys();
        await request(app).post("/api/push/subscriptions").set("Cookie", user.cookie)
            .send({ endpoint: `https://fcm.googleapis.com/fcm/send/${user.id}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } })
            .expect(201);
    }
});
afterAll(async () => {
    io.close();
    await disconnectTestDb();
});
beforeEach(async () => {
    pushes.length = 0;
    await GroupInvite.deleteMany({});
    await Conversation.deleteMany({ type: "group" });
});
afterEach(() => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
});

const connectAs = (user, { visible = true } = {}) => new Promise((resolve, reject) => {
    const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false, auth: { visible } });
    openSockets.push(socket);
    socket.received = [];
    socket.onAny((event, data) => socket.received.push({ event, data }));
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
});
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const eventsOf = (socket, name) => socket.received.filter((r) => r.event === name).map((r) => r.data);
const pushesTo = (user) => pushes.filter((p) => p.endpoint.endsWith(user.id));
const createGroup = (userIds) => request(app).post("/api/groups").set("Cookie", alice.cookie).send({ name: "Goa trip", userIds }).expect(201);
const inviteOf = async (user) => (await request(app).get("/api/group-invites").set("Cookie", user.cookie).expect(200)).body.invites[0];
const answer = async (user, verb) => request(app).post(`/api/group-invites/${(await inviteOf(user))._id}/${verb}`).set("Cookie", user.cookie).expect(200);

describe("invites, live", () => {
    it("each invitee gets the invite at once: which group, how big, who invited; the outsider nothing", async () => {
        const [a, b, c, e] = [await connectAs(alice), await connectAs(bob), await connectAs(carol), await connectAs(eve)];
        const { group } = (await createGroup([bob.id, carol.id])).body;
        await settle();
        for (const socket of [b, c]) {
            const [invite] = eventsOf(socket, "groupInvite");
            expect(invite).toMatchObject({ group: { _id: group._id, name: "Goa trip", memberCount: 1 }, from: { username: "alice_ge", name: "Alice Rao" } });
            expect(invite._id).toBe((await inviteOf(socket === b ? bob : carol))._id);
            expect(JSON.stringify(invite)).not.toMatch(/email|password/);
        }
        expect(e.received).toEqual([]);
        expect(eventsOf(a, "groupsChanged").length).toBeGreaterThan(0); // alice's group view: new pending invites
        expect(eventsOf(a, "groupInvite")).toEqual([]);
    });

    it("bob accepts: alice hears 'joined', bob's other tabs reload; dave declines: alice hears 'declined'", async () => {
        await createGroup([bob.id, dave.id]);
        const [a, b2] = [await connectAs(alice), await connectAs(bob)];
        await answer(bob, "accept");
        await answer(dave, "decline");
        await settle();
        const answers = eventsOf(a, "groupInviteAnswered");
        expect(answers.map((x) => [x.user.username, x.accepted, x.groupName])).toEqual([["bob_ge", true, "Goa trip"], ["dave_ge", false, "Goa trip"]]);
        expect(eventsOf(b2, "groupInvitesChanged").length).toBe(1);
        expect(eventsOf(b2, "groupsChanged").length).toBeGreaterThan(0);
    });

    it("alice takes carol's invite back: carol's list reloads; eve hears nothing", async () => {
        await createGroup([carol.id]);
        const [c, e] = [await connectAs(carol), await connectAs(eve)];
        const invite = await inviteOf(carol);
        await request(app).delete(`/api/group-invites/${invite._id}`).set("Cookie", alice.cookie).expect(200);
        await settle();
        expect(eventsOf(c, "groupInvitesChanged").length).toBe(1);
        expect(e.received).toEqual([]);
    });
});

describe("invites, by push", () => {
    it("bob has no OpenChat open: 'Alice Rao · Invites you to the group \"Goa trip\"', opening the chat list", async () => {
        await createGroup([bob.id]);
        await settle();
        const [push] = pushesTo(bob);
        expect(push.payload).toEqual({ title: "Alice Rao", body: 'Invites you to the group "Goa trip"', url: "/chat", tag: `invite-${(await inviteOf(bob))._id}` });
        expect(pushesTo(alice)).toHaveLength(0);
        expect(pushesTo(eve)).toHaveLength(0);
    });

    it("OpenChat on his screen: no push (the live alert covers it); hidden: a push", async () => {
        await connectAs(bob, { visible: true });
        await connectAs(carol, { visible: false });
        await createGroup([bob.id, carol.id]);
        await settle();
        expect(pushesTo(bob)).toHaveLength(0);
        expect(pushesTo(carol)).toHaveLength(1);
    });

    it("'Show who it's from' off: neither the name nor the group", async () => {
        await request(app).patch("/api/users/me").set("Cookie", bob.cookie).send({ pushShowSender: false }).expect(200);
        try {
            await createGroup([bob.id]);
            await settle();
            expect(pushesTo(bob)[0].payload).toMatchObject({ title: "OpenChat", body: "New group invite" });
        } finally {
            await request(app).patch("/api/users/me").set("Cookie", bob.cookie).send({ pushShowSender: true }).expect(200);
        }
    });
});
