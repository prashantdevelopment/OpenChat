import mongoose from "mongoose";

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
    
    lastMessage: {
        type: String,
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

},
    {
        timestamps: true
    }
)


// A user's conversation list: participants (equality, multikey because it is
// an array) → lastMessageAt (sort, newest first).
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

const Conversation = mongoose.model("Conversation", conversationSchema);

export default Conversation;
