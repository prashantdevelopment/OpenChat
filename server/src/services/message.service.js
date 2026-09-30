import mongoose from "mongoose";
import Message from "../models/message.model.js";
import AppError from "../utils/AppError.js";
import { base64Length, isBase64 } from "../utils/base64.js";
import { getChatForMember, otherParticipant } from "./conversation.service.js";
import { latestEpoch, needsNewKey } from "./groupKeys.service.js";
import { assertNotBlocked } from "./block.service.js";
import { getAttachableUpload } from "./upload.service.js";

// Messages are end-to-end encrypted, so the server cannot see the text. It can
// only check sizes: AES-GCM output = UTF-8 text + a 16-byte tag, and the
// client allows at most 2000 characters (up to 4 bytes each in UTF-8).
const AES_GCM_TAG_BYTES = 16;
const MAX_TEXT_LENGTH = 2000;
const MAX_CIPHERTEXT_BYTES = MAX_TEXT_LENGTH * 4 + AES_GCM_TAG_BYTES;
const IV_BYTES = 12;
// Messages with a file also carry its key and details (name, type, size) in
// their ciphertext.
const ATTACHMENT_DETAILS_BYTES = 2048;
const SUPPORTED_TYPES = ["text", "image", "video", "audio", "file", "call"];
// Types that come with an uploaded file. ("call" = a call record: who called,
// voice/video, answered or missed, how long; encrypted like a text.)
const FILE_TYPES = ["image", "video", "audio", "file"];
// crypto.randomUUID() in the browser.
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// A group message must be encrypted with the group's latest key, and not
// while the group needs a new one (someone left: they hold the current key).
// The client then makes or loads the new key and sends again ("reason").
const checkGroupEpoch = async (group, epoch) => {
    const latest = await latestEpoch(group._id);
    if (needsNewKey(group, latest)) throw new AppError("The group needs a new key first", 409, { reason: "rotate" });
    if (epoch !== latest) throw new AppError("The group's key has changed", 409, { reason: "epoch" });
};

const createMessage = async (conversationId, currentUserId, encrypted) => {
    const { ciphertext, iv, clientId, messageType = "text", attachment, epoch } = encrypted ?? {};
    if (!SUPPORTED_TYPES.includes(messageType)) {
        throw new AppError("Unsupported message type", 400);
    }
    const hasFile = FILE_TYPES.includes(messageType);
    if (!hasFile && attachment !== undefined) {
        throw new AppError("Text messages can't have an attachment", 400);
    }
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
    if (ciphertextBytes > MAX_CIPHERTEXT_BYTES + (hasFile ? ATTACHMENT_DETAILS_BYTES : 0)) {
        throw new AppError(`Message cannot be longer than ${MAX_TEXT_LENGTH} characters`, 400);
    }

    if (clientId !== undefined && (typeof clientId !== "string" || !CLIENT_ID_PATTERN.test(clientId))) {
        throw new AppError("clientId must be a UUID", 400);
    }

    const conversation = await getChatForMember(conversationId, currentUserId);
    const isGroup = conversation.type === "group";
    // Blocks are about two people: in a group, everyone still writes.
    if (isGroup) await checkGroupEpoch(conversation, epoch);
    else await assertNotBlocked(currentUserId, otherParticipant(conversation, currentUserId), "You can't send messages in this chat");
    // The sender's own upload, made for this conversation as this kind.
    const upload = hasFile ? await getAttachableUpload(attachment?.fileId, currentUserId, conversation._id, messageType) : null;

    let message;
    try {
        message = await Message.create({
            conversationId: conversation._id,
            sender: currentUserId,
            ciphertext,
            iv,
            clientId,
            messageType,
            ...(isGroup ? { epoch } : {}),
            ...(upload ? { attachment: { fileId: upload._id, size: upload.size } } : {})
        });
    } catch (err) {
        // A retry of a message that was already saved (its reply got lost):
        // return the saved one. `duplicate` tells the caller not to announce it again.
        if (err.code === 11000 && clientId !== undefined) {
            const existing = await Message.findOne({ sender: currentUserId, clientId });
            if (existing && existing.conversationId.equals(conversation._id)) {
                return { message: existing, conversation, duplicate: true };
            }
            throw new AppError("This clientId was already used for another message", 409);
        }
        throw err;
    }

    conversation.lastMessage = { ciphertext, iv, sender: currentUserId, messageType, ...(isGroup ? { epoch } : {}) };
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();

    // The conversation is returned too: the socket layer needs its
    // participants to notify each of them.
    return { message, conversation, duplicate: false };
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

    const conversation = await getChatForMember(conversationId, currentUserId);
    // In a group, only what was written after the user joined.
    const joinedAt = conversation.joinedAt?.get(String(currentUserId));
    const filter = { conversationId: conversation._id, ...(joinedAt ? { createdAt: { $gte: joinedAt } } : {}) };

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
        filter.$and = [{ $or: [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }
        ] }];
    }

    // Fetch one extra message to know whether there is anything older.
    // Group lines name who joined or left (they may not be members any more).
    const page = await Message.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(pageSize + 1)
        .populate(SYSTEM_PEOPLE);

    const hasMore = page.length > pageSize;
    // Newest-first from the database, oldest-first for display.
    const messages = page.slice(0, pageSize).reverse();
    return { messages, hasMore };
}


// "Riya joined" and the like, in a group's history (never unread, no preview).
const SYSTEM_PEOPLE = [{ path: "system.user", select: "name username" }, { path: "system.by", select: "name username" }];
const addSystemMessage = async (groupId, kind, userId, byId) =>
    (await Message.create({ conversationId: groupId, sender: userId, messageType: "system", system: { kind, user: userId, ...(byId ? { by: byId } : {}) } })).populate(SYSTEM_PEOPLE);

export {
    addSystemMessage,
    createMessage,
    getMessagesByConversationId
}
