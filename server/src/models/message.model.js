import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
        required: true
    },

    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    // End-to-end encrypted text (AES-GCM, see client/src/crypto/messages.js).
    // The server stores it but can never read it. message.service.js checks
    // the sizes before saving. System lines (below) have none.
    ciphertext: {
        type: String,
        required: function () { return this.messageType !== "system"; }
    },
    iv: {
        type: String,
        required: function () { return this.messageType !== "system"; }
    },
    // Group messages: which generation of the group key encrypted it (step 68).
    epoch: {
        type: Number,
        default: undefined
    },
    // A line the server writes in a group ("Riya joined"): who, and who did it
    // (an admin removing someone). Metadata the server has anyway, no text.
    system: {
        type: new mongoose.Schema({
            kind: { type: String, enum: ["created", "joined", "left", "removed", "renamed", "admin"], required: true },
            user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
            by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            // "renamed": the new name.
            name: { type: String }
        }, { _id: false }),
        default: undefined
    },
    // Random id (UUID) the sender's browser gives the message before sending.
    // If the reply gets lost and the browser retries, the server recognises
    // the same message instead of saving it twice (idempotency key).
    clientId: {
        type: String
    },
    messageType: {
        type: String,
        enum: ["text", "image", "video", "audio", "file", "call", "system"],
        default: "text",
        required: true
    },
    // Image, video, voice and file messages: the uploaded (encrypted) file. Its key
    // and details (type, name, size, caption) are inside the ciphertext above.
    attachment: {
        type: new mongoose.Schema({
            fileId: { type: String, required: true },
            size: { type: Number, required: true }
        }, { _id: false }),
        default: undefined
    }
    // Read state lives on the Conversation (lastReadAt), not on each message.
},
    {
        timestamps: true
    }


)

// Equality (conversationId) → Sort (createdAt, _id). Serves the paginated
// history (newest first, cursor on createdAt/_id) and the unread count
// (conversationId + createdAt range) without scanning other conversations.
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });

// One clientId per sender. Partial: older messages have no clientId.
messageSchema.index(
    { sender: 1, clientId: 1 },
    { unique: true, partialFilterExpression: { clientId: { $type: "string" } } }
);

const Message = mongoose.model("Message", messageSchema);

export default Message;