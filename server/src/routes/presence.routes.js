import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { statePresenceSnapshot } from "../statePresence.js";

const router = Router();

// How many people are online in each state (counts only; under 5 = null).
router.get("/presence/states", authMiddleware, (req, res) => {
    res.status(200).json({ success: true, ...statePresenceSnapshot() });
});

export default router;
