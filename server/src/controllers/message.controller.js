import { getMessagesByConversationId } from "../services/message.service.js";


const getMessagesByConversationIdController = async (req, res) => {
    const { conversationId } = req.params;
    const currentUserId = req.user.userId;

    const messages = await getMessagesByConversationId(conversationId, currentUserId);

    res.status(200).json({
        success: true,
        messages
    });


}

export {
    getMessagesByConversationIdController
}
