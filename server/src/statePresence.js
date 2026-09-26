import { INDIAN_STATE_CODES } from "../../shared/indian-states.js";

// How many people are online in each state or union territory: counts only,
// never who. Kept in memory next to presence.js (online users only).
//
// k-anonymity: a count under MIN_VISIBLE is not shown ("fewer than 5").
// Presence is only shared with contacts, but everyone's state is public: "Goa:
// 1 online" would tell a stranger that the one person they know from Goa is
// online. In a crowd of 5 or more, nobody can be picked out.
export const MIN_VISIBLE = 5;

const stateOf = new Map(); // userId -> state code (while online)
const counts = new Map(); // state code -> online users

export const markOnline = (userId, state) => {
    if (stateOf.has(userId) || !INDIAN_STATE_CODES.includes(state)) return;
    stateOf.set(userId, state);
    counts.set(state, (counts.get(state) ?? 0) + 1);
};

export const markOffline = (userId) => {
    const state = stateOf.get(userId);
    if (!state) return;
    stateOf.delete(userId);
    counts.set(state, counts.get(state) - 1);
};

const visible = (count) => (count >= MIN_VISIBLE ? count : null);

// { states: [{ code, online }], total }: online is a number, or null for
// "fewer than 5" (0 included, so 0 and 1 look the same).
export const statePresenceSnapshot = () => {
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    return {
        states: INDIAN_STATE_CODES.map((code) => ({ code, online: visible(counts.get(code) ?? 0) })),
        total: visible(total),
    };
};
