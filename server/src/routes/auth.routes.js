import { Router } from 'express';
import {getCurrentUserController, loginUserController, logoutUserController } from '../controllers/auth.controller.js';
import authMiddleware from '../middleware/auth.middleware.js';

const router = Router();

router.get('/me', authMiddleware, getCurrentUserController);
router.post('/login', loginUserController);
router.post('/logout', logoutUserController);

export default router;