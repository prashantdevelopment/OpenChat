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
    content: {
        type: String,
        required: true
    },
    messageType: {
        type: String,
        enum: ["text", "image", "video", "file"],
        default: "text",
        required: true
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

const Message = mongoose.model("Message", messageSchema);

export default Message;