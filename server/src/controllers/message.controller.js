import { createMessage } from "../services/message.service.js";


const createMessageController = async (req, res) => {
    const { conversationId, content } = req.body;
    const currentUserId = req.user.userId;

    const message = await createMessage(conversationId, currentUserId, content);

    res.status(201).json({
        success: true,
        message
    });
}


export {
    createMessageController
}