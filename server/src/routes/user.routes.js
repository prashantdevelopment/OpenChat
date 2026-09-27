import { Router } from "express";
import { changePasswordController, createUserController, discoverUsersController, getProfileController, searchUsersController, updateUserController } from "../controllers/user.controller.js";
import { validateNewPassword, validatePassword } from "../middleware/validation.middleware.js";
import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { readAvatarController, removeAvatarController, setAvatarController } from "../controllers/avatar.controller.js";
import { MAX_AVATAR_BYTES } from "../services/avatar.service.js";
const router = Router();

router.post("/users", validatePassword, createUserController);
router.get("/users/search", authMiddleware, searchUsersController);
router.get("/users/discover", authMiddleware, discoverUsersController);
// After /users/search and /users/discover, so those words aren't read as usernames.
router.get("/users/:username", authMiddleware, getProfileController);
router.patch('/users/me', authMiddleware, updateUserController);
router.patch('/users/me/password', authMiddleware, validateNewPassword, changePasswordController);
// Profile photo: the body is the image itself (a small JPEG made in the browser).
router.put(
    "/users/me/avatar",
    authMiddleware,
    express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: MAX_AVATAR_BYTES }),
    setAvatarController
);
router.delete("/users/me/avatar", authMiddleware, removeAvatarController);
router.get("/avatars/:avatarId", readAvatarController);

export default router;