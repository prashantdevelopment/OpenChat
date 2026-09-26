import mongoose from "mongoose";
import Message from "../models/message.model.js";
import AppError from "../utils/AppError.js";
import { base64Length, isBase64 } from "../utils/base64.js";
import { getConversationForParticipant } from "./conversation.service.js";

// Messages are end-to-end encrypted, so the server cannot see the text. It can
// only check sizes: AES-GCM output = UTF-8 text + a 16-byte tag, and the
// client allows at most 2000 characters (up to 4 bytes each in UTF-8).
const AES_GCM_TAG_BYTES = 16;
const MAX_TEXT_LENGTH = 2000;
const MAX_CIPHERTEXT_BYTES = MAX_TEXT_LENGTH * 4 + AES_GCM_TAG_BYTES;
const IV_BYTES = 12;


const createMessage = async (conversationId, currentUserId, encrypted) => {
    const { ciphertext, iv } = encrypted ?? {};
    if (!isBase64(ciphertext) || !isBase64(iv)) {
        throw new AppError("Encrypted message is missing or invalid", 400);
    }
    if (base64Length(iv) !== IV_BYTES) {
        throw new AppError(`Message IV must be ${IV_BYTES} bytes`, 400);
    }
    const ciphertextBytes = base64Length(ciphertext);
    if (ciphertextBytes <= AES_GCM_TAG_BYTES) {
        throw new AppError("Message content cannot be empty", 400);
    }
    if (ciphertextBytes > MAX_CIPHERTEXT_BYTES) {
        throw new AppError(`Message cannot be longer than ${MAX_TEXT_LENGTH} characters`, 400);
    }

    const conversation = await getConversationForParticipant(conversationId, currentUserId);

    const message = await Message.create({
        conversationId,
        sender: currentUserId,
        ciphertext,
        iv
    });

    conversation.lastMessage = { ciphertext, iv, sender: currentUserId };
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();

    // The conversation is returned too: the socket layer needs its
    // participants to notify each of them.
    return { message, conversation };
}


const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// One page of history, newest page first. `before` is the id of the oldest
// message the client already has (a cursor); the page holds the messages right
// before it. Cursor instead of page numbers: new messages arriving would shift
// every page and cause duplicates or gaps.
const getMessagesByConversationId = async (conversationId, currentUserId, { before, limit } = {}) => {
    const pageSize = limit === undefined ? DEFAULT_PAGE_SIZE : Number(limit);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        throw new AppError(`limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`, 400);
    }

    const conversation = await getConversationForParticipant(conversationId, currentUserId);
    const filter = { conversationId: conversation._id };

    if (before !== undefined) {
        if (!mongoose.isValidObjectId(before)) {
            throw new AppError("Invalid 'before' message id", 400);
        }
        const cursor = await Message.findOne({ _id: before, conversationId: conversation._id }).select("createdAt");
        if (!cursor) {
            throw new AppError("The 'before' message is not in this conversation", 400);
        }
        // Older than the cursor; messages with the exact same timestamp are
        // ordered by _id so none are skipped or repeated.
        filter.$or = [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }
        ];
    }

    // Fetch one extra message to know whether there is anything older.
    const page = await Message.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(pageSize + 1);

    const hasMore = page.length > pageSize;
    // Newest-first from the database, oldest-first for display.
    const messages = page.slice(0, pageSize).reverse();
    return { messages, hasMore };
}


export {
    createMessage,
    getMessagesByConversationId
}
