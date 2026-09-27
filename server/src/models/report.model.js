import mongoose from "mongoose";

export const REPORT_REASONS = ["spam", "harassment", "impersonation", "inappropriate", "other"];

// A user reporting another for moderation. Messages are end-to-end encrypted,
// so a report holds no message content: only the reason and the reporter's own
// words. Reviewed outside the app for now (status "open" until then).
const reportSchema = new mongoose.Schema({
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reported: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: {
        type: String,
        required: true,
        enum: { values: REPORT_REASONS, message: "Choose a reason" },
    },
    details: {
        type: String,
        trim: true,
        maxlength: [500, "Details must be at most 500 characters long"],
        default: "",
    },
    // The chat it happened in, if reported from one (context for a reviewer).
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null },
    status: { type: String, enum: ["open", "reviewed"], default: "open" },
}, { timestamps: true });

// Limits: the reporter's reports of the last day (newest first).
reportSchema.index({ reporter: 1, createdAt: -1 });
// A reviewer: everything reported about one person.
reportSchema.index({ reported: 1, createdAt: -1 });

const Report = mongoose.model("Report", reportSchema);

export default Report;
