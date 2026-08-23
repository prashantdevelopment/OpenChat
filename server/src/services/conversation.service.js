import  Conversation  from '../models/conversation.model.js';
import AppError from '../utils/AppError.js';
import User from '../models/user.model.js';  


const createOrGetConversation = async (currentUserId, otherUserId) => {
    if (currentUserId === otherUserId) {
        throw new AppError("Cannot create a conversation with yourself", 400);
    }

   const parallelFetch = await Promise.all([
        User.findById(currentUserId),
        User.findById(otherUserId)
    ]);

    const [currentUser, otherUser] = parallelFetch;

    if (!currentUser || !otherUser) {
        throw new AppError("One or both users not found", 404);
    }

    const conversationKey = [currentUserId, otherUserId].sort().join('_');

    const existingConversation = await Conversation.findOne({ conversationKey });

    if (existingConversation) {
        return existingConversation;
    }

    const newConversation = await Conversation.create({
        participants: [currentUserId, otherUserId],
        conversationKey
    });

    return newConversation;
}


const getUserConversations = async (userId) => {
    const conversations = await Conversation.find({
        participants: userId
    })
    .populate("participants", "username email")
    .sort({ lastMessageAt: -1 });

    return conversations;
};

export { createOrGetConversation, getUserConversations };