import { EventEmitter } from "events";
import mongoose from "mongoose";
import Conversation, { MAX_GROUP_MEMBERS } from "../models/conversation.model.js";
import GroupInvite from "../models/groupInvite.model.js";
import User, { PUBLIC_USER_FIELDS } from "../models/user.model.js";
import AppError from "../utils/AppError.js";
import { isBlockedBetween } from "./block.service.js";
import GroupKeyEpoch from "../models/groupKeyEpoch.model.js";
import { addInviteeKeys, checkLockedKeys, createFirstEpoch, dropKeysOf, getMyKeys, markKeyStale, rotateGroupKey } from "./groupKeys.service.js";

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

// Every invite comes with the group's key locked for the invitee (step 68,
// groupKeys.service.js): in a new group, the first epoch; later, the latest.
//
// "invited" { group, fromId, invites }, "answered" { invite, group, accepted },
// "cancelled" { invite, group }, "left" { group, userId }: socket.js tells the
// people involved (live and by push).
export const groupEvents = new EventEmitter();

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
// keys: their copies of the group key at `epoch`; a new group's are in its
// first epoch already (firstEpoch).
const invitePeople = async (group, fromId, userIds, { keys, epoch, firstEpoch = false } = {}) => {
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

    if (!firstEpoch) await addInviteeKeys(group, fromId, epoch, checkLockedKeys(keys, newIds, { exact: false }), newIds);

    const created = await Promise.all(newIds.map((id) =>
        GroupInvite.create({ group: group._id, from: fromId, to: id }).catch((error) => {
            // Invited by another admin at the same moment: that invite stands.
            if (error.code === 11000) return null;
            throw error;
        })
    ));
    const invites = created.filter(Boolean);
    if (invites.length) groupEvents.emit("invited", { group, fromId, invites });
    return invites;
};

const checkUserIds = (userIds) => {
    if (!Array.isArray(userIds) || userIds.length === 0) throw new AppError("Choose who to invite", 400);
    if (userIds.length >= MAX_GROUP_MEMBERS) throw new AppError(`A group can have at most ${MAX_GROUP_MEMBERS} members (invites included)`, 400);
    return [...new Set(userIds.map((id) => checkId(id, "user")))];
};

// A new group: the creator is its first member and admin; everyone chosen
// gets an invite. If an invite can't be sent, the group isn't created.
// keys: the first epoch of the group key, locked for the creator and each of them.
// groupId: chosen by the creator's browser (a new random id), because the
// locked copies are bound to the group before the server has seen it.
export const createGroup = async (userId, { groupId, name, userIds, keys } = {}) => {
    checkId(groupId, "group");
    const ids = checkUserIds(userIds);
    const byUser = checkLockedKeys(keys, [String(userId), ...ids.filter((id) => id !== String(userId))]);
    if (await Conversation.exists({ _id: groupId })) throw new AppError("Group id already used", 409);
    const group = await Conversation.create({
        _id: groupId,
        type: "group",
        name: typeof name === "string" ? name : undefined,
        participants: [userId],
        admins: [userId],
        createdBy: userId,
        joinedAt: { [userId]: new Date() },
    });
    try {
        await createFirstEpoch(group._id, userId, byUser);
        const invites = await invitePeople(group, String(userId), ids, { firstEpoch: true });
        return { group, invites };
    } catch (error) {
        await Promise.all([Conversation.deleteOne({ _id: group._id }), GroupKeyEpoch.deleteMany({ group: group._id })]);
        throw error;
    }
};

export const inviteToGroup = async (userId, groupId, { userIds, keys, epoch } = {}) => {
    const ids = checkUserIds(userIds);
    const group = await getGroupForMember(groupId, userId);
    if (!canInvite(group, userId)) throw new AppError("Only admins can invite people to this group", 403);
    return invitePeople(group, String(userId), ids, { keys, epoch });
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
    if (!accept) {
        await dropKeysOf(invite.group, userId);
        const group = await Conversation.findOne({ _id: invite.group, type: "group" });
        if (group) groupEvents.emit("answered", { invite: claimed, group, accepted: false });
        return { invite: claimed, group: null };
    }

    // Joined only while there is room (checked and added in one step).
    const group = await Conversation.findOneAndUpdate(
        { _id: invite.group, type: "group", participants: { $ne: userId }, [`participants.${MAX_GROUP_MEMBERS - 1}`]: { $exists: false } },
        { $push: { participants: userId }, $set: { [`joinedAt.${userId}`]: now } },
        { new: true }
    );
    if (group) {
        groupEvents.emit("answered", { invite: claimed, group, accepted: true });
        return { invite: claimed, group };
    }

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
    // They hold the key: it goes, and the group gets a new one.
    await Promise.all([dropKeysOf(group._id, invite.to), markKeyStale(group._id)]);
    groupEvents.emit("cancelled", { invite: cancelled, group });
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

// Leaving, or an admin removing someone: out of the group, and the group
// needs a new key before the next message (they held this one). The last
// admin leaving hands it to the member who has been there longest; the last
// member leaving ends the group.
const takeOut = async (group, userId) => {
    const others = group.participants.filter((id) => String(id) !== String(userId));
    if (others.length === 0) {
        await Promise.all([
            Conversation.deleteOne({ _id: group._id }),
            GroupKeyEpoch.deleteMany({ group: group._id }),
            GroupInvite.updateMany({ group: group._id, status: "pending" }, { $set: { status: "cancelled", respondedAt: new Date() } }),
        ]);
        return;
    }
    let admins = group.admins.filter((id) => String(id) !== String(userId));
    if (admins.length === 0) {
        const joined = (id) => group.joinedAt?.get(String(id))?.getTime() ?? 0;
        admins = [[...others].sort((a, b) => joined(a) - joined(b))[0]];
    }
    await Conversation.updateOne(
        { _id: group._id },
        { $pull: { participants: userId }, $set: { admins }, $unset: { [`joinedAt.${userId}`]: "" } }
    );
    await markKeyStale(group._id);
    groupEvents.emit("left", { group, userId: String(userId) });
};

export const leaveGroup = async (userId, groupId) => takeOut(await getGroupForMember(groupId, userId), userId);

export const removeMember = async (adminId, groupId, userId) => {
    const group = await getGroupForMember(groupId, adminId);
    if (!includes(group.admins, adminId)) throw new AppError("Only admins can remove people", 403);
    checkId(userId, "user");
    if (String(userId) === String(adminId)) throw new AppError("To leave, use Leave group", 400);
    if (!includes(group.participants, userId)) throw new AppError("Not a member of this group", 404);
    await takeOut(group, userId);
};

// My copies of the group key, and what the next epoch needs (members only).
export const getGroupKeys = async (userId, groupId) => getMyKeys(await getGroupForMember(groupId, userId), userId);

export const rotateKey = async (userId, groupId, body) => rotateGroupKey(await getGroupForMember(groupId, userId), userId, body);
