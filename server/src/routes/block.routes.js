import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { blockController, listBlockedController, unblockController } from "../controllers/block.controller.js";
import { createReportController } from "../controllers/report.controller.js";
import { byUser, rateLimit } from "../rateLimit.js";

// Blocking and unblocking over and over would flood the other side's events.
const blockLimit = rateLimit({ windowMs: 60 * 1000, max: 20, keys: byUser("block"), message: "Too many changes" });

const router = Router();

// The people I blocked; block / unblock someone (PUT and DELETE are idempotent).
router.get("/blocks", authMiddleware, listBlockedController);
router.put("/blocks/:userId", authMiddleware, blockLimit, blockController);
router.delete("/blocks/:userId", authMiddleware, blockLimit, unblockController);
// Report someone (optionally blocking them too).
router.post("/reports", authMiddleware, createReportController);

export default router;
