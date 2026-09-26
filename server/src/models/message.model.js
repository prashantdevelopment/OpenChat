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
    // the sizes before saving.
    ciphertext: {
        type: String,
        required: true
    },
    iv: {
        type: String,
        required: true
    },
    // Random id (UUID) the sender's browser gives the message before sending.
    // If the reply gets lost and the browser retries, the server recognises
    // the same message instead of saving it twice (idempotency key).
    clientId: {
        type: String
    },
    messageType: {
        type: String,
        enum: ["text", "image", "video", "file"],
        default: "text",
        required: true
    },
    // Image, video and file messages: the uploaded (encrypted) file. Its key
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