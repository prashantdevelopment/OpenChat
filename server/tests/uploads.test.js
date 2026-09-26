import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer } from "http";
import { randomBytes } from "crypto";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import createSocketServer from "../src/socket.js";
import Message from "../src/models/message.model.js";
import Conversation from "../src/models/conversation.model.js";
import { connectTestDb, disconnectTestDb, encrypted, registerAndLogin } from "./helpers.js";

let io, url;
let alice, bob, carol, chatId, otherChatId;
const openSockets = [];

beforeAll(async () => {
    await connectTestDb();
    const httpServer = createServer(app);
    io = createSocketServer(httpServer, { presenceGraceMs: 100 });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;

    [alice, bob, carol] = await Promise.all(["alice_up", "bob_up", "carol_up"].map(registerAndLogin));
    chatId = (await request(app).post("/api/conversations").set("Cookie", alice.cookie).send({ otherUserId: bob.id })).body.conversation._id;
    otherChatId = (await request(app).post("/api/conversations").set("Cookie", alice.cookie).send({ otherUserId: carol.id })).body.conversation._id;
});

afterEach(() => {
    openSockets.splice(0).forEach((socket) => socket.disconnect());
});

afterAll(async () => {
    io.close();
    await disconnectTestDb();
});

// Stand-in for a file encrypted in the browser: random bytes.
const encryptedFile = (size = 1000) => randomBytes(size);
const upload = (user, conversationId, bytes, type = "application/octet-stream") =>
    request(app).post(`/api/conversations/${conversationId}/uploads`).set("Cookie", user.cookie).set("Content-Type", type).send(bytes);
const download = (user, fileId) =>
    request(app).get(`/api/uploads/${fileId}`).set("Cookie", user.cookie).buffer(true).parse((res, done) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
    });

describe("uploading an encrypted file", () => {
    it("stores it for a participant and returns its id and size", async () => {
        const bytes = encryptedFile(2048);
        const res = await upload(alice, chatId, bytes);
        expect(res.status).toBe(201);
        expect(res.body.fileId).toMatch(/^[a-f0-9]{32}$/);
        expect(res.body.size).toBe(2048);
    });

    it("refuses outsiders, unknown conversations and anonymous users", async () => {
        expect((await upload(carol, chatId, encryptedFile())).status).toBe(403);
        expect((await upload(alice, "64b000000000000000000000", encryptedFile())).status).toBe(404);
        expect((await request(app).post(`/api/conversations/${chatId}/uploads`).set("Content-Type", "application/octet-stream").send(encryptedFile())).status).toBe(401);
    });

    it("accepts only raw bytes: not JSON, not an empty file", async () => {
        const json = await request(app).post(`/api/conversations/${chatId}/uploads`).set("Cookie", alice.cookie).send({ data: "abc" });
        expect(json.status).toBe(400);
        expect(json.body.message).toMatch(/application\/octet-stream/);
        expect((await upload(alice, chatId, Buffer.alloc(0))).status).toBe(400);
    });

    it("refuses files over 10 MB with 413", async () => {
        const res = await upload(alice, chatId, Buffer.alloc(10 * 1024 * 1024 + 1));
        expect(res.status).toBe(413);
        expect(res.body.message).toBe("The file is too large");
    });
});

describe("downloading a file", () => {
    let fileId, bytes;
    beforeAll(async () => {
        bytes = encryptedFile(4096);
        fileId = (await upload(alice, chatId, bytes)).body.fileId;
    });

    it("gives both participants the exact bytes, as a safe download", async () => {
        for (const user of [alice, bob]) {
            const res = await download(user, fileId);
            expect(res.status).toBe(200);
            expect(Buffer.compare(res.body, bytes)).toBe(0);
            expect(res.headers["content-type"]).toBe("application/octet-stream");
            expect(res.headers["x-content-type-options"]).toBe("nosniff");
            expect(res.headers["content-disposition"]).toBe("attachment");
            expect(res.headers["cache-control"]).toMatch(/private/);
        }
    });

    it("refuses outsiders", async () => {
        expect((await download(carol, fileId)).status).toBe(403);
    });

    it("never turns the id into another path", async () => {
        for (const bad of ["..%2F..%2Fpackage.json", "a".repeat(32).toUpperCase(), "notanid", "0".repeat(32)]) {
            expect((await download(alice, bad)).status).toBe(404);
        }
    });

    it("needs a login", async () => {
        expect((await request(app).get(`/api/uploads/${fileId}`)).status).toBe(401);
    });
});

describe("image messages", () => {
    const connectAs = (user) => new Promise((resolve, reject) => {
        const socket = connectClient(url, { extraHeaders: { cookie: user.cookie }, reconnection: false });
        openSockets.push(socket);
        socket.on("connect", () => resolve(socket));
        socket.on("connect_error", reject);
    });
    const sendImage = (socket, conversationId, attachment, extra = {}) =>
        socket.timeout(2000).emitWithAck("sendMessage", { conversationId, ...encrypted('{"caption":"hi"}'), messageType: "image", attachment, ...extra });

    it("sends an image with its own upload and shows 'image' in the preview", async () => {
        const { fileId, size } = (await upload(alice, chatId, encryptedFile(3000))).body;
        const [a, b] = await Promise.all([connectAs(alice), connectAs(bob)]);
        await b.timeout(2000).emitWithAck("joinConversation", chatId);
        const received = new Promise((resolve) => b.once("newMessage", resolve));

        const res = await sendImage(a, chatId, { fileId });
        expect(res.success).toBe(true);
        expect(res.message.messageType).toBe("image");
        expect(res.message.attachment).toEqual({ fileId, size });
        expect((await received).attachment).toEqual({ fileId, size });

        const saved = await Message.findById(res.message._id);
        expect(saved.attachment.size).toBe(3000); // size from the server's record, not the client
        const conversation = await Conversation.findById(chatId);
        expect(conversation.lastMessage.messageType).toBe("image");
    });

    it("takes the size from the upload, never from the client", async () => {
        const { fileId } = (await upload(alice, chatId, encryptedFile(500))).body;
        const res = await sendImage(await connectAs(alice), chatId, { fileId, size: 1 });
        expect(res.message.attachment.size).toBe(500);
    });

    it("refuses someone else's upload, one from another chat, or none", async () => {
        const bobsFile = (await upload(bob, chatId, encryptedFile())).body.fileId;
        const otherChatFile = (await upload(alice, otherChatId, encryptedFile())).body.fileId;
        const a = await connectAs(alice);

        expect((await sendImage(a, chatId, { fileId: bobsFile })).message).toMatch(/can't be attached/);
        expect((await sendImage(a, chatId, { fileId: otherChatFile })).message).toMatch(/can't be attached/);
        expect((await sendImage(a, chatId, { fileId: "0".repeat(32) })).message).toBe("File not found");
        expect((await sendImage(a, chatId, undefined)).message).toBe("File not found");
        expect((await sendImage(a, chatId, { fileId: { $ne: null } })).message).toBe("File not found");
    });

    it("refuses unknown types and attachments on text messages", async () => {
        const { fileId } = (await upload(alice, chatId, encryptedFile())).body;
        const a = await connectAs(alice);
        expect((await sendImage(a, chatId, { fileId }, { messageType: "video" })).message).toBe("Unsupported message type");
        expect((await sendImage(a, chatId, { fileId }, { messageType: "text" })).message).toBe("Only image messages can have an attachment");
    });

    it("text messages still work as before", async () => {
        const res = await (await connectAs(alice)).timeout(2000).emitWithAck("sendMessage", { conversationId: chatId, ...encrypted("plain") });
        expect(res.success).toBe(true);
        expect(res.message.messageType).toBe("text");
        expect(res.message).not.toHaveProperty("attachment");
    });
});
