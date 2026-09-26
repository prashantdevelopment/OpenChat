import { randomBytes } from "crypto";
import Upload from "../models/upload.model.js";
import storage from "../storage/index.js";
import AppError from "../utils/AppError.js";
import { getConversationForParticipant } from "./conversation.service.js";

// The browser shrinks photos to 2048px before encrypting them, so 10 MB is
// plenty. AES-GCM adds a 16-byte tag, so anything smaller can't be a file.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MIN_UPLOAD_BYTES = 17;
const FILE_ID_PATTERN = /^[a-f0-9]{32}$/;

// Saves an encrypted file for a conversation the user is part of.
const createUpload = async (conversationId, userId, bytes) => {
    if (!Buffer.isBuffer(bytes)) {
        throw new AppError("Send the encrypted file as application/octet-stream", 400);
    }
    if (bytes.length < MIN_UPLOAD_BYTES) {
        throw new AppError("The file is empty", 400);
    }
    const conversation = await getConversationForParticipant(conversationId, userId);

    const fileId = randomBytes(16).toString("hex");
    await storage.save(fileId, bytes);
    try {
        await Upload.create({ _id: fileId, owner: userId, conversationId: conversation._id, size: bytes.length });
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

// The encrypted bytes, for participants of the file's conversation only.
const readUpload = async (fileId, userId) => {
    const upload = await findUpload(fileId);
    await getConversationForParticipant(upload.conversationId, userId);
    return storage.read(upload._id);
};

// Checks that userId may attach this file to a message in conversationId:
// their own upload, made for this very conversation.
const getAttachableUpload = async (fileId, userId, conversationId) => {
    const upload = await findUpload(fileId);
    if (upload.owner.toString() !== userId.toString() || !upload.conversationId.equals(conversationId)) {
        throw new AppError("This file can't be attached here", 403);
    }
    return upload;
};

export { MAX_UPLOAD_BYTES, createUpload, readUpload, getAttachableUpload };
