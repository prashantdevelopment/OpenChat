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
    
},
    {
        timestamps: true
    }
)


const Conversation = mongoose.model("Conversation", conversationSchema);

export default Conversation;
