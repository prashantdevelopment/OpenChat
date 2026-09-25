import mongoose from "mongoose";
import { INDIAN_STATE_CODES } from "../../../shared/indian-states.js";

const userSchema =  new mongoose.Schema({

    username: {
        type: String,
        required: [true, "Username is required"],
        unique: true,
        lowercase: true,
        match: [/^[a-z0-9._]+$/, "Username can only contain letters, numbers, dots and underscores"],
        minlength: [8, "Username must be at least 8 characters long"],
        maxlength: [30, "Username must be at most 30 characters long"],
        trim: true

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
        timestamps: true
    }
);

const User = mongoose.model("User", userSchema);

export default User;