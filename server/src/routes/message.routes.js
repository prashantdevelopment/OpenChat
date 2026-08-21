import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { createMessageController , getMessagesByConversationIdController } from "../controllers/message.controller.js";

const router = Router();


router.post("/messages", authMiddleware, createMessageController);
router.get("/conversations/:conversationId/messages", authMiddleware, getMessagesByConversationIdController);

export default router;