import User, { PUBLIC_USER_FIELDS } from "../models/user.model.js"
import bcrypt from "bcrypt";
import AppError from "../utils/AppError.js";
import { INDIAN_STATE_CODES } from "../../../shared/indian-states.js";
import { blockRelations, hasBlocked } from "./block.service.js";

// Text that goes into a regex: escape every special character, otherwise ".*"
// would match everyone and patterns like "(a+)+$" could make the database
// work very hard (ReDoS).
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A name must be text: null or an object would slip past the schema's checks.
const checkName = (name) => {
    if (typeof name !== "string") {
        throw new AppError("Name must be text", 400);
    }
};

const createUser = async (userData) => {

    // Only these fields can be set at registration. Spreading the whole request
    // body would let a client set anything else on the user (mass assignment),
    // e.g. isOnline, createdAt or its own _id.
    // The two key fields are created in the browser (end-to-end encryption).
    const { name, username, email, password, state, publicKey, encryptedPrivateKey } = userData;
    if (name !== undefined) checkName(name);

    const hashedPassword = await bcrypt.hash(password, 10);
    const createdUser = await User.create({
        // The app always sends a name; an older app still open in someone's
        // browser during a deploy doesn't, and then the username stands in.
        name: name === undefined ? username : name,
        username,
        email,
        password: hashedPassword,
        state,
        publicKey,
        encryptedPrivateKey
    });

    // The locked private key is only handed out at login (to its owner).
    const { password: _hashedPassword, encryptedPrivateKey: _lockedKey, ...UserWithoutPassword } = createdUser.toObject();

    return UserWithoutPassword;

}


// The logged-in user's own profile, including their locked private key: after
// a refresh the browser may need it to unlock the key again. Only for the owner.
const getCurrentUser = async (userId) => {
    const user = await User.findById(userId).select("+encryptedPrivateKey");
    if (!user) {
        throw new AppError("User not found", 404);
    }
    return user;
}

const MAX_SEARCH_RESULTS = 20;
const DISCOVER_PAGE_SIZE = 20;

// Discover: people from one state who chose to be listed, in username order,
// optionally narrowed by a username prefix. `after` is the last username of
// the previous page (a cursor). Never says whether anyone is online.
const discoverUsers = async ({ state, q, after }, currentUserId) => {
    if (!INDIAN_STATE_CODES.includes(state)) {
        throw new AppError("Choose a valid state", 400);
    }
    // Never the user, nor anyone a block separates them from.
    const { separated } = await blockRelations(currentUserId);
    const filter = { state, discoverable: { $ne: false }, _id: { $nin: [currentUserId, ...separated] } };
    const prefix = typeof q === "string" ? q.trim().toLowerCase() : "";
    if (prefix.length > 30) {
        throw new AppError("Search query is too long", 400);
    }
    const conditions = [];
    if (prefix) conditions.push({ username: { $regex: `^${escapeRegex(prefix)}` } });
    if (after !== undefined) {
        if (typeof after !== "string" || after.length > 30) {
            throw new AppError("Invalid cursor", 400);
        }
        conditions.push({ username: { $gt: after } });
    }
    if (conditions.length) filter.$and = conditions;

    const page = await User.find(filter)
        .select(PUBLIC_USER_FIELDS)
        .sort({ username: 1 })
        .limit(DISCOVER_PAGE_SIZE + 1)
        .lean();
    return { users: page.slice(0, DISCOVER_PAGE_SIZE), hasMore: page.length > DISCOVER_PAGE_SIZE };
};

