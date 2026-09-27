import { blockUser, listBlockedUsers, unblockUser } from "../services/block.service.js";

const listBlockedController = async (req, res) => {
    const users = await listBlockedUsers(req.user.userId);
    res.status(200).json({ success: true, users });
};

const blockController = async (req, res) => {
    await blockUser(req.user.userId, req.params.userId);
    res.status(200).json({ success: true, blocked: true });
};

const unblockController = async (req, res) => {
    await unblockUser(req.user.userId, req.params.userId);
    res.status(200).json({ success: true, blocked: false });
};

export { listBlockedController, blockController, unblockController };
