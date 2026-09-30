import { Router } from 'express';
import  authMiddleware  from '../middleware/auth.middleware.js';
import { createOrGetConversationController, getUserConversationsController, muteController } from '../controllers/conversation.controller.js';
import { byUser, rateLimit } from '../rateLimit.js';

const newChatLimit = rateLimit({ windowMs: 60 * 1000, max: 30, keys: byUser('new-chat'), message: 'Too many new chats' });
const muteLimit = rateLimit({ windowMs: 60 * 1000, max: 60, keys: byUser('mute'), message: 'Too many changes' });


const router = Router();

router.post('/conversations', authMiddleware, newChatLimit, createOrGetConversationController);
router.get('/conversations', authMiddleware, getUserConversationsController);
// Mute a chat or group (only for me).
router.put('/conversations/:conversationId/mute', authMiddleware, muteLimit, muteController);

export default router;