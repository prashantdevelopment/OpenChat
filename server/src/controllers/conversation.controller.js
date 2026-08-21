import { createOrGetConversation } from "../services/conversation.service.js";


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

export {
    createOrGetConversationController
}