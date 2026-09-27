import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { blockController, listBlockedController, unblockController } from "../controllers/block.controller.js";
import { createReportController } from "../controllers/report.controller.js";

const router = Router();

// The people I blocked; block / unblock someone (PUT and DELETE are idempotent).
router.get("/blocks", authMiddleware, listBlockedController);
router.put("/blocks/:userId", authMiddleware, blockController);
router.delete("/blocks/:userId", authMiddleware, unblockController);
// Report someone (optionally blocking them too).
router.post("/reports", authMiddleware, createReportController);

export default router;
