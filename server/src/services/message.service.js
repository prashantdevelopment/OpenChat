import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import AppError from "../utils/AppError.js";



const createMessage = async (conversationId, currentUserId, content) => {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new AppError("Conversation not found", 404);
    }

    const isParticipant = conversation.participants.some(
        participantId => participantId.toString() === currentUserId.toString()
    );

    if (!isParticipant) {
        throw new AppError("User is not a participant in this conversation", 403);
    }

    if (!content || content.trim() === "") {
        throw new AppError("Message content cannot be empty", 400);
    }


    const message = new Message({
        conversationId,
        sender: currentUserId,
        content
    });

    conversation.lastMessage = content.trim();
    conversation.lastMessageAt = new Date();

    await conversation.save();

    
    return message;
}


export {
    createMessage
}