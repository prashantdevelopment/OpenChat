import { EventEmitter } from "events";
import mongoose from "mongoose";
import Block from "../models/block.model.js";
import User, { PUBLIC_USER_FIELDS } from "../models/user.model.js";
import AppError from "../utils/AppError.js";

// Blocking. A block separates both people, whoever blocked whom: no new
// messages, calls or files between them, they don't find each other in search
// or Discover, and they stop seeing each other's online status, read receipts
// and typing. Old messages stay readable. The blocked person is never told.

// The live side (sockets leaving rooms, other tabs updating) listens here
// (socket.js), so this service doesn't depend on Socket.IO.
// Events: "blocked" / "unblocked" with { blockerId, blockedId }.
export const blockEvents = new EventEmitter();

// The other user exists and is not the user themself.
const checkOtherUser = async (userId, otherUserId) => {
    if (!mongoose.isValidObjectId(otherUserId)) {
        throw new AppError("Invalid user id", 400);
    }
    if (String(otherUserId) === String(userId)) {
        throw new AppError("You can't block or report yourself", 400);
    }
    if (!(await User.exists({ _id: otherUserId }))) {
        throw new AppError("User not found", 404);
    }
};

// Idempotent: blocking twice is not an error.
export const blockUser = async (userId, otherUserId) => {
    await checkOtherUser(userId, otherUserId);
    const result = await Block.updateOne(
        { blocker: userId, blocked: otherUserId },
        { $setOnInsert: { blocker: userId, blocked: otherUserId } },
        { upsert: true }
    );
    if (result.upsertedCount > 0) {
        blockEvents.emit("blocked", { blockerId: String(userId), blockedId: String(otherUserId) });
    }
};

export const unblockUser = async (userId, otherUserId) => {
    await checkOtherUser(userId, otherUserId);
    const result = await Block.deleteOne({ blocker: userId, blocked: otherUserId });
    if (result.deletedCount > 0) {
        blockEvents.emit("unblocked", { blockerId: String(userId), blockedId: String(otherUserId) });
    }
};

// The people the user blocked (Settings), newest first, public fields only.
export const listBlockedUsers = async (userId) => {
    const blocks = await Block.find({ blocker: userId })
        .sort({ createdAt: -1 })
        .populate("blocked", PUBLIC_USER_FIELDS)
        .lean();
    return blocks.filter((block) => block.blocked).map((block) => block.blocked);
};

// Whether a block stands between two users, in either direction.
export const isBlockedBetween = async (userId, otherUserId) =>
    Boolean(await Block.exists({
        $or: [
            { blocker: userId, blocked: otherUserId },
            { blocker: otherUserId, blocked: userId },
        ],
    }));

// Whether userId blocked otherUserId (only the blocker may know).
export const hasBlocked = async (userId, otherUserId) => Boolean(await Block.exists({ blocker: userId, blocked: otherUserId }));

// Every block the user is part of: whom they blocked, and everyone they are
// separated from (both directions), as sets of id strings.
export const blockRelations = async (userId) => {
    const blocks = await Block.find({ $or: [{ blocker: userId }, { blocked: userId }] }).select("blocker blocked").lean();
    const me = String(userId);
    const blockedByMe = new Set();
    const separated = new Set();
    for (const { blocker, blocked } of blocks) {
        if (String(blocker) === me) blockedByMe.add(String(blocked));
        separated.add(String(blocker) === me ? String(blocked) : String(blocker));
    }
    return { blockedByMe, separated };
};

// Throws 403 if a block stands between the two users.
export const assertNotBlocked = async (userId, otherUserId, message) => {
    if (await isBlockedBetween(userId, otherUserId)) {
        throw new AppError(message, 403);
    }
};
