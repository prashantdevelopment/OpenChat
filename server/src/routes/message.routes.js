import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { createMessageController } from "../controllers/message.controller.js";

const router = Router();

router.post("/messages", authMiddleware, createMessageController);

export default router;