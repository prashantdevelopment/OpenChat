import { createOrGetConversation, getUserConversations, setMute } from "../services/conversation.service.js";


const createOrGetConversationController = async (req, res) => {
    const currentUserId = req.user.userId;
    const otherUserId = req.body.otherUserId;

    if (!otherUserId) {
        return res.status(400).json({
            success: false,
            message: "otherUserId is required"
        });
    }

    const conversation = await createOrGetConversation(currentUserId, otherUserId);

    res.status(200).json({
        success: true,
        conversation
    });
}

const getUserConversationsController = async (req, res) => {
    const currentUserId = req.user.userId;

    const conversations = await getUserConversations(currentUserId);

    res.status(200).json({
        success: true,
        conversations
    });
}

// Mute this chat's notifications: { duration: "8h" | "1w" | "always" | null }.
const muteController = async (req, res) => {
    const duration = req.body?.duration === undefined ? undefined : req.body.duration;
    const mutedUntil = await setMute(req.params.conversationId, req.user.userId, duration ?? null);
    res.status(200).json({ success: true, mutedUntil });
}

export {
    createOrGetConversationController,
    getUserConversationsController,
    muteController
}
