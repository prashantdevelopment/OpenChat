import mongoose from "mongoose";
import Message from "../models/message.model.js";
import AppError from "../utils/AppError.js";
import { getConversationForParticipant } from "./conversation.service.js";

const MAX_MESSAGE_LENGTH = 2000;


const createMessage = async (conversationId, currentUserId, content) => {
    if (typeof content !== "string" || content.trim() === "") {
        throw new AppError("Message content cannot be empty", 400);
    }

    const trimmedContent = content.trim();
    if (trimmedContent.length > MAX_MESSAGE_LENGTH) {
        throw new AppError(`Message cannot be longer than ${MAX_MESSAGE_LENGTH} characters`, 400);
    }

    const conversation = await getConversationForParticipant(conversationId, currentUserId);

    const message = await Message.create({
        conversationId,
        sender: currentUserId,
        content: trimmedContent
    });

    conversation.lastMessage = trimmedContent;
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
