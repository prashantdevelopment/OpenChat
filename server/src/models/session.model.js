import mongoose from "mongoose";

// A login session (src/session.js). The cookie holds a random token; only its
// SHA-256 hash is stored here, so the database alone can't log anyone in.
// Kept in the database (not in memory) so that logging out, "log out other
// devices" and password changes still hold after the server restarts.
const sessionSchema = new mongoose.Schema({
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // "Keep me logged in": 60 days after the last use (renewed while used);
    // without it, a day and the browser's own session.
    remember: { type: Boolean, default: true },
    // Shown in Settings ("Chrome on Android"). Nothing more about the device.
    device: { type: String, default: "Unknown device" },
    lastUsedAt: { type: Date, default: Date.now },
    // The hard limit (a year after logging in, or a day without "remember").
    absoluteExpiresAt: { type: Date, required: true },
    // When it stops working: the idle limit, never past the hard one.
    // MongoDB deletes the session by itself then.
    expiresAt: { type: Date, required: true, expires: 0 },
}, { timestamps: { createdAt: true, updatedAt: false } });

const Session = mongoose.model("Session", sessionSchema);

export default Session;
