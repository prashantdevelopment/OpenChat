import mongoose from 'mongoose';
import  Conversation  from '../models/conversation.model.js';
import AppError from '../utils/AppError.js';
import User from '../models/user.model.js';


const getConversationForParticipant = async (conversationId, userId) => {
    if (!mongoose.isValidObjectId(conversationId)) {
        throw new AppError("Invalid conversation id", 400);
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new AppError("Conversation not found", 404);
    }

    const isParticipant = conversation.participants.some(
        participantId => participantId.toString() === userId.toString()
    );
    if (!isParticipant) {
        throw new AppError("User is not a participant in this conversation", 403);
    }

    return conversation;
}


const createOrGetConversation = async (currentUserId, otherUserId) => {
    if (!mongoose.isValidObjectId(otherUserId)) {
        throw new AppError("Invalid user id", 400);
    }

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

export { createOrGetConversation, getUserConversations, getConversationForParticipant };