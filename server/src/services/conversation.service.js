import mongoose from 'mongoose';
import  Conversation  from '../models/conversation.model.js';
import AppError from '../utils/AppError.js';
import User, { PUBLIC_USER_FIELDS } from '../models/user.model.js';
import Message from '../models/message.model.js';
import { isOnline } from "../presence.js";


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

    try {
        return await Conversation.create({
            participants: [currentUserId, otherUserId],
            conversationKey
        });
    } catch (err) {
        // Two requests (e.g. a double click, or both users at once) can both
        // miss the findOne above. The unique index lets only one create win;
        // the other gets a duplicate-key error (11000) and returns the winner.
        if (err.code === 11000) {
            return Conversation.findOne({ conversationKey });
        }
        throw err;
    }
}


// Query for the messages `userId` has not read yet in `conversation`:
// sent by the other participant, after the user's lastReadAt (all of them if
// the user never opened it). ObjectIds are built explicitly because
// aggregate() does not cast types the way find() does.
const unreadFilter = (conversation, userId) => {
    const lastRead = conversation.lastReadAt?.get(userId.toString());
    return {
        conversationId: conversation._id,
        sender: { $ne: new mongoose.Types.ObjectId(userId) },
        ...(lastRead ? { createdAt: { $gt: lastRead } } : {})
    };
};

const countUnread = (conversation, userId) => Message.countDocuments(unreadFilter(conversation, userId));

const getUserConversations = async (userId) => {
    const conversations = await Conversation.find({
        participants: userId
    })
    // lastSeen only here: people you chat with may see it, strangers who
    // search for you may not (it is not in PUBLIC_USER_FIELDS).
    .populate("participants", `${PUBLIC_USER_FIELDS} lastSeen`)
    .sort({ lastMessageAt: -1 });

    if (conversations.length === 0) {
        return [];
    }

    // One aggregation counts unread messages for every conversation at once,
    // instead of one query per conversation.
    const counts = await Message.aggregate([
        { $match: { $or: conversations.map((conversation) => unreadFilter(conversation, userId)) } },
        { $group: { _id: "$conversationId", count: { $sum: 1 } } }
    ]);
    const unreadById = new Map(counts.map((c) => [c._id.toString(), c.count]));

    // toJSON() applies the model's privacy rules (no lastReadAt).
    return conversations.map((conversation) => {
        const json = conversation.toJSON();
        return {
            ...json,
            participants: json.participants.map((participant) => ({ ...participant, online: isOnline(participant._id) })),
            unreadCount: unreadById.get(conversation._id.toString()) ?? 0
        };
    });
};

// Everyone who shares a conversation with the user: they are told when the
// user comes online or goes offline.
const getContactIds = async (userId) => {
    const ids = await Conversation.distinct("participants", { participants: userId });
    return ids.map(String).filter((id) => id !== String(userId));
};

const markConversationRead = async (conversationId, userId) => {
    const conversation = await getConversationForParticipant(conversationId, userId);
    // $set only this user's entry, so a message being saved at the same moment
    // (which writes lastMessage) is never overwritten.
    await Conversation.updateOne(
        { _id: conversation._id },
        { $set: { [`lastReadAt.${userId}`]: new Date() } }
    );
    return conversation;
};

export {
    createOrGetConversation,
    getUserConversations,
    getConversationForParticipant,
    countUnread,
    markConversationRead,
    getContactIds
};