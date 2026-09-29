import mongoose from "mongoose";

// One browser's Web Push subscription (services/push.service.js): where its
// push service accepts messages for it, and the keys to encrypt them (made by
// the browser; they only let the server encrypt for it). Tied to the login
// session that turned it on, so logging out on that device stops it.
const pushSubscriptionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
        type: new mongoose.Schema({ p256dh: { type: String, required: true }, auth: { type: String, required: true } }, { _id: false }),
        required: true,
    },
}, { timestamps: true });

const PushSubscription = mongoose.model("PushSubscription", pushSubscriptionSchema);

export default PushSubscription;
