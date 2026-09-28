import { Router } from 'express';
import {getCurrentUserController, loginUserController, logoutUserController } from '../controllers/auth.controller.js';
import authMiddleware from '../middleware/auth.middleware.js';
import { callbackController, completeController, pendingController, providersController, startController } from '../controllers/google.controller.js';
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

// Sign in with Google: each start costs a round trip to Google, and the
// sign-up creates an account (like /api/users).
const googleLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, keys: byIp("google"), message: "Too many Google sign-ins" });
const googleSignupLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keys: byIp("register"), message: "Too many new accounts from this network" });

const router = Router();

router.get('/me', authMiddleware, getCurrentUserController);
router.post('/login', loginIpLimit, loginLimit, loginUserController);
router.post('/logout', logoutUserController);
router.get('/providers', providersController);
router.get('/google', googleLimit, startController);
router.get('/google/callback', googleLimit, callbackController);
router.get('/google/pending', pendingController);
router.post('/google/complete', googleSignupLimit, completeController);

export default router;