import Message from "../models/message.model.js";
import AppError from "../utils/AppError.js";
import { getConversationForParticipant } from "./conversation.service.js";

const MAX_MESSAGE_LENGTH = 2000;


const createMessage = async (conversationId, currentUserId, content) => {
    if (typeof content !== "string" || content.trim() === "") {
        throw new AppError("Message content cannot be empty", 400);
    }

    const trimmedContent = content.trim();
    if (trimmedContent.length > MAX_MESSAGE_LENGTH) {
        throw new AppError(`Message cannot be longer than ${MAX_MESSAGE_LENGTH} characters`, 400);
    }

    const conversation = await getConversationForParticipant(conversationId, currentUserId);

    const message = await Message.create({
        conversationId,
        sender: currentUserId,
        content: trimmedContent
    });

    conversation.lastMessage = trimmedContent;
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();

    return message;
}


const getMessagesByConversationId = async (conversationId, currentUserId) => {
    await getConversationForParticipant(conversationId, currentUserId);

    const messages = await Message.find({ conversationId }).sort({ createdAt: 1 });
    return messages;
}


export {
    createMessage,
    getMessagesByConversationId
}
