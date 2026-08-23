import { Router } from 'express';
import  authMiddleware  from '../middleware/auth.middleware.js';
import { createOrGetConversationController, getUserConversationsController } from '../controllers/conversation.controller.js';


const router = Router();

router.post('/conversations', authMiddleware ,createOrGetConversationController);
router.get('/conversations', authMiddleware, getUserConversationsController);

export default router;