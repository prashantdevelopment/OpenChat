import { Router } from "express";
import { statePresenceSnapshot } from "../statePresence.js";

const router = Router();

// How many people are online in each state (counts only; under 5 = null).
// Public: the landing page shows it to visitors. It says nothing a free
// account couldn't see, and counts under 5 are hidden for everyone.
router.get("/presence/states", (req, res) => {
    res.status(200).json({ success: true, ...statePresenceSnapshot() });
});

export default router;
