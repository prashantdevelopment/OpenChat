import { Router } from 'express';
import {getCurrentUserController, loginUserController, logoutUserController } from '../controllers/auth.controller.js';
import authMiddleware from '../middleware/auth.middleware.js';
import { byIp, rateLimit } from '../rateLimit.js';

// Password guessing: per address and account (so strangers can't lock
// someone out), and per address overall (one address trying many accounts).
const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keys: (req) => `login:${req.ip}:${String(req.body.identifier ?? "").trim().toLowerCase().slice(0, 100)}`,
    message: "Too many login attempts",
});
const loginIpLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, keys: byIp("login-ip"), message: "Too many login attempts" });

const router = Router();

router.get('/me', authMiddleware, getCurrentUserController);
router.post('/login', loginIpLimit, loginLimit, loginUserController);
router.post('/logout', logoutUserController);

export default router;