// Finds users whose username starts with `query` (case-insensitive).
// Returns only public profile fields — never email or password. Everyone can
// be found by username, also people who aren't listed in Discover.
const searchUsers = async (query, currentUserId) => {
    if (typeof query !== "string" || query.trim() === "") {
        throw new AppError("Search query is required", 400);
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length > 30) {
        throw new AppError("Search query is too long", 400);
    }

    const escapedQuery = escapeRegex(normalizedQuery);
    const { separated } = await blockRelations(currentUserId);

    // Usernames are stored in lowercase, so an anchored "^prefix" regex can use
    // the username index.
    return User.find({
        username: { $regex: `^${escapedQuery}` },
        _id: { $nin: [currentUserId, ...separated] },
    })
        .select(PUBLIC_USER_FIELDS)
        .sort({ username: 1 })
        .limit(MAX_SEARCH_RESULTS)
        .lean();
}

// One person's public profile by username (the /u/:username page): the same
// public fields as search, never email or password. An exact match, not a
// regex: usernames are stored in lowercase. Someone who blocked the viewer
// doesn't exist for them (404, like a wrong name); someone the viewer blocked
// is shown with blockedByMe, so they can be unblocked.
const getPublicProfile = async (username, viewerId) => {
    if (typeof username !== "string" || username.length > 30) {
        throw new AppError("User not found", 404);
    }
    const user = await User.findOne({ username: username.toLowerCase() }).select(PUBLIC_USER_FIELDS).lean();
    if (!user || (String(user._id) !== String(viewerId) && (await hasBlocked(user._id, viewerId)))) {
        throw new AppError("User not found", 404);
    }
    return { ...user, blockedByMe: await hasBlocked(viewerId, user._id) };
};

// The profile fields a user may change (settings page). Not the avatar:
// a free URL would make everyone who sees it load a file from any server
// (leaking their IP address). Photos come with uploads (plan step 36).
const updateUser = async (userId, updateData) => {
    const allowedUpdates = {}
    if (updateData.name !== undefined) {
        checkName(updateData.name);
        allowedUpdates.name = updateData.name;
    }
    if (updateData.username !== undefined) allowedUpdates.username = updateData.username;
    if (updateData.bio !== undefined) allowedUpdates.bio = updateData.bio;
    if (updateData.state !== undefined) allowedUpdates.state = updateData.state;
    // Strict true/false: Mongoose would turn "no" or 0 into false without complaint.
    for (const setting of ["readReceipts", "discoverable"]) {
        if (updateData[setting] === undefined) continue;
        if (typeof updateData[setting] !== "boolean") {
            throw new AppError(`${setting} must be true or false`, 400);
        }
        allowedUpdates[setting] = updateData[setting];
    }
    if(Object.keys(allowedUpdates).length === 0) {
        throw new AppError("No valid fields provided for update", 400);
    }
    const updatedUser = await User.findByIdAndUpdate(userId, allowedUpdates, { returnDocument: "after", runValidators: true });
    if (!updatedUser) {
        throw new AppError("User not found", 404);
    }
    return updatedUser;
}

// The private key is locked with the password, so a new password needs a newly
// locked key (made in the browser with rewrapPrivateKey). Both are saved
// together; otherwise the key would stay locked with the old password and the
// user could never open it again.
const changePassword = async (userId, currentPassword, newPassword, encryptedPrivateKey) => {
    if (typeof currentPassword !== "string" || !currentPassword) {
        throw new AppError("Current password is required", 400);
    }
    if (!encryptedPrivateKey || typeof encryptedPrivateKey !== "object") {
        throw new AppError("encryptedPrivateKey (your key locked with the new password) is required", 400);
    }

    const user = await User.findById(userId).select("+password");
    if (!user) {
        throw new AppError("User not found", 404);
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
        throw new AppError("Current password is incorrect", 401);
    }
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedNewPassword;
    // Only the four known fields; the schema validates their shape on save.
    const { data, iv, salt, iterations } = encryptedPrivateKey;
    user.encryptedPrivateKey = { data, iv, salt, iterations };
    await user.save();
    return user;
}

export {
    createUser,
    getCurrentUser,
    updateUser,
    changePassword,
    searchUsers,
    discoverUsers,
    getPublicProfile
}   