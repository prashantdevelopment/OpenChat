import { cancelInvite, createGroup, getGroup, inviteToGroup, listMyGroups, listMyInvites, respondToInvite } from "../services/group.service.js";

const createGroupController = async (req, res) => {
    const { name, userIds } = req.body ?? {};
    const { group } = await createGroup(req.user.userId, { name, userIds });
    res.status(201).json({ success: true, group: await getGroup(req.user.userId, group._id) });
};

const listGroupsController = async (req, res) => {
    res.status(200).json({ success: true, groups: await listMyGroups(req.user.userId) });
};

const getGroupController = async (req, res) => {
    res.status(200).json({ success: true, group: await getGroup(req.user.userId, req.params.groupId) });
};

const inviteController = async (req, res) => {
    const invites = await inviteToGroup(req.user.userId, req.params.groupId, req.body?.userIds);
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

export {
    createGroupController,
    listGroupsController,
    getGroupController,
    inviteController,
    listInvitesController,
    acceptInviteController,
    declineInviteController,
    cancelInviteController,
};
