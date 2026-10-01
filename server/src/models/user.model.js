import mongoose from "mongoose";
import { createPublicKey } from "crypto";
import { INDIAN_STATE_CODES } from "../../../shared/indian-states.js";
import { base64Length, isBase64 } from "../utils/base64.js";

// --- End-to-end encryption keys ---------------------------------------------
// Created in the browser at registration (client/src/crypto/keys.js). The
// server cannot use them; it only checks that they have the right shape so no
// garbage is stored.

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

// The private key locked a second time, with a secret from a passkey on one of
// the user's devices (WebAuthn PRF, step 79): "Unlock with fingerprint or face"
// instead of typing the password. The secret never leaves the device's secure
// hardware except into the user's own browser, so the server (or anyone who
// copies the database) can't open this copy either.
const passkeyKeySchema = new mongoose.Schema({
    // The passkey's credential id: the browser asks the device for this one.
    credentialId: {
        type: String,
        required: true,
        validate: { validator: (v) => isBase64(v) && base64Length(v) >= 16 && base64Length(v) <= 1023, message: "Invalid credential id" }
    },
    // What the device's PRF is evaluated on (random, 32 bytes).
    salt: {
        type: String,
        required: true,
        validate: { validator: (v) => isBase64(v) && base64Length(v) === 32, message: "Salt must be 32 bytes" }
    },
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
    // Which device, for the list in Settings ("Edge on Windows").
    name: {
        type: String,
        required: [true, "Name the device"],
        trim: true,
        maxlength: [60, "Device name must be at most 60 characters long"],
        validate: { validator: (v) => !HIDDEN_CHARACTERS.test(v), message: "Device name contains characters that aren't allowed" }
    },
    createdAt: { type: Date, default: Date.now }
});

// Names nobody can register, so no one can pose as the app or its staff.
// Dots and underscores are ignored when comparing, so "open_chat" is blocked too.
const RESERVED_USERNAMES = new Set([
    "admin", "administrator", "root", "system", "support", "help", "helpdesk",
    "moderator", "mod", "staff", "official", "security", "openchat", "team",
]);

const USERNAME_RULES = [
    { validator: (v) => /^[a-z0-9._]+$/.test(v), message: "Username can only contain letters, numbers, dots and underscores" },
    { validator: (v) => /^[a-z0-9]/.test(v), message: "Username must start with a letter or a number" },
    { validator: (v) => !v.endsWith("."), message: "Username cannot end with a dot" },
    { validator: (v) => !v.includes(".."), message: "Username cannot contain two dots in a row" },
    { validator: (v) => !RESERVED_USERNAMES.has(v.replace(/[._]/g, "")), message: "This username is reserved" },
];

// The same rules as the schema, for usernames the server makes up itself
// (suggested from a Google address).
export const isAllowedUsername = (v) => v.length >= 3 && v.length <= 30 && USERNAME_RULES.every((rule) => rule.validator(v));

// Characters a display name may not contain: control characters, invisible
// ones (zero-width, word joiner, BOM) and the ones that flip the text
// direction. With these, a name could hide text or pose as someone else.
export const HIDDEN_CHARACTERS = /[\p{Cc}\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/u;
// One form for the same letters (typed on different keyboards), single
// spaces, no spaces at the ends. Also used for group names.
export const normalizeName = (v) => (typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim() : v);

const userSchema =  new mongoose.Schema({

    // The name shown in chats (Instagram-style: the name big, @username small
    // below it). Any script, not unique; people are still found only by
    // username. Accounts from before names existed have none: the app shows
    // their username instead.
    name: {
        type: String,
        set: normalizeName,
        maxlength: [40, "Name must be at most 40 characters long"],
        validate: [
            { validator: (v) => !HIDDEN_CHARACTERS.test(v), message: "Name contains characters that aren't allowed" },
            { validator: (v) => /[\p{L}\p{N}]/u.test(v), message: "Name must contain a letter or a number" },
        ]
    },
    username: {
        type: String,
        required: [true, "Username is required"],
        unique: true,
        lowercase: true,
        minlength: [3, "Username must be at least 3 characters long"],
        maxlength: [30, "Username must be at most 30 characters long"],
        trim: true,
        // Each rule has its own message; Mongoose reports the first one that fails.
        validate: USERNAME_RULES

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
    // bcrypt hash. Accounts made with Google have none: they sign in with
    // Google, and their private key is locked with a separate encryption
    // password that never reaches the server.
    password: {
        type: String,
        required: function () { return !this.googleId; },
        select: false,
    },
    // Google's stable id for the person ("sub"), set when they sign in with
    // Google or connect it. Private: never sent to other users.
    googleId: {
        type: String,
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
    // Passkey copies of the locked private key (one per device, at most
    // MAX_PASSKEYS, passkey.service.js). Only for the user, like the above.
    passkeyKeys: {
        type: [passkeyKeySchema],
        default: [],
        select: false
    },
    // Id of the profile photo (see avatar.service.js), "" = none. Only set
    // through the avatar upload: never a URL from the client.
    avatar: {
        type: String,
        default: "",
        match: [/^([a-f0-9]{32})?$/, "Invalid avatar"]
    },
    // Public "about" line, shown next to the name in search results.
    bio: {
        type: String,
        trim: true,
        maxlength: [160, "Bio must be at most 160 characters long"],
        default: ""
    },
    // Privacy: share read receipts. Off = others don't see when you read their
    // messages, and you don't see theirs either (like WhatsApp).
    readReceipts: {
        type: Boolean,
        default: true
    },
    // Privacy: listed on the Discover page (people by state). Off = only
    // findable by someone who types your username.
    discoverable: {
        type: Boolean,
        default: true
    },
    // Notifications while OpenChat is closed: show who a message is from
    // (off: just "OpenChat · New message"). The text is never in them.
    pushShowSender: {
        type: Boolean,
        default: true
    },
    // When the user's last tab closed. Whether they are online right now is
    // kept in memory (src/presence.js), not here.
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
                delete ret.googleId;
                return ret;
            }
        }
    }
);

// What other users may see about someone (search results, conversation
// participants). Never email, password or anything else private. The public
// key is public by design: others need it to encrypt messages for this user.
// Discover: people of one state, in username order.
userSchema.index({ state: 1, username: 1 });

// One account per Google account. Partial: most users have none.
userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: "string" } } });

// Serving a profile photo checks that its id belongs to someone: an index on
// the users that have one (most don't).
userSchema.index({ avatar: 1 }, { partialFilterExpression: { avatar: { $gt: "" } } });

export const PUBLIC_USER_FIELDS = "name username avatar bio state publicKey";

const User = mongoose.model("User", userSchema);

export default User;