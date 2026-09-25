import { getMessagesByConversationId } from "../services/message.service.js";


const getMessagesByConversationIdController = async (req, res) => {
    const { conversationId } = req.params;
    const currentUserId = req.user.userId;

    const { before, limit } = req.query;

    const { messages, hasMore } = await getMessagesByConversationId(conversationId, currentUserId, { before, limit });

    res.status(200).json({
        success: true,
        messages,
        hasMore
    });


}

export {
    getMessagesByConversationIdController
}
