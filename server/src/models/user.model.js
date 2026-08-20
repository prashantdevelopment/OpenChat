import mongoose from "mongoose";

const userSchema =  new mongoose.Schema({

    username: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        match: /^[a-z0-9._]+$/,
        minlength: 8,
        maxlength: 30,
        trim: true
        
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
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