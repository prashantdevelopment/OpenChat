import mongoose from "mongoose";

// One user blocking another. A block separates both people: neither can
// message, call or find the other (block.service.js). Its own collection, not
// an array on the user: it can grow without limit and is queried both ways
// ("whom did I block" and "who blocked me").
const blockSchema = new mongoose.Schema({
    blocker: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    blocked: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

// One block per pair and direction; "whom did I block" uses it too (prefix).
blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
// "Who blocked me".
blockSchema.index({ blocked: 1 });

const Block = mongoose.model("Block", blockSchema);

export default Block;
