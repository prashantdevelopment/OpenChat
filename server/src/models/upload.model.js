import mongoose from "mongoose";

// One uploaded file (its encrypted bytes are in storage, see src/storage).
// It belongs to a conversation: only its participants may download it, and
// only its owner may attach it to a message there.
const uploadSchema = new mongoose.Schema({
    // Random 32-hex id, also the file name in storage.
    _id: {
        type: String,
        required: true
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
        required: true
    },
    // Size of the encrypted file in bytes (the only thing the server knows about it).
    size: {
        type: Number,
        required: true
    }
}, {
    timestamps: true
});

const Upload = mongoose.model("Upload", uploadSchema);

export default Upload;
