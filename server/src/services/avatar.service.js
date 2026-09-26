import { randomBytes } from "crypto";
import User from "../models/user.model.js";
import storage from "../storage/index.js";
import AppError from "../utils/AppError.js";

// Profile photos are public (not encrypted). The browser crops them to a small
// square JPEG first, so 512 KB is plenty.
const MAX_AVATAR_BYTES = 512 * 1024;
const AVATAR_ID_PATTERN = /^[a-f0-9]{32}$/;

// The image type, from the file's first bytes ("magic number"), never from
// what the client says. Only these three: no SVG (it can contain scripts),
// no HTML or anything else pretending to be an image.
const imageTypeOf = (bytes) => {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
    return null;
};

// Replaces the user's photo. Returns the new avatar id (a new random id each
// time, so the old address can be cached forever and the new one is fresh).
const setAvatar = async (userId, bytes) => {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        throw new AppError("Send the photo as the request body (image/jpeg, image/png or image/webp)", 400);
    }
    if (!imageTypeOf(bytes)) {
        throw new AppError("The photo must be a JPEG, PNG or WebP image", 400);
    }
    const avatarId = randomBytes(16).toString("hex");
    await storage.save(avatarId, bytes);
    // Only this field (returns the user as it was, to delete the old photo).
    const before = await User.findByIdAndUpdate(userId, { avatar: avatarId }, { runValidators: true }).catch(async (err) => {
        await storage.remove(avatarId);
        throw err;
    });
    if (!before) {
        await storage.remove(avatarId);
        throw new AppError("User not found", 404);
    }
    if (AVATAR_ID_PATTERN.test(before.avatar)) await storage.remove(before.avatar);
    return avatarId;
};

const removeAvatar = async (userId) => {
    const before = await User.findByIdAndUpdate(userId, { avatar: "" });
    if (!before) {
        throw new AppError("User not found", 404);
    }
    if (AVATAR_ID_PATTERN.test(before.avatar)) await storage.remove(before.avatar);
};

// The photo's bytes and type, if this id is someone's current photo.
const readAvatar = async (avatarId) => {
    if (typeof avatarId !== "string" || !AVATAR_ID_PATTERN.test(avatarId) || !(await User.exists({ avatar: avatarId }))) {
        throw new AppError("Photo not found", 404);
    }
    // Missing from storage (e.g. deleted by hand): same as no photo.
    const bytes = await storage.read(avatarId).catch(() => {
        throw new AppError("Photo not found", 404);
    });
    return { bytes, type: imageTypeOf(bytes) ?? "application/octet-stream" };
};

export { MAX_AVATAR_BYTES, setAvatar, removeAvatar, readAvatar };
