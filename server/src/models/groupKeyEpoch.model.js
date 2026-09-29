import mongoose from "mongoose";

// One generation ("epoch") of a group's key (step 68). The key itself is made
// in a member's browser; the server only stores a copy locked for each person
// (AES-GCM with a key only that person and the one who locked it can derive),
// so it can never read it. A new epoch starts whenever someone leaves or is
// removed: they never get it.
// All copies of an epoch live in one document, created in one insert: two
// members making the next epoch at the same moment can't both win (unique
// index). At most 50 members, so the array stays small.
const lockedKeySchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Whose key pair locked it: the reader derives the same unlocking key from
    // their private key and this person's public key.
    wrappedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
}, { _id: false });

const groupKeyEpochSchema = new mongoose.Schema({
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    epoch: { type: Number, required: true, min: 1 },
    keys: { type: [lockedKeySchema], default: [] },
}, { timestamps: true });

groupKeyEpochSchema.index({ group: 1, epoch: 1 }, { unique: true });
// A member's copies across epochs.
groupKeyEpochSchema.index({ group: 1, "keys.user": 1 });

const GroupKeyEpoch = mongoose.model("GroupKeyEpoch", groupKeyEpochSchema);

export default GroupKeyEpoch;
