import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { getIceServersController } from "../controllers/iceServers.controller.js";
import { byUser, rateLimit } from "../rateLimit.js";

const router = Router();

// One request per call (plus retries): each hands out relay credentials.
const iceLimit = rateLimit({ windowMs: 60 * 1000, max: 20, keys: byUser("ice"), message: "Too many calls" });

// For logged-in users only: TURN relays cost money and must not be free for anyone.
router.get("/calls/ice-servers", authMiddleware, iceLimit, getIceServersController);

export default router;
