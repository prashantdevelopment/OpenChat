import { Router } from "express";
import { changePasswordController, createUserController, discoverUsersController, getProfileController, searchUsersController, updateUserController } from "../controllers/user.controller.js";
import { validateNewPassword, validatePassword } from "../middleware/validation.middleware.js";
import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { readAvatarController, removeAvatarController, setAvatarController } from "../controllers/avatar.controller.js";
import { MAX_AVATAR_BYTES } from "../services/avatar.service.js";
import { byIp, byUser, rateLimit } from "../rateLimit.js";

const registerLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keys: byIp("register"), message: "Too many new accounts from this network" });
// Changing the password checks the current one: no guessing it with a stolen session.
const passwordLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keys: byUser("password"), message: "Too many password changes" });
const searchLimit = rateLimit({ windowMs: 60 * 1000, max: 60, keys: byUser("search"), message: "Too many searches" });
const avatarLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, keys: byUser("avatar"), message: "Too many photo changes" });
const router = Router();

router.post("/users", registerLimit, validatePassword, createUserController);
router.get("/users/search", authMiddleware, searchLimit, searchUsersController);
router.get("/users/discover", authMiddleware, searchLimit, discoverUsersController);
// After /users/search and /users/discover, so those words aren't read as usernames.
router.get("/users/:username", authMiddleware, getProfileController);
router.patch('/users/me', authMiddleware, updateUserController);
router.patch('/users/me/password', authMiddleware, passwordLimit, validateNewPassword, changePasswordController);
// Profile photo: the body is the image itself (a small JPEG made in the browser).
router.put(
    "/users/me/avatar",
    authMiddleware,
    avatarLimit,
    express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: MAX_AVATAR_BYTES }),
    setAvatarController
);
router.delete("/users/me/avatar", authMiddleware, removeAvatarController);
router.get("/avatars/:avatarId", readAvatarController);

export default router;