import mongoose from "mongoose";
import { INDIAN_STATE_CODES } from "../../../shared/indian-states.js";

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