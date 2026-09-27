import { Router } from 'express';
import  authMiddleware  from '../middleware/auth.middleware.js';
import { createOrGetConversationController, getUserConversationsController } from '../controllers/conversation.controller.js';
import { byUser, rateLimit } from '../rateLimit.js';

const newChatLimit = rateLimit({ windowMs: 60 * 1000, max: 30, keys: byUser('new-chat'), message: 'Too many new chats' });


const router = Router();

router.post('/conversations', authMiddleware, newChatLimit, createOrGetConversationController);
router.get('/conversations', authMiddleware, getUserConversationsController);

export default router;