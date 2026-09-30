import mongoose from "mongoose";
import { HIDDEN_CHARACTERS, normalizeName } from "./user.model.js";

// A group has at most this many members (invites still pending count too).
export const MAX_GROUP_MEMBERS = 50;

const lastMessageSchema = new mongoose.Schema({
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // "image" / "video" / "audio" / "file" lets the sidebar say "Photo" etc. (the caption
    // and file name are in the ciphertext).
    messageType: { type: String, default: "text" },
    // Groups: the key generation it was encrypted with.
    epoch: { type: Number, default: undefined }
}, { _id: false });

const conversationSchema = new mongoose.Schema({

    participants:[
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    ],

    // "direct" (1:1) or "group". Chats from before groups have no type: they
    // are direct, so queries for 1:1 chats use { type: { $ne: "group" } }.
    type: {
        type: String,
        enum: ["direct", "group"],
        default: "direct"
    },

    // Groups only. Members are the participants (at most MAX_GROUP_MEMBERS,
    // so the arrays stay small enough to embed); nobody becomes one without
    // accepting an invite (groupInvite.model.js).
    name: {
        type: String,
        set: normalizeName,
        required: [function () { return this.type === "group"; }, "Group name is required"],
        maxlength: [50, "Group name must be at most 50 characters long"],
        validate: [
            { validator: (v) => !HIDDEN_CHARACTERS.test(v), message: "Group name contains characters that aren't allowed" },
            { validator: (v) => /[\p{L}\p{N}]/u.test(v), message: "Group name must contain a letter or a number" },
        ]
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Admins invite; this switch lets every member invite (step 70).
    membersCanInvite: { type: Boolean, default: false },
    // When each member joined: { "<userId>": Date }. New members don't see
    // what was written before they joined.
    joinedAt: {
        type: Map,
        of: Date,
        default: undefined
    },
    // The group's key must change before anyone writes again while its latest
    // epoch is at most this one (someone left or was removed, or an invite was
    // taken back): they held that key (groupKeys.service.js).
    staleKeyEpoch: { type: Number, default: undefined },

    // 1:1: both user ids, sorted ("<a>_<b>"), so a pair has one chat.
    // Group: "group_<its id>".
    conversationKey: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    
    // Sidebar preview: the newest message, still encrypted (the browser
    // decrypts it). The sender is needed to decrypt it (authenticated data).
    // Old documents that still hold a plain-text string read as null.
    lastMessage: {
        type: lastMessageSchema,
        default: null
    },

    lastMessageAt: {
        type: Date,
        default: null
    },

    // When each participant last read this conversation: { "<userId>": Date }.
    // Unread count = messages from the other user created after my lastReadAt.
    // One update marks everything read (no isRead flag on every message), and
    // a 1:1 conversation only ever has two entries, so embedding is safe.
    lastReadAt: {
        type: Map,
        of: Date,
        default: () => new Map()
    },

    // When each participant's app last received this conversation's messages
    // (delivered receipts). Same idea: my message is delivered if it was
    // created before the other participant's lastDeliveredAt.
    lastDeliveredAt: {
        type: Map,
        of: Date,
        default: () => new Map()
    },

    // Notifications muted by each person until a time: { "<userId>": Date }
    // ("always" is a date far away). Nobody else is told.
    mutedUntil: {
        type: Map,
        of: Date,
        default: undefined
    },

},
    {
        timestamps: true,
        // Both maps include the OTHER participant's times. They only leave the
        // server as `receipts`, after the read-receipt privacy setting was
        // applied (conversation.service.js), never raw.
        toJSON: {
            transform: (_doc, ret) => {
                delete ret.lastReadAt;
                delete ret.lastDeliveredAt;
                delete ret.mutedUntil;
                return ret;
            }
        }
    }
)


// A user's conversation list: participants (equality, multikey because it is
// an array) → lastMessageAt (sort, newest first).
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

conversationSchema.pre("validate", function () {
    if (this.type === "group" && !this.conversationKey) this.conversationKey = `group_${this._id}`;
});

const Conversation = mongoose.model("Conversation", conversationSchema);

export default Conversation;
