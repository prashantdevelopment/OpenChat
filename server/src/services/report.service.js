import mongoose from "mongoose";
import Report, { REPORT_REASONS } from "../models/report.model.js";
import User from "../models/user.model.js";
import AppError from "../utils/AppError.js";
import { blockUser } from "./block.service.js";
import { getConversationForParticipant } from "./conversation.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// Reports a user can make per day, so the queue can't be flooded.
const MAX_REPORTS_PER_DAY = 10;
const MAX_DETAILS_LENGTH = 500;

// Reports someone, optionally from a chat with them, and blocks them too if
// asked. The same person can be reported once a day by the same reporter.
const createReport = async (reporterId, { userId, reason, details = "", conversationId, alsoBlock = false } = {}) => {
    if (!mongoose.isValidObjectId(userId)) {
        throw new AppError("Invalid user id", 400);
    }
    if (String(userId) === String(reporterId)) {
        throw new AppError("You can't block or report yourself", 400);
    }
    if (!REPORT_REASONS.includes(reason)) {
        throw new AppError("Choose a reason", 400);
    }
    if (typeof details !== "string" || details.trim().length > MAX_DETAILS_LENGTH) {
        throw new AppError(`Details must be at most ${MAX_DETAILS_LENGTH} characters long`, 400);
    }
    if (typeof alsoBlock !== "boolean") {
        throw new AppError("alsoBlock must be true or false", 400);
    }
    if (!(await User.exists({ _id: userId }))) {
        throw new AppError("User not found", 404);
    }
    // The chat must be the reporter's chat with this person.
    if (conversationId !== undefined && conversationId !== null) {
        const conversation = await getConversationForParticipant(conversationId, reporterId);
        if (!conversation.participants.some((participantId) => String(participantId) === String(userId))) {
            throw new AppError("That chat is not with this person", 400);
        }
    }

    const since = new Date(Date.now() - DAY_MS);
    const recent = await Report.find({ reporter: reporterId, createdAt: { $gte: since } }).select("reported").lean();
    if (recent.some((report) => String(report.reported) === String(userId))) {
        throw new AppError("You already reported this person today", 409);
    }
    if (recent.length >= MAX_REPORTS_PER_DAY) {
        throw new AppError("You've sent a lot of reports today. Try again tomorrow.", 429);
    }

    await Report.create({ reporter: reporterId, reported: userId, reason, details: details.trim(), conversationId: conversationId ?? null });
    if (alsoBlock) await blockUser(reporterId, userId);
    return { blocked: alsoBlock };
};

export { createReport };
