import { readAvatar, removeAvatar, setAvatar, setLargeAvatar } from "../services/avatar.service.js";

const setAvatarController = async (req, res) => {
    const avatar = await setAvatar(req.user.userId, req.body);
    res.status(200).json({ success: true, avatar });
};

const setLargeAvatarController = async (req, res) => {
    await setLargeAvatar(req.user.userId, req.params.avatarId, req.body);
    res.status(200).json({ success: true });
};

const removeAvatarController = async (req, res) => {
    await removeAvatar(req.user.userId);
    res.status(200).json({ success: true, avatar: "" });
};

// Public, like a profile photo anywhere; the address is a random id that only
// logged-in users see (in search results and their conversations). The type
// comes from the bytes; nosniff and a locked-down CSP make sure the file is
// only ever shown as an image. A new photo gets a new id, so caching is safe.
const readAvatarController = async (req, res) => {
    const { bytes, type } = await readAvatar(req.params.avatarId, { large: req.path.endsWith("/large") });
    res.set({
        "Content-Type": type,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Cross-Origin-Resource-Policy": "cross-origin",
    });
    res.send(bytes);
};

export { setAvatarController, setLargeAvatarController, removeAvatarController, readAvatarController };
