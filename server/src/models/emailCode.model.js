import mongoose from "mongoose";

// A sign-up code sent to an email address (services/emailCode.service.js).
// Only a keyed hash of the code is kept. One per address: a new code replaces
// the old one. MongoDB deletes it by itself an hour after it was last sent
// (the code itself stops working after 10 minutes).
const emailCodeSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    // Wrong guesses for the current code.
    attempts: { type: Number, default: 0 },
    // Sends in the current hour, and when the last one went out.
    sends: { type: Number, default: 1 },
    windowStartedAt: { type: Date, default: Date.now },
    lastSentAt: { type: Date, default: Date.now, expires: 60 * 60 },
});

const EmailCode = mongoose.model("EmailCode", emailCodeSchema);

export default EmailCode;
