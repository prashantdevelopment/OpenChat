import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { getMessagesByConversationIdController } from "../controllers/message.controller.js";

const router = Router();

// Messages are sent through Socket.IO ("sendMessage"), not REST,
// so that every new message is also broadcast to the conversation room.
router.get("/conversations/:conversationId/messages", authMiddleware, getMessagesByConversationIdController);

export default router;
