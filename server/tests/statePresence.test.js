import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "http";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import User from "../src/models/user.model.js";
import { connectTestDb, disconnectTestDb, registerAndLogin } from "./helpers.js";

const GRACE_MS = 100;
const INTERVAL_MS = 150;
let io, url;
let delhi, goa, watcher;
const sockets = [];

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: GRACE_MS, statePresenceIntervalMs: INTERVAL_MS });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
    delhi = await Promise.all(Array.from({ length: 7 }, (_, i) => registerAndLogin(`delhi_${i}`)));
    goa = await registerAndLogin("goa_user");
    watcher = await registerAndLogin("kerala_watch");
    await User.updateOne({ _id: goa.id }, { state: "goa" });
    await User.updateOne({ _id: watcher.id }, { state: "kerala" });
});

afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    io.close();
    await disconnectTestDb();
});

const connectAs = (user) => new Promise((resolve, reject) => {
    const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false });
    sockets.push(socket);
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
});
const settle = (ms = GRACE_MS + INTERVAL_MS + 200) => new Promise((resolve) => setTimeout(resolve, ms));
const countIn = (snapshot, code) => snapshot.states.find((state) => state.code === code).online;
const fromApi = async () => (await request(app).get("/api/presence/states").set("Cookie", watcher.cookie)).body;

describe("online counts per state", () => {
    let watching, updates;

    it("needs a login", async () => {
        expect((await request(app).get("/api/presence/states")).status).toBe(401);
    });

    it("counts people per state, hiding counts under 5", async () => {
        watching = await connectAs(watcher);
        updates = [];
        watching.on("statePresence", (snapshot) => updates.push(snapshot));
        await Promise.all([...delhi.slice(0, 5), goa].map(connectAs));
        await settle();

        const snapshot = await fromApi();
        expect(countIn(snapshot, "delhi")).toBe(5);
        expect(countIn(snapshot, "goa")).toBeNull(); // 1: fewer than 5
        expect(countIn(snapshot, "kerala")).toBeNull(); // the watcher: 1
        expect(snapshot.total).toBe(7);
        expect(snapshot.states).toHaveLength(36);
    });

    it("never says who: only state codes and numbers", async () => {
        const snapshot = await fromApi();
        for (const state of snapshot.states) expect(Object.keys(state).sort()).toEqual(["code", "online"]);
        expect(JSON.stringify(snapshot)).not.toMatch(/delhi_\d|goa_user|[a-f0-9]{24}/);
    });

    it("sends live counts only to watchers, in one batched update", async () => {
        const other = await connectAs(goa); // goa's second tab: still one person
        const notWatching = [];
        other.on("statePresence", (snapshot) => notWatching.push(snapshot));
        const ack = await watching.timeout(2000).emitWithAck("watchStatePresence");
        expect(countIn(ack, "delhi")).toBe(5);
        updates.length = 0;

        await Promise.all(delhi.slice(5).map(connectAs)); // two more at once
        await settle();
        expect(updates).toHaveLength(1);
        expect(countIn(updates[0], "delhi")).toBe(7);
        expect(countIn(updates[0], "goa")).toBeNull(); // two tabs of one person = 1
        expect(notWatching).toEqual([]);
    });

    it("goes down when people leave, and hides again under 5", async () => {
        updates.length = 0;
        const delhiSockets = sockets.filter((socket) => socket !== watching).slice(0, 3); // delhi_0..2
        delhiSockets.forEach((socket) => socket.disconnect());
        await settle();
        expect(countIn(updates.at(-1), "delhi")).toBeNull(); // 7 - 3 = 4
        expect(countIn(await fromApi(), "delhi")).toBeNull();
    });

    it("stops after unwatching", async () => {
        watching.emit("unwatchStatePresence");
        await settle(50);
        updates.length = 0;
        await Promise.all(delhi.slice(0, 3).map(connectAs));
        await settle();
        expect(updates).toEqual([]);
        expect(countIn(await fromApi(), "delhi")).toBe(7);
    });
});
