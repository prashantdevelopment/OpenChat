import { Router } from "express";
import { changePasswordController, createUserController ,updateUserController } from "../controllers/user.controller.js";
import { validateNewPassword, validatePassword } from "../middleware/validation.middleware.js";
import authMiddleware from "../middleware/auth.middleware.js";
const router = Router();

router.post("/users", validatePassword, createUserController);
router.patch('/users/me', authMiddleware, updateUserController);
router.patch('/users/me/password', authMiddleware, validateNewPassword, changePasswordController);

export default router;