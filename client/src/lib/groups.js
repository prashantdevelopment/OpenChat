import api from "../api/api.js";

// Groups and group invites (server: group.service.js).
export const fetchGroups = async () => (await api.get("/groups")).data.groups;
export const fetchGroup = async (groupId) => (await api.get(`/groups/${groupId}`)).data.group;
export const fetchInvites = async () => (await api.get("/group-invites")).data.invites;
export const createGroup = async (name, userIds) => (await api.post("/groups", { name, userIds })).data.group;
export const answerInvite = async (inviteId, accept) => (await api.post(`/group-invites/${inviteId}/${accept ? "accept" : "decline"}`)).data;
export const cancelInvite = (inviteId) => api.delete(`/group-invites/${inviteId}`);

export const memberCount = (count) => `${count} ${count === 1 ? "member" : "members"}`;
