// How a person is named on screen: their name, Instagram-style, with the
// @username as the small line under it. Accounts from before names existed
// have none, so the username stands in.
export const displayName = (user) => user?.name || user?.username || "";

export const handle = (user) => (user?.username ? `@${user.username}` : "");
