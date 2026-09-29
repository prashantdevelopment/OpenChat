import mongoose from "mongoose";
import Conversation, { MAX_GROUP_MEMBERS } from "../models/conversation.model.js";
import GroupInvite from "../models/groupInvite.model.js";
import User, { PUBLIC_USER_FIELDS } from "../models/user.model.js";
import AppError from "../utils/AppError.js";
import { isBlockedBetween } from "./block.service.js";

// Groups (step 66): a group is a Conversation with type "group". Its members
// are the participants; people join only by accepting an invite.
// Rules for inviting:
// - admins invite (all members, if the group allows it: membersCanInvite);
// - only people the inviter already chats with (a 1:1 chat with a message in
//   it): groups grow through chats, a stranger can't be pulled in;
// - never across a block, either way;
// - at most MAX_GROUP_MEMBERS members, invites still pending included;
// - after a decline, that group can't invite the person again for a week;
// - at most MAX_INVITES_PER_DAY invites sent per person.

const DAY_MS = 24 * 60 * 60 * 1000;
const DECLINE_COOLDOWN_MS = 7 * DAY_MS;
const MAX_INVITES_PER_DAY = 100;

const checkId = (id, what) => {
    if (!mongoose.isValidObjectId(id)) throw new AppError(`Invalid ${what} id`, 400);
    return String(id);
};
const includes = (ids, userId) => ids.some((id) => String(id) === String(userId));

// A group the user is in. Someone else gets "not found", so a group id tells
// an outsider nothing.
const getGroupForMember = async (groupId, userId) => {
    checkId(groupId, "group");
    const group = await Conversation.findOne({ _id: groupId, type: "group", participants: userId });
    if (!group) throw new AppError("Group not found", 404);
    return group;
};

const canInvite = (group, userId) => group.membersCanInvite || includes(group.admins, userId);

// A pending invite past its time: marked expired (so it frees the "one pending
// invite per person" slot).
const expireOldInvites = (filter) =>
    GroupInvite.updateMany({ ...filter, status: "pending", expiresAt: { $lte: new Date() } }, { $set: { status: "expired" } });

// Checks every person first and invites nobody if one of them fails.
const invitePeople = async (group, fromId, userIds) => {
    const now = new Date();
    if (userIds.includes(fromId)) throw new AppError("You can't invite yourself", 400);
    if (userIds.some((id) => includes(group.participants, id))) throw new AppError("Already a member of this group", 400);

    await expireOldInvites({ group: group._id });
    const pendingIds = new Set((await GroupInvite.find({ group: group._id, status: "pending" }).select("to")).map((invite) => String(invite.to)));
    // Invited already: nothing new for them.
    const newIds = userIds.filter((id) => !pendingIds.has(id));
    if (group.participants.length + pendingIds.size + newIds.length > MAX_GROUP_MEMBERS) {
        throw new AppError(`A group can have at most ${MAX_GROUP_MEMBERS} members (invites included)`, 400);
    }
    if (newIds.length === 0) return [];

    const sentToday = await GroupInvite.countDocuments({ from: fromId, createdAt: { $gt: new Date(now - DAY_MS) } });
    if (sentToday + newIds.length > MAX_INVITES_PER_DAY) throw new AppError("You've sent too many invites today", 429);

    if ((await User.countDocuments({ _id: { $in: newIds } })) !== newIds.length) throw new AppError("User not found", 404);
    await Promise.all(newIds.map(async (id) => {
        const chat = await Conversation.exists({ conversationKey: [fromId, id].sort().join("_"), lastMessageAt: { $ne: null } });
        if (!chat) throw new AppError("You can only invite people you already chat with", 403);
        if (await isBlockedBetween(fromId, id)) throw new AppError("You can't invite this person", 403);
        const declined = await GroupInvite.exists({ group: group._id, to: id, status: "declined", respondedAt: { $gt: new Date(now - DECLINE_COOLDOWN_MS) } });
        if (declined) throw new AppError("They declined recently: you can invite them again a week after that", 409);
    }));

    const created = await Promise.all(newIds.map((id) =>
        GroupInvite.create({ group: group._id, from: fromId, to: id }).catch((error) => {
            // Invited by another admin at the same moment: that invite stands.
            if (error.code === 11000) return null;
            throw error;
        })
    ));
    return created.filter(Boolean);
};

const checkUserIds = (userIds) => {
    if (!Array.isArray(userIds) || userIds.length === 0) throw new AppError("Choose who to invite", 400);
    if (userIds.length >= MAX_GROUP_MEMBERS) throw new AppError(`A group can have at most ${MAX_GROUP_MEMBERS} members (invites included)`, 400);
    return [...new Set(userIds.map((id) => checkId(id, "user")))];
};

// A new group: the creator is its first member and admin; everyone chosen
// gets an invite. If an invite can't be sent, the group isn't created.
export const createGroup = async (userId, { name, userIds } = {}) => {
    const ids = checkUserIds(userIds);
    const group = await Conversation.create({
        type: "group",
        name: typeof name === "string" ? name : undefined,
        participants: [userId],
        admins: [userId],
        createdBy: userId,
        joinedAt: { [userId]: new Date() },
    });
    try {
        const invites = await invitePeople(group, String(userId), ids);
        return { group, invites };
    } catch (error) {
        await Conversation.deleteOne({ _id: group._id });
        throw error;
    }
};

