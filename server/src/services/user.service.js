import User from "../models/user.model.js"
import bcrypt from "bcrypt";
import AppError from "../utils/AppError.js";

const createUser = async (userData) => {

    // Only these fields can be set at registration. Spreading the whole request
    // body would let a client set anything else on the user (mass assignment),
    // e.g. isOnline, createdAt or its own _id.
    const { username, email, password, state } = userData;

    const hashedPassword = await bcrypt.hash(password, 10);
    const createdUser = await User.create({
        username,
        email,
        password: hashedPassword,
        state
    });

    const { password: _hashedPassword, ...UserWithoutPassword } = createdUser.toObject();

    return UserWithoutPassword;

}


const getUserById = async (userId) => {
    const user = await User.findById(userId);
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
        .select("username avatar state")
        .sort({ username: 1 })
        .limit(MAX_SEARCH_RESULTS)
        .lean();
}

const updateUser = async (userId, updateData) => {
    const allowedUpdates = {}
    if (updateData.username !== undefined) allowedUpdates.username = updateData.username;
    if (updateData.bio !== undefined) allowedUpdates.bio = updateData.bio;
    if (updateData.avatar !== undefined) allowedUpdates.avatar = updateData.avatar;
    if(Object.keys(allowedUpdates).length === 0) {
        throw new AppError("No valid fields provided for update", 400);
    }
    const updatedUser = await User.findByIdAndUpdate(userId, allowedUpdates, { returnDocument: "after", runValidators: true });
    if (!updatedUser) {
        throw new AppError("User not found", 404);
    }
    return updatedUser;
}

const changePassword = async (userId, currentPassword, newPassword) => {
    if (typeof currentPassword !== "string" || !currentPassword) {
        throw new AppError("Current password is required", 400);
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
    await user.save();
    return user;
}

export {
    createUser,
    getUserById,
    updateUser,
    changePassword,
    searchUsers
}   