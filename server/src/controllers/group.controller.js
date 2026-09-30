import { cancelInvite, createGroup, getGroup, getGroupKeys, inviteToGroup, leaveGroup, listMyGroups, listMyInvites, makeAdmin, removeMember, respondToInvite, rotateKey, updateGroup } from "../services/group.service.js";

const createGroupController = async (req, res) => {
    const { groupId, name, userIds, keys } = req.body ?? {};
    const { group } = await createGroup(req.user.userId, { groupId, name, userIds, keys });
    res.status(201).json({ success: true, group: await getGroup(req.user.userId, group._id) });
};

const listGroupsController = async (req, res) => {
    res.status(200).json({ success: true, groups: await listMyGroups(req.user.userId) });
};

const getGroupController = async (req, res) => {
    res.status(200).json({ success: true, group: await getGroup(req.user.userId, req.params.groupId) });
};

const inviteController = async (req, res) => {
    const { userIds, keys, epoch } = req.body ?? {};
    const invites = await inviteToGroup(req.user.userId, req.params.groupId, { userIds, keys, epoch });
    res.status(201).json({ success: true, invited: invites.length });
};

const listInvitesController = async (req, res) => {
    res.status(200).json({ success: true, invites: await listMyInvites(req.user.userId) });
};

const acceptInviteController = async (req, res) => {
    const { group } = await respondToInvite(req.user.userId, req.params.inviteId, true);
    res.status(200).json({ success: true, group: await getGroup(req.user.userId, group._id) });
};

const declineInviteController = async (req, res) => {
    await respondToInvite(req.user.userId, req.params.inviteId, false);
    res.status(200).json({ success: true });
};

const cancelInviteController = async (req, res) => {
    await cancelInvite(req.user.userId, req.params.inviteId);
    res.status(200).json({ success: true });
};

const getKeysController = async (req, res) => {
    res.status(200).json({ success: true, ...(await getGroupKeys(req.user.userId, req.params.groupId)) });
};

const rotateKeyController = async (req, res) => {
    const { epoch, keys } = req.body ?? {};
    res.status(201).json({ success: true, ...(await rotateKey(req.user.userId, req.params.groupId, { epoch, keys })) });
};

const leaveController = async (req, res) => {
    await leaveGroup(req.user.userId, req.params.groupId);
    res.status(200).json({ success: true });
};

const removeMemberController = async (req, res) => {
    await removeMember(req.user.userId, req.params.groupId, req.params.userId);
    res.status(200).json({ success: true });
};

const updateGroupController = async (req, res) => {
    const { name, membersCanInvite } = req.body ?? {};
    await updateGroup(req.user.userId, req.params.groupId, { name, membersCanInvite });
    res.status(200).json({ success: true, group: await getGroup(req.user.userId, req.params.groupId) });
};

const makeAdminController = async (req, res) => {
    await makeAdmin(req.user.userId, req.params.groupId, req.params.userId);
    res.status(200).json({ success: true });
};

export {
    updateGroupController,
    makeAdminController,
    getKeysController,
    rotateKeyController,
    leaveController,
    removeMemberController,
    createGroupController,
    listGroupsController,
    getGroupController,
    inviteController,
    listInvitesController,
    acceptInviteController,
    declineInviteController,
    cancelInviteController,
};
