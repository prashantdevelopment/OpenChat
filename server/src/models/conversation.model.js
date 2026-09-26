import mongoose from "mongoose";

const lastMessageSchema = new mongoose.Schema({
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { _id: false });

const conversationSchema = new mongoose.Schema({

    participants:[
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    ],

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
                return ret;
            }
        }
    }
)


// A user's conversation list: participants (equality, multikey because it is
// an array) → lastMessageAt (sort, newest first).
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

const Conversation = mongoose.model("Conversation", conversationSchema);

export default Conversation;
