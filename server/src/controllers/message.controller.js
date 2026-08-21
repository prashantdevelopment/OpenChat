import { createMessage , getMessagesByConversationId } from "../services/message.service.js";


const createMessageController = async (req, res) => {
    const { conversationId, content } = req.body;
    const currentUserId = req.user.userId;

    const message = await createMessage(conversationId, currentUserId, content);

    res.status(201).json({
        success: true,
        message
    });
}


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
    createMessageController,
    getMessagesByConversationIdController
}