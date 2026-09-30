import api from "../api/api.js";

// Groups and group invites (server: group.service.js).
export const fetchGroups = async () => (await api.get("/groups")).data.groups;
export const fetchGroup = async (groupId) => (await api.get(`/groups/${groupId}`)).data.group;
export const fetchInvites = async () => (await api.get("/group-invites")).data.invites;
// Creating a group and inviting: lib/groupKeys.js (they carry the group key).
export const answerInvite = async (inviteId, accept) => (await api.post(`/group-invites/${inviteId}/${accept ? "accept" : "decline"}`)).data;
export const cancelInvite = (inviteId) => api.delete(`/group-invites/${inviteId}`);
// Admins: rename / the invite switch, make an admin, remove someone. Anyone: leave.
export const updateGroup = async (groupId, changes) => (await api.patch(`/groups/${groupId}`, changes)).data.group;
export const makeAdmin = (groupId, userId) => api.post(`/groups/${groupId}/admins/${userId}`);
export const removeMember = (groupId, userId) => api.delete(`/groups/${groupId}/members/${userId}`);
export const leaveGroup = (groupId) => api.post(`/groups/${groupId}/leave`);

export const memberCount = (count) => `${count} ${count === 1 ? "member" : "members"}`;
