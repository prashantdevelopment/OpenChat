import mongoose from "mongoose";

// An invitation to join a group. Nobody is added to a group without accepting
// one (group.service.js has the rules).
// status: pending → accepted / declined / cancelled (by the inviter or an
// admin); a pending one past expiresAt counts as expired.
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const groupInviteSchema = new mongoose.Schema({
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
        type: String,
        enum: ["pending", "accepted", "declined", "cancelled", "expired"],
        default: "pending"
    },
    expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + INVITE_LIFETIME_MS) },
    respondedAt: { type: Date, default: null },
}, { timestamps: true });

// My invites (pending, newest first).
groupInviteSchema.index({ to: 1, status: 1, createdAt: -1 });
// One pending invite per person and group (two admins inviting at once can't
// create two).
groupInviteSchema.index({ group: 1, to: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });
// A group's invites; and a decline blocks new invites for a while.
groupInviteSchema.index({ group: 1, status: 1 });
// The invite rate limit counts what a user sent recently.
groupInviteSchema.index({ from: 1, createdAt: -1 });
// Old invites go away after 30 days (longer than any rule needs them).
groupInviteSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const GroupInvite = mongoose.model("GroupInvite", groupInviteSchema);

export default GroupInvite;