export const inviteToGroup = async (userId, groupId, userIds) => {
    const ids = checkUserIds(userIds);
    const group = await getGroupForMember(groupId, userId);
    if (!canInvite(group, userId)) throw new AppError("Only admins can invite people to this group", 403);
    return invitePeople(group, String(userId), ids);
};

// Accept: joins the group (if it still has room). Decline: the inviter sees it.
export const respondToInvite = async (userId, inviteId, accept) => {
    checkId(inviteId, "invite");
    const invite = await GroupInvite.findOne({ _id: inviteId, to: userId });
    if (!invite) throw new AppError("Invite not found", 404);
    if (invite.status === "pending" && invite.expiresAt <= new Date()) {
        await expireOldInvites({ _id: invite._id });
        throw new AppError("This invite has expired", 410);
    }
    if (invite.status !== "pending") throw new AppError(`This invite was already ${invite.status}`, 409);

    const now = new Date();
    // Claimed once: accepting in two tabs at the same time joins once.
    const claimed = await GroupInvite.findOneAndUpdate(
        { _id: invite._id, status: "pending" },
        { $set: { status: accept ? "accepted" : "declined", respondedAt: now } },
        { new: true }
    );
    if (!claimed) throw new AppError("This invite was already answered", 409);
    if (!accept) return { invite: claimed, group: null };

    // Joined only while there is room (checked and added in one step).
    const group = await Conversation.findOneAndUpdate(
        { _id: invite.group, type: "group", participants: { $ne: userId }, [`participants.${MAX_GROUP_MEMBERS - 1}`]: { $exists: false } },
        { $push: { participants: userId }, $set: { [`joinedAt.${userId}`]: now } },
        { new: true }
    );
    if (group) return { invite: claimed, group };

    const current = await Conversation.findOne({ _id: invite.group, type: "group" });
    if (current && includes(current.participants, userId)) return { invite: claimed, group: current };
    // Full (or gone): the invite stays open if there may be room later.
    await GroupInvite.updateOne({ _id: invite._id }, { $set: current ? { status: "pending", respondedAt: null } : { status: "cancelled" } });
    throw current ? new AppError("This group is full", 409) : new AppError("This group no longer exists", 404);
};

// The inviter, or an admin of the group, takes a pending invite back.
export const cancelInvite = async (userId, inviteId) => {
    checkId(inviteId, "invite");
    const invite = await GroupInvite.findById(inviteId);
    const group = invite && (await Conversation.findOne({ _id: invite.group, type: "group", participants: userId }));
    if (!invite || !group || (String(invite.from) !== String(userId) && !includes(group.admins, userId))) {
        throw new AppError("Invite not found", 404);
    }
    const cancelled = await GroupInvite.findOneAndUpdate(
        { _id: invite._id, status: "pending" },
        { $set: { status: "cancelled", respondedAt: new Date() } },
        { new: true }
    );
    if (!cancelled) throw new AppError(`This invite was already ${invite.status}`, 409);
    return cancelled;
};

// My open invites, newest first: the group's name and size, and who invited me.
export const listMyInvites = async (userId) => {
    await expireOldInvites({ to: userId });
    const invites = await GroupInvite.find({ to: userId, status: "pending" })
        .sort({ createdAt: -1 })
        .populate("group", "name participants")
        .populate("from", PUBLIC_USER_FIELDS)
        .lean();
    return invites
        .filter((invite) => invite.group && invite.from)
        .map(({ _id, group, from, createdAt, expiresAt }) => ({
            _id,
            group: { _id: group._id, name: group.name, memberCount: group.participants.length },
            from,
            createdAt,
            expiresAt,
        }));
};

const groupJson = (group) => {
    const { _id, name, participants, admins, createdBy, membersCanInvite, joinedAt, createdAt } = group.toJSON();
    return { _id, type: "group", name, members: participants, admins, createdBy, membersCanInvite, joinedAt, createdAt };
};

// The groups I'm in, with their members.
export const listMyGroups = async (userId) => {
    const groups = await Conversation.find({ type: "group", participants: userId })
        .populate("participants", PUBLIC_USER_FIELDS)
        .sort({ lastMessageAt: -1, createdAt: -1 });
    return groups.map(groupJson);
};

// One group, for its members: the members and the invites still open or
// recently answered. Admins see every invite, others the ones they sent.
export const getGroup = async (userId, groupId) => {
    const group = await getGroupForMember(groupId, userId);
    await group.populate("participants", PUBLIC_USER_FIELDS);
    await expireOldInvites({ group: group._id });
    const isAdmin = includes(group.admins, userId);
    const invites = await GroupInvite.find({
        group: group._id,
        ...(isAdmin ? {} : { from: userId }),
        $or: [{ status: "pending" }, { status: "declined", respondedAt: { $gt: new Date(Date.now() - DECLINE_COOLDOWN_MS) } }],
    })
        .sort({ createdAt: -1 })
        .populate("to", PUBLIC_USER_FIELDS)
        .populate("from", PUBLIC_USER_FIELDS)
        .lean();
    return {
        ...groupJson(group),
        invites: invites.map(({ _id, to, from, status, createdAt, expiresAt, respondedAt }) => ({ _id, to, from, status, createdAt, expiresAt, respondedAt })),
    };
};
