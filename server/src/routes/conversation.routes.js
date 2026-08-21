import { Router } from 'express';
import  authMiddleware  from '../middleware/auth.middleware.js';
import { createOrGetConversationController } from '../controllers/conversation.controller.js';


const router = Router();

router.post('/conversations', authMiddleware ,createOrGetConversationController
)

export default router;