import User from "../models/user.model.js";
import AppError from "../utils/AppError.js";

// For now OpenChat takes at most MAX_USERS accounts (step 85): the server is
// small, and the first people come from a reel. When it is full, new sign-ups
// (email and Google) are refused with a friendly message; everyone who has an
// account logs in as always. Raise it by setting MAX_USERS on the host.
export const DEFAULT_MAX_USERS = 150;

// Read on every call, so a test (or a restart with a new value) can change it.
export const maxUsers = () => {
    const raw = process.env.MAX_USERS;
    if (raw === undefined || raw === "") return DEFAULT_MAX_USERS;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`MAX_USERS must be a whole number above 0, not "${raw}"`);
    return limit;
};

export const isFull = async () => (await User.countDocuments()) >= maxUsers();

export const fullError = () =>
    new AppError(`OpenChat is full for now: the first ${maxUsers()} people are in. We're making room, please check back soon.`, 503, { reason: "full" });

// Before an account is made (and before an email code is sent for one).
export const assertRoomForNewAccount = async () => {
    if (await isFull()) throw fullError();
};

// After it was made: two sign-ups at the same moment could both have passed
// the check above. Over the limit, the new one is taken back, so there are
// never more than MAX_USERS accounts.
export const keepWithinLimit = async (user) => {
    if ((await User.countDocuments()) > maxUsers()) {
        await User.deleteOne({ _id: user._id });
        throw fullError();
    }
    return user;
};
