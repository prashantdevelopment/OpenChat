import mongoose from "mongoose";
import GroupKeyEpoch from "../models/groupKeyEpoch.model.js";
import Conversation from "../models/conversation.model.js";
import GroupInvite from "../models/groupInvite.model.js";
import { PUBLIC_USER_FIELDS } from "../models/user.model.js";
import AppError from "../utils/AppError.js";
import { base64Length, isBase64 } from "../utils/base64.js";

// The server's side of group encryption (step 68). Browsers make the keys and
// lock a copy for each person (client/src/crypto/groupKeys.js); here the
// server checks the shape of what it stores and who gets which copy:
// - everyone in the group, and everyone invited to it, has a copy of the
//   latest epoch (the invitee's is made when they are invited);
// - only members get their copies back;
// - someone who leaves or is removed, or whose invite is taken back, never
//   gets another one, and the group must move to a new epoch before anyone
//   writes again.

// A locked 256-bit key: 32 bytes + the 16-byte AES-GCM tag, with a 12-byte IV.
const LOCKED_KEY_BYTES = 48;

// [{ userId, ciphertext, iv }] -> Map(userId -> { ciphertext, iv }), exactly
// for the people in `userIds`.
export const checkLockedKeys = (keys, userIds, { exact = true } = {}) => {
    if (!Array.isArray(keys) || keys.length > 100) throw new AppError("Keys are missing", 400);
    const byUser = new Map();
    for (const key of keys) {
        const { userId, ciphertext, iv } = key ?? {};
        if (!mongoose.isValidObjectId(userId) || !isBase64(ciphertext) || !isBase64(iv) || base64Length(iv) !== 12 || base64Length(ciphertext) !== LOCKED_KEY_BYTES) {
            throw new AppError("Invalid key", 400);
        }
        byUser.set(String(userId), { ciphertext, iv });
    }
    const missing = userIds.filter((id) => !byUser.has(String(id)));
    if (missing.length) throw new AppError("A key is needed for every person", 400);
    if (exact && byUser.size !== userIds.length) throw new AppError("Keys only for the people in the group", 400);
    return byUser;
};

const lockedFor = (byUser, userIds, wrappedBy) =>
    userIds.map((id) => ({ user: id, wrappedBy, ...byUser.get(String(id)) }));

// The newest epoch of a group (0 before its first key).
export const latestEpoch = async (groupId) => (await GroupKeyEpoch.findOne({ group: groupId }).sort({ epoch: -1 }).select("epoch").lean())?.epoch ?? 0;

export const needsNewKey = (group, epoch) => group.staleKeyEpoch !== undefined && group.staleKeyEpoch !== null && epoch <= group.staleKeyEpoch;

// The first epoch, made by the creator for themselves and everyone invited.
export const createFirstEpoch = (groupId, creatorId, byUser) =>
    GroupKeyEpoch.create({ group: groupId, epoch: 1, keys: lockedFor(byUser, [...byUser.keys()], creatorId) });

// Copies of the latest epoch for new invitees, locked by the inviter at the
// epoch they saw: if the key changed meanwhile, they must lock the new one.
export const addInviteeKeys = async (group, inviterId, epoch, byUser, userIds) => {
    const current = await latestEpoch(group._id);
    if (epoch !== current) throw new AppError("The group's key has just changed: try again", 409, { reason: "epoch" });
    if (needsNewKey(group, current)) throw new AppError("The group needs a new key first", 409, { reason: "rotate" });
    await GroupKeyEpoch.updateOne({ group: group._id, epoch }, { $pull: { keys: { user: { $in: userIds } } } });
    await GroupKeyEpoch.updateOne({ group: group._id, epoch }, { $push: { keys: { $each: lockedFor(byUser, userIds, inviterId) } } });
};

// Someone declined, or their invite was taken back: their copies go.
export const dropKeysOf = (groupId, userId) => GroupKeyEpoch.updateMany({ group: groupId }, { $pull: { keys: { user: userId } } });

// They held the key: the next message needs a new epoch.
export const markKeyStale = async (groupId) =>
    Conversation.updateOne({ _id: groupId }, { $set: { staleKeyEpoch: await latestEpoch(groupId) } });

// Who the next epoch must be locked for: members and people with an open invite.
const keyHolders = async (group) => {
    const pending = await GroupInvite.find({ group: group._id, status: "pending", expiresAt: { $gt: new Date() } }).populate("to", PUBLIC_USER_FIELDS).lean();
    await group.populate("participants", PUBLIC_USER_FIELDS);
    return [...group.participants.map((member) => member.toJSON()), ...pending.map((invite) => invite.to).filter(Boolean)];
};

// A member's copies of the group key (every epoch they have one of), who
// locked each (with their public key, to unlock it), and what a new epoch
// needs: the latest number, whether it is due, and who to lock it for.
export const getMyKeys = async (group, userId) => {
    const epochs = await GroupKeyEpoch.find({ group: group._id, "keys.user": userId })
        .sort({ epoch: 1 })
        .select({ epoch: 1, keys: { $elemMatch: { user: userId } } })
        .populate("keys.wrappedBy", "publicKey")
        .lean();
    const current = await latestEpoch(group._id);
    const recipients = await keyHolders(group);
    return {
        currentEpoch: current,
        needsNewKey: needsNewKey(group, current),
        keys: epochs.map(({ epoch, keys: [key] }) => ({
            epoch,
            wrappedBy: { _id: key.wrappedBy?._id, publicKey: key.wrappedBy?.publicKey },
            ciphertext: key.ciphertext,
            iv: key.iv,
        })),
        recipients: recipients.map(({ _id, name, username, publicKey }) => ({ _id, name, username, publicKey })),
    };
};

// A member moves the group to the next epoch: a copy for every member and
// invitee, nobody else. Two at once: one wins, the other gets 409 and uses it.
export const rotateGroupKey = async (group, userId, { epoch, keys } = {}) => {
    const current = await latestEpoch(group._id);
    if (epoch !== current + 1) throw new AppError("The group's key has just changed: try again", 409, { reason: "epoch" });
    const holders = await keyHolders(group);
    const byUser = checkLockedKeys(keys, holders.map((holder) => String(holder._id)));
    try {
        await GroupKeyEpoch.create({ group: group._id, epoch, keys: lockedFor(byUser, [...byUser.keys()], userId) });
    } catch (error) {
        if (error.code === 11000) throw new AppError("The group's key has just changed: try again", 409, { reason: "epoch" });
        throw error;
    }
    return { epoch };
};
