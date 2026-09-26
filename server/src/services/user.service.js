import User, { PUBLIC_USER_FIELDS } from "../models/user.model.js"
import bcrypt from "bcrypt";
import AppError from "../utils/AppError.js";

const createUser = async (userData) => {

    // Only these fields can be set at registration. Spreading the whole request
    // body would let a client set anything else on the user (mass assignment),
    // e.g. isOnline, createdAt or its own _id.
    // The two key fields are created in the browser (end-to-end encryption).
    const { username, email, password, state, publicKey, encryptedPrivateKey } = userData;

    const hashedPassword = await bcrypt.hash(password, 10);
    const createdUser = await User.create({
        username,
        email,
        password: hashedPassword,
        state,
        publicKey,
        encryptedPrivateKey
    });

    // The locked private key is only handed out at login (to its owner).
    const { password: _hashedPassword, encryptedPrivateKey: _lockedKey, ...UserWithoutPassword } = createdUser.toObject();

    return UserWithoutPassword;

}


// The logged-in user's own profile, including their locked private key: after
// a refresh the browser may need it to unlock the key again. Only for the owner.
const getCurrentUser = async (userId) => {
    const user = await User.findById(userId).select("+encryptedPrivateKey");
    if (!user) {
        throw new AppError("User not found", 404);
    }
    return user;
}

const MAX_SEARCH_RESULTS = 20;

// Finds users whose username starts with `query` (case-insensitive).
// Returns only public profile fields — never email or password.
const searchUsers = async (query, currentUserId) => {
    if (typeof query !== "string" || query.trim() === "") {
        throw new AppError("Search query is required", 400);
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length > 30) {
        throw new AppError("Search query is too long", 400);
    }

    // The query goes into a regex, so escape every regex special character:
    // otherwise ".*" would match everyone and patterns like "(a+)+$" could
    // make the database work very hard (ReDoS).
    const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Usernames are stored in lowercase, so an anchored "^prefix" regex can use
    // the username index.
    return User.find({
        username: { $regex: `^${escapedQuery}` },
        _id: { $ne: currentUserId },
    })
        .select(PUBLIC_USER_FIELDS)
        .sort({ username: 1 })
        .limit(MAX_SEARCH_RESULTS)
        .lean();
}

// The profile fields a user may change (settings page). Not the avatar:
// a free URL would make everyone who sees it load a file from any server
// (leaking their IP address). Photos come with uploads (plan step 36).
const updateUser = async (userId, updateData) => {
    const allowedUpdates = {}
    if (updateData.username !== undefined) allowedUpdates.username = updateData.username;
    if (updateData.bio !== undefined) allowedUpdates.bio = updateData.bio;
    if (updateData.state !== undefined) allowedUpdates.state = updateData.state;
    if(Object.keys(allowedUpdates).length === 0) {
        throw new AppError("No valid fields provided for update", 400);
    }
    const updatedUser = await User.findByIdAndUpdate(userId, allowedUpdates, { returnDocument: "after", runValidators: true });
    if (!updatedUser) {
        throw new AppError("User not found", 404);
    }
    return updatedUser;
}

// The private key is locked with the password, so a new password needs a newly
// locked key (made in the browser with rewrapPrivateKey). Both are saved
// together; otherwise the key would stay locked with the old password and the
// user could never open it again.
const changePassword = async (userId, currentPassword, newPassword, encryptedPrivateKey) => {
    if (typeof currentPassword !== "string" || !currentPassword) {
        throw new AppError("Current password is required", 400);
    }
    if (!encryptedPrivateKey || typeof encryptedPrivateKey !== "object") {
        throw new AppError("encryptedPrivateKey (your key locked with the new password) is required", 400);
    }

    const user = await User.findById(userId).select("+password");
    if (!user) {
        throw new AppError("User not found", 404);
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
        throw new AppError("Current password is incorrect", 401);
    }
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedNewPassword;
    // Only the four known fields; the schema validates their shape on save.
    const { data, iv, salt, iterations } = encryptedPrivateKey;
    user.encryptedPrivateKey = { data, iv, salt, iterations };
    await user.save();
    return user;
}

export {
    createUser,
    getCurrentUser,
    updateUser,
    changePassword,
    searchUsers
}   