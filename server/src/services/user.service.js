import User from "../models/user.model.js"
import bcrypt from "bcrypt";
import AppError from "../utils/AppError.js";

const createUser = async (userData) => {

    const hashedPassword = await bcrypt.hash(userData.password, 10);
    const createdUser = await User.create({
        ...userData,
        password: hashedPassword
    });

    const { password, ...UserWithoutPassword } = createdUser.toObject();

    return UserWithoutPassword;

}


const getUserById = async (userId) => {
    const user = await User.findById(userId);
    if (!user) {
        throw new AppError("User not found", 404);
    }
    return user;
}

const updateUser = async (userId, updateData) => {
    const allowedUpdates = {}
    if (updateData.username !== undefined) allowedUpdates.username = updateData.username;
    if (updateData.bio !== undefined) allowedUpdates.bio = updateData.bio;
    if (updateData.avatar !== undefined) allowedUpdates.avatar = updateData.avatar;
    if(Object.keys(allowedUpdates).length === 0) {
        throw new AppError("No valid fields provided for update", 400);
    }
    const updatedUser = await User.findByIdAndUpdate(userId, allowedUpdates, { new: true, runValidators: true });
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
    changePassword
}   