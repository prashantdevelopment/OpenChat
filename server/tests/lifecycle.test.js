import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import { createServer, request as httpRequest } from "http";
import { spawnSync } from "child_process";
import { Server } from "socket.io";
import { io as connectClient } from "socket.io-client";
import { createShutdown, handleProcessErrors } from "../src/lifecycle.js";

// Step 80: a clean stop (SIGTERM on every deploy) and the last safety net for
// errors nothing caught. Windows has no real SIGTERM, so the signals are
// tested through the handlers, and the safety net in a real Node process.
const quiet = { log: () => {}, error: () => {} };
const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

// An HTTP server with Socket.IO and a slow route (it answers when `release` is called).
const startServer = async () => {
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    const httpServer = createServer(async (req, res) => {
        if (req.url === "/slow") await released;
        res.end("done");
    });
    const io = new Server(httpServer);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    return { httpServer, io, port: httpServer.address().port, release };
};
const get = (port, path) => new Promise((resolve, reject) => {
    httpRequest({ port, path, agent: false }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject).end();
});

describe("a clean stop", () => {
    it("open requests finish, new connections are refused, sockets are told to go, the database closes, then it exits once with 0", async () => {
        const { httpServer, io, port, release } = await startServer();
        const client = connectClient(`http://localhost:${port}`, { reconnection: false, transports: ["websocket"] });
        await new Promise((resolve) => client.on("connect", resolve));
        const disconnected = new Promise((resolve) => client.on("disconnect", resolve));

        const slow = get(port, "/slow"); // in progress when the stop begins
        await settle();
        const closeDatabase = vi.fn(async () => {});
        const exit = vi.fn();
        const shutdown = createShutdown({ httpServer, io, closeDatabase, exit, log: quiet });
        const stopping = shutdown("SIGTERM");
        shutdown("SIGTERM"); // a second signal changes nothing

        // "transport close" (not "io server disconnect"): the apps reconnect by themselves, to the new server.
        expect(await disconnected).toBe("transport close");
        await expect(get(port, "/")).rejects.toThrow(); // no new connections
        expect(exit).not.toHaveBeenCalled(); // still waiting for the slow request
        release();
        expect(await slow).toEqual({ status: 200, body: "done" });
        await stopping;
        expect(closeDatabase).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
    });

    it("a request that never ends doesn't keep it from stopping: it exits with 1 after the time limit", async () => {
        const { httpServer, io, port } = await startServer();
        get(port, "/slow").catch(() => {}); // never answered
        await settle();
        const exit = vi.fn();
        createShutdown({ httpServer, io, closeDatabase: async () => {}, exit, timeoutMs: 300, log: quiet })("SIGTERM");
        await settle(150);
        expect(exit).not.toHaveBeenCalled();
        await settle(300);
        expect(exit).toHaveBeenCalledWith(1);
        httpServer.closeAllConnections();
    });

    it("an error while closing the database still exits, with 1", async () => {
        const { httpServer, io } = await startServer();
        const exit = vi.fn();
        await createShutdown({ httpServer, io, closeDatabase: async () => { throw new Error("db gone"); }, exit, log: quiet })("SIGTERM");
        expect(exit).toHaveBeenCalledWith(1);
    });
});

describe("errors nothing caught", () => {
    const setup = () => {
        const process = new EventEmitter();
        const shutdown = vi.fn();
        const log = { log: vi.fn(), error: vi.fn() };
        handleProcessErrors({ shutdown, log, on: process.on.bind(process) });
        return { process, shutdown, log };
    };

    it("a failed promise in a background task is logged; the server keeps running", () => {
        const { process, shutdown, log } = setup();
        process.emit("unhandledRejection", new Error("push service down"));
        expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/keeps running/), expect.any(Error));
        expect(shutdown).not.toHaveBeenCalled();
    });

    it("a thrown exception: logged, then a clean stop with code 1 (the host restarts it)", () => {
        const { process, shutdown } = setup();
        process.emit("uncaughtException", new Error("broken state"));
        expect(shutdown).toHaveBeenCalledWith("uncaughtException", 1);
    });

    it("SIGTERM (a deploy) and SIGINT (Ctrl+C): a clean stop", () => {
        const { process, shutdown } = setup();
        process.emit("SIGTERM");
        process.emit("SIGINT");
        expect(shutdown.mock.calls).toEqual([["SIGTERM"], ["SIGINT"]]);
    });

    // In a real Node process: without the handler, Node ends the process on a
    // failed promise nobody handles.
    const runNode = (code) => spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 10_000 });
    const lifecycle = JSON.stringify(new URL("../src/lifecycle.js", import.meta.url).href);

    it("in a real process: a failed background promise doesn't end it", () => {
        const result = runNode(`
            import { handleProcessErrors } from ${lifecycle};
            handleProcessErrors({ shutdown: () => process.exit(9), log: { log() {}, error() {} } });
            Promise.reject(new Error("background task failed"));
            setTimeout(() => { console.log("still running"); process.exit(0); }, 200);
        `);
        expect(result.stdout).toContain("still running");
        expect(result.status).toBe(0);
    });

    it("in a real process: a thrown exception stops it cleanly with code 1", () => {
        const result = runNode(`
            import { createServer } from "http";
            import { createShutdown, handleProcessErrors } from ${lifecycle};
            const httpServer = createServer().listen(0);
            const io = { close: (done) => httpServer.close(done) };
            handleProcessErrors({ shutdown: createShutdown({ httpServer, io, closeDatabase: async () => console.log("database closed"), log: { log() {}, error() {} } }), log: { log() {}, error() {} } });
            setTimeout(() => { throw new Error("broken state"); }, 50);
        `);
        expect(result.stdout).toContain("database closed");
        expect(result.status).toBe(1);
    });
});
