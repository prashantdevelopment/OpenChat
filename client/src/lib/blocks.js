import api from "../api/api.js";

// Blocking and reporting (server: routes/block.routes.js). The server enforces
// a block everywhere; these only ask for it.

export const blockUser = (userId) => api.put(`/blocks/${userId}`);
export const unblockUser = (userId) => api.delete(`/blocks/${userId}`);
export const getBlockedUsers = async () => (await api.get("/blocks")).data.users;

// { value, label } in the order shown; values match the server's list.
export const REPORT_REASONS = [
  { value: "spam", label: "Spam or a scam" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "impersonation", label: "Pretending to be someone else" },
  { value: "inappropriate", label: "Inappropriate photos or messages" },
  { value: "other", label: "Something else" },
];
export const MAX_REPORT_DETAILS = 500;

export const reportUser = async ({ userId, reason, details, conversationId, alsoBlock }) =>
  (await api.post("/reports", { userId, reason, details, conversationId, alsoBlock })).data;
