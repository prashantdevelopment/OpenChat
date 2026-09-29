import { changePassword, createUser, discoverUsers, getPublicProfile, searchUsers } from "../services/user.service.js";
import { updateUser } from "../services/user.service.js";
import { endOtherSessions } from "../session.js";
import { startEmailCode } from "../services/emailCode.service.js";

// POST /api/users/email-code: step 1 of registration, a code to the address.
const emailCodeController = async (req, res) => {
    const { resendAfter } = await startEmailCode(req.body?.email);
    res.status(200).json({ success: true, message: "Check your email for a 6-digit code", resendAfter });
};

const createUserController = async (req, res) => { 
        const userData = req.body;
        const createdUser = await createUser(userData);
        res.status(201).json({
            success: true,
            message: "User created successfully",
            createdUser
        });
} 

const updateUserController = async (req, res) => {
    const userId = req.user.userId;
    const updateData = req.body;
    const updatedUser = await updateUser(userId, updateData);
    res.status(200).json({
        success: true,
        message: "User updated successfully",
        updatedUser
    });
}

const changePasswordController = async (req, res) => {
    const userId = req.user.userId;
    const { currentPassword, newPassword, encryptedPrivateKey } = req.body;
    await changePassword(userId, currentPassword, newPassword, encryptedPrivateKey);
    // Other devices logged in with the old password are logged out.
    await endOtherSessions(userId, req.user.sessionId);
    res.status(200).json({
        success: true,
        message: "Password changed successfully",
    });
}

const discoverUsersController = async (req, res) => {
    const { state, q, after } = req.query;
    const page = await discoverUsers({ state, q, after }, req.user.userId);
    res.status(200).json({ success: true, ...page });
};

const searchUsersController = async (req, res) => {
    const users = await searchUsers(req.query.q, req.user.userId);
    res.status(200).json({
        success: true,
        users
    });
}

const getProfileController = async (req, res) => {
    const user = await getPublicProfile(req.params.username, req.user.userId);
    res.status(200).json({ success: true, user });
};

export {
    emailCodeController,
    getProfileController,
    createUserController,
    updateUserController,
    changePasswordController,
    searchUsersController,
    discoverUsersController
}