import { randomBytes } from "crypto";
import Upload from "../models/upload.model.js";
import storage from "../storage/index.js";
import AppError from "../utils/AppError.js";
import { getChatForMember, otherParticipant } from "./conversation.service.js";
import { assertNotBlocked } from "./block.service.js";

// 10 MB per encrypted file, for every kind: the most Cloudinary's plan takes
// for one raw file. (Photos are shrunk to 2048px first, so they stay far
// below.) AES-GCM adds a 16-byte tag, so anything smaller can't be a file.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const KINDS = ["image", "video", "audio", "file"];
const MIN_UPLOAD_BYTES = 17;
const FILE_ID_PATTERN = /^[a-f0-9]{32}$/;

// Saves an encrypted file for a conversation (1:1 or group) the user is part of.
const createUpload = async (conversationId, userId, bytes, kind) => {
    if (!KINDS.includes(kind)) {
        throw new AppError("kind must be image, video, audio or file", 400);
    }
    if (!Buffer.isBuffer(bytes)) {
        throw new AppError("Send the encrypted file as application/octet-stream", 400);
    }
    if (bytes.length < MIN_UPLOAD_BYTES) {
        throw new AppError("The file is empty", 400);
    }
    const conversation = await getChatForMember(conversationId, userId);
    if (conversation.type !== "group") await assertNotBlocked(userId, otherParticipant(conversation, userId), "You can't send files in this chat");

    const fileId = randomBytes(16).toString("hex");
    await storage.save(fileId, bytes);
    try {
        await Upload.create({ _id: fileId, owner: userId, conversationId: conversation._id, kind, size: bytes.length });
    } catch (err) {
        await storage.remove(fileId); // no file without its record
        throw err;
    }
    return { fileId, size: bytes.length };
};

// A file's record, or 404. The id is checked first: it becomes a file name.
const findUpload = async (fileId) => {
    const upload = typeof fileId === "string" && FILE_ID_PATTERN.test(fileId) ? await Upload.findById(fileId) : null;
    if (!upload) {
        throw new AppError("File not found", 404);
    }
    return upload;
};

// The encrypted bytes, for the current members of the file's conversation only.
const readUpload = async (fileId, userId) => {
    const upload = await findUpload(fileId);
    await getChatForMember(upload.conversationId, userId);
    return storage.read(upload._id);
};

// Checks that userId may attach this file to a message of type `kind` in
// conversationId: their own upload, made for this very conversation, as that kind.
const getAttachableUpload = async (fileId, userId, conversationId, kind) => {
    const upload = await findUpload(fileId);
    if (upload.owner.toString() !== userId.toString() || !upload.conversationId.equals(conversationId) || upload.kind !== kind) {
        throw new AppError("This file can't be attached here", 403);
    }
    return upload;
};

// Removes a file: from storage first, then its record. If storage fails, the
// record stays (and the error goes up), so the file isn't forgotten.
const removeUpload = async (fileId) => {
    await storage.remove(fileId);
    await Upload.deleteOne({ _id: fileId });
};

export { MAX_UPLOAD_BYTES, createUpload, readUpload, getAttachableUpload, removeUpload };
