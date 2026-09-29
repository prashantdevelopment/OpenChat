import api from "../api/api.js";

// Groups and group invites (server: group.service.js).
export const fetchGroups = async () => (await api.get("/groups")).data.groups;
export const fetchGroup = async (groupId) => (await api.get(`/groups/${groupId}`)).data.group;
export const fetchInvites = async () => (await api.get("/group-invites")).data.invites;
// Creating a group and inviting: lib/groupKeys.js (they carry the group key).
export const answerInvite = async (inviteId, accept) => (await api.post(`/group-invites/${inviteId}/${accept ? "accept" : "decline"}`)).data;
export const cancelInvite = (inviteId) => api.delete(`/group-invites/${inviteId}`);

export const memberCount = (count) => `${count} ${count === 1 ? "member" : "members"}`;
