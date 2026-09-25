import mongoose from "mongoose";
import { createPublicKey } from "crypto";
import { INDIAN_STATE_CODES } from "../../../shared/indian-states.js";

// --- End-to-end encryption keys ---------------------------------------------
// Created in the browser at registration (client/src/crypto/keys.js). The
// server cannot use them; it only checks that they have the right shape so no
// garbage is stored.

const isBase64 = (value) => typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
const base64Length = (value) => Buffer.from(value, "base64").length;

// The public key must really be an ECDH P-256 key in SPKI format.
const isP256PublicKey = (value) => {
    if (!isBase64(value)) return false;
    try {
        const key = createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
        return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
    } catch {
        return false;
    }
};

// The private key, locked with a key derived from the user's password.
const encryptedPrivateKeySchema = new mongoose.Schema({
    data: {
        type: String,
        required: true,
        validate: { validator: (v) => isBase64(v) && base64Length(v) >= 32 && base64Length(v) <= 512, message: "Invalid encrypted private key" }
    },
    iv: {
        type: String,
        required: true,
        validate: { validator: (v) => isBase64(v) && base64Length(v) === 12, message: "IV must be 12 bytes" }
    },
    salt: {
        type: String,
        required: true,
        validate: { validator: (v) => isBase64(v) && base64Length(v) === 16, message: "Salt must be 16 bytes" }
    },
    iterations: {
        type: Number,
        required: true,
        min: [100_000, "Too few PBKDF2 iterations"],
        max: [10_000_000, "Too many PBKDF2 iterations"],
        validate: { validator: Number.isInteger, message: "Iterations must be a whole number" }
    }
}, { _id: false });

// Names nobody can register, so no one can pose as the app or its staff.
// Dots and underscores are ignored when comparing, so "open_chat" is blocked too.
const RESERVED_USERNAMES = new Set([
    "admin", "administrator", "root", "system", "support", "help", "helpdesk",
    "moderator", "mod", "staff", "official", "security", "openchat", "team",
]);

const userSchema =  new mongoose.Schema({

    username: {
        type: String,
        required: [true, "Username is required"],
        unique: true,
        lowercase: true,
        minlength: [3, "Username must be at least 3 characters long"],
        maxlength: [30, "Username must be at most 30 characters long"],
        trim: true,
        // Each rule has its own message; Mongoose reports the first one that fails.
        validate: [
            { validator: (v) => /^[a-z0-9._]+$/.test(v), message: "Username can only contain letters, numbers, dots and underscores" },
            { validator: (v) => /^[a-z0-9]/.test(v), message: "Username must start with a letter or a number" },
            { validator: (v) => !v.endsWith("."), message: "Username cannot end with a dot" },
            { validator: (v) => !v.includes(".."), message: "Username cannot contain two dots in a row" },
            { validator: (v) => !RESERVED_USERNAMES.has(v.replace(/[._]/g, "")), message: "This username is reserved" },
        ]

    },
    email: {
        type: String,
        required: [true, "Email is required"],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please enter a valid email address"],
    },
    // Chosen by the user at registration (not detected from the IP address).
    state: {
        type: String,
        required: [true, "Please select your state"],
        enum: { values: INDIAN_STATE_CODES, message: "Please select a valid state" },
    },
    password: {
        type: String,
        required: true,
        select: false,


    },
    // Public by design: others use it to encrypt messages for this user.
    publicKey: {
        type: String,
        required: [true, "Encryption keys are required"],
        validate: { validator: isP256PublicKey, message: "Invalid public key" }
    },
    // Only the user needs this (to unlock their private key at login), so it
    // is never loaded unless a query asks for it.
    encryptedPrivateKey: {
        type: encryptedPrivateKeySchema,
        required: [true, "Encryption keys are required"],
        select: false
    },
    avatar: {
        type: String,
        default: ""
    },
    bio: {
        type: String,
        default: ""
    },
    isOnline: {
        type: Boolean,
        default: false
    },
    lastSeen: {
        type: Date,
        default: null
    },
    

},
    {
        timestamps: true,
        // Safety net for every response: even if a query loads the password
        // hash (select("+password")), it is never serialized to JSON.
        toJSON: {
            transform: (_doc, ret) => {
                delete ret.password;
                return ret;
            }
        }
    }
);

// What other users may see about someone (search results, conversation
// participants). Never email, password or anything else private.
export const PUBLIC_USER_FIELDS = "username avatar state";

const User = mongoose.model("User", userSchema);

export default User;