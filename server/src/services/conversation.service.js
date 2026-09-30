import mongoose from 'mongoose';
import { EventEmitter } from "events";
import  Conversation  from '../models/conversation.model.js';
import AppError from '../utils/AppError.js';
import User, { PUBLIC_USER_FIELDS } from '../models/user.model.js';
import Message from '../models/message.model.js';
import { isOnline } from "../presence.js";
import { assertNotBlocked, blockRelations } from "./block.service.js";

// Muting a chat (step 72): no pushes, alerts or rings for it until then.
// "always" is stored as a date far away. muteEvents tells my other tabs.
export const muteEvents = new EventEmitter();
const MUTE_FOR = { "8h": 8 * 60 * 60 * 1000, "1w": 7 * 24 * 60 * 60 * 1000 };
const ALWAYS = new Date("9999-12-31T00:00:00Z");

// Until when this person muted this chat (null: not muted, or it ran out).
const mutedUntilFor = (conversation, userId) => {
    const until = conversation.mutedUntil?.get(String(userId));
    return until && until > new Date() ? until : null;
};
const isMuted = (conversation, userId) => mutedUntilFor(conversation, userId) !== null;

// duration: "8h", "1w", "always", or null to unmute.
const setMute = async (conversationId, userId, duration) => {
    if (duration !== null && !(duration in MUTE_FOR) && duration !== "always") {
        throw new AppError('duration must be "8h", "1w", "always" or null', 400);
    }
    const conversation = await getChatForMember(conversationId, userId);
    const until = duration === null ? null : duration === "always" ? ALWAYS : new Date(Date.now() + MUTE_FOR[duration]);
    await Conversation.updateOne(
        { _id: conversation._id },
        until ? { $set: { [`mutedUntil.${userId}`]: until } } : { $unset: { [`mutedUntil.${userId}`]: "" } }
    );
    muteEvents.emit("changed", { userId: String(userId), conversationId: String(conversation._id), mutedUntil: until });
    return until;
};

// Everything here is about 1:1 chats. Groups (group.service.js) stay out of
// these paths (messages, uploads, calls, the chat list, presence) until they
// get their own encryption and screens (steps 68-69): chats from before groups
// have no type, so a 1:1 chat is "not a group".
const DIRECT = { type: { $ne: "group" } };


const getConversationForParticipant = async (conversationId, userId) => {
    if (!mongoose.isValidObjectId(conversationId)) {
        throw new AppError("Invalid conversation id", 400);
    }

    const conversation = await Conversation.findOne({ _id: conversationId, ...DIRECT });
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


// A chat the user is in: 1:1 or group (step 69: group chats use the same
// message, upload, receipt and typing paths; 1:1-only paths such as calls
// and blocks keep using getConversationForParticipant).
const getChatForMember = async (conversationId, userId) => {
    if (!mongoose.isValidObjectId(conversationId)) {
        throw new AppError("Invalid conversation id", 400);
    }
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new AppError("Conversation not found", 404);
    }
    if (!conversation.participants.some((id) => String(id) === String(userId))) {
        throw new AppError("User is not a participant in this conversation", 403);
    }
    return conversation;
};

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

    // An existing chat still opens (its history stays readable); a new one
    // can't be started across a block.
    if (existingConversation) {
        return existingConversation;
    }
    await assertNotBlocked(currentUserId, otherUserId, "You can't message this person");

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
// In a group, nothing from before the user joined is unread for them, and
// "joined/left" lines never count.
const unreadFilter = (conversation, userId) => {
    const lastRead = [conversation.lastReadAt?.get(userId.toString()), conversation.joinedAt?.get(userId.toString())]
        .filter(Boolean)
        .reduce((a, b) => (a > b ? a : b), null);
    return {
        conversationId: conversation._id,
        sender: { $ne: new mongoose.Types.ObjectId(userId) },
        messageType: { $ne: "system" },
        ...(lastRead ? { createdAt: { $gt: lastRead } } : {})
    };
};

const countUnread = (conversation, userId) => Message.countDocuments(unreadFilter(conversation, userId));

const getUserConversations = async (userId) => {
    const conversations = await Conversation.find({
        participants: userId,
        ...DIRECT
    })
    // lastSeen only here: people you chat with may see it, strangers who
    // search for you may not (it is not in PUBLIC_USER_FIELDS).
    // readReceipts is loaded to apply the privacy rule, then left out.
    .populate("participants", `${PUBLIC_USER_FIELDS} lastSeen readReceipts`)
    .sort({ lastMessageAt: -1 });

    if (conversations.length === 0) {
        return [];
    }

    // Across a block, neither sees the other online or when they were last seen.
    const { blockedByMe, separated } = await blockRelations(userId);

    // One aggregation counts unread messages for every conversation at once,
    // instead of one query per conversation.
    const counts = await Message.aggregate([
        { $match: { $or: conversations.map((conversation) => unreadFilter(conversation, userId)) } },
        { $group: { _id: "$conversationId", count: { $sum: 1 } } }
    ]);
    const unreadById = new Map(counts.map((c) => [c._id.toString(), c.count]));

    // toJSON() applies the model's privacy rules (no raw lastReadAt/lastDeliveredAt).
    return conversations.map((conversation) => {
        const json = conversation.toJSON();
        const otherIds = json.participants.map((participant) => String(participant._id)).filter((id) => id !== String(userId));
        return {
            ...json,
            participants: json.participants.map(({ readReceipts: _setting, lastSeen, ...participant }) =>
                separated.has(String(participant._id))
                    ? { ...participant, lastSeen: null, online: false }
                    : { ...participant, lastSeen, online: isOnline(participant._id) }
            ),
            // Only the blocker learns about the block (the blocked person is never told).
            blockedByMe: otherIds.some((id) => blockedByMe.has(id)),
            receipts: receiptsFor(conversation, userId),
            mutedUntil: mutedUntilFor(conversation, userId),
            unreadCount: unreadById.get(conversation._id.toString()) ?? 0
        };
    });
};

// Read receipts are shared only if every participant allows them: turning
// them off hides your reads from others and theirs from you.
const shareReadReceipts = (participants) => participants.every((participant) => participant.readReceipts !== false);

// When the OTHER participant last received / read the conversation, as seen
// by userId. My message is delivered if created before deliveredAt, read if
// before readAt. `conversation` must have its participants populated.
const receiptsFor = (conversation, userId) => {
    const other = conversation.participants.find((participant) => participant._id.toString() !== userId.toString());
    if (!other) return { deliveredAt: null, readAt: null };
    const otherId = other._id.toString();
    return {
        deliveredAt: conversation.lastDeliveredAt?.get(otherId) ?? null,
        readAt: shareReadReceipts(conversation.participants) ? (conversation.lastReadAt?.get(otherId) ?? null) : null
    };
};

// A group's receipts as userId sees them: delivered when every other member's
// app has it, read when every other member who shares read receipts has read
// it (none if userId doesn't share them). Someone who joined later counts as
// having everything from before. `people`: the members with readReceipts.
const groupReceiptsFor = (conversation, userId, people) => {
    const others = people.filter((person) => String(person._id) !== String(userId));
    const me = people.find((person) => String(person._id) === String(userId));
    const at = (map, id) => {
        const joined = conversation.joinedAt?.get(String(id));
        const time = map?.get(String(id));
        return time && joined ? (time > joined ? time : joined) : (time ?? joined ?? null);
    };
    const earliest = (times) => (times.length === 0 || times.includes(null) ? null : times.reduce((a, b) => (a < b ? a : b)));
    const readers = others.filter((person) => person.readReceipts !== false);
    return {
        deliveredAt: others.length ? earliest(others.map((person) => at(conversation.lastDeliveredAt, person._id))) : null,
        readAt: me?.readReceipts === false || readers.length === 0 ? null : earliest(readers.map((person) => at(conversation.lastReadAt, person._id))),
    };
};

// Whether the participants of a (not populated) conversation share read receipts.
const readReceiptsShared = async (conversation) =>
    shareReadReceipts(await User.find({ _id: { $in: conversation.participants } }).select("readReceipts"));

// Up to when userId's messages show as read to them (the "Seen" ticks), in a
// 1:1 chat or a group; null if nothing does. Only what the ticks show, never
// more: the read-receipt setting applies.
const seenUpTo = async (conversation, userId) => {
    const people = await User.find({ _id: { $in: conversation.participants } }).select("readReceipts").lean();
    if (conversation.type === "group") return groupReceiptsFor(conversation, userId, people).readAt;
    if (!shareReadReceipts(people)) return null;
    return conversation.lastReadAt?.get(otherParticipant(conversation, userId)) ?? null;
};

// Everyone who shares a conversation with the user: they are told when the
// user comes online or goes offline.
// Not across a block.
const getContactIds = async (userId) => {
    const [ids, { separated }] = await Promise.all([Conversation.distinct("participants", { participants: userId, ...DIRECT }), blockRelations(userId)]);
    return ids.map(String).filter((id) => id !== String(userId) && !separated.has(id));
};

// The 1:1 conversation between two users, if they have one.
const findConversationBetween = (userId, otherUserId) =>
    Conversation.findOne({ conversationKey: [String(userId), String(otherUserId)].sort().join("_") });

// The other participant of a 1:1 conversation.
const otherParticipant = (conversation, userId) => conversation.participants.map(String).find((id) => id !== String(userId));

const markConversationRead = async (conversationId, userId) => {
    const conversation = await getChatForMember(conversationId, userId);
    const readAt = new Date();
    // $set only this user's entry, so a message being saved at the same moment
    // (which writes lastMessage) is never overwritten. Read implies delivered.
    await Conversation.updateOne(
        { _id: conversation._id },
        { $set: { [`lastReadAt.${userId}`]: readAt }, $max: { [`lastDeliveredAt.${userId}`]: readAt } }
    );
    return { conversation, readAt };
};

// The user's app received the conversation's messages so far.
const markConversationDelivered = async (conversationId, userId) => {
    const conversation = await getChatForMember(conversationId, userId);
    const deliveredAt = new Date();
    // $max: never moves back (e.g. if an older event arrives late).
    await Conversation.updateOne({ _id: conversation._id }, { $max: { [`lastDeliveredAt.${userId}`]: deliveredAt } });
    return { conversation, deliveredAt };
};

// The user opened the app: everything sent to them until now has arrived.
// Returns only the conversations that had undelivered messages, so senders
// are told once, not on every page load.
const markAllDelivered = async (userId) => {
    const deliveredAt = new Date();
    const candidates = await Conversation.find({
        participants: userId,
        lastMessageAt: { $ne: null },
        "lastMessage.sender": { $ne: new mongoose.Types.ObjectId(userId) }
    });
    const pending = candidates.filter((conversation) => {
        const delivered = conversation.lastDeliveredAt?.get(userId.toString());
        return !delivered || delivered < conversation.lastMessageAt;
    });
    if (pending.length > 0) {
        await Conversation.updateMany(
            { _id: { $in: pending.map((conversation) => conversation._id) } },
            { $max: { [`lastDeliveredAt.${userId}`]: deliveredAt } }
        );
    }
    return pending.map((conversation) => ({ conversation, deliveredAt }));
};

export {
    isMuted,
    mutedUntilFor,
    setMute,
    getChatForMember,
    groupReceiptsFor,
    createOrGetConversation,
    getUserConversations,
    getConversationForParticipant,
    countUnread,
    markConversationRead,
    markConversationDelivered,
    markAllDelivered,
    readReceiptsShared,
    seenUpTo,
    getContactIds,
    otherParticipant,
    findConversationBetween
};