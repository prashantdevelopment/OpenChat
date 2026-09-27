import express, { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { createUploadController, readUploadController } from "../controllers/upload.controller.js";
import { MAX_UPLOAD_BYTES } from "../services/upload.service.js";
import { byUser, rateLimit } from "../rateLimit.js";

// Checked before the (up to 10 MB) body is read.
const uploadLimit = rateLimit({ windowMs: 60 * 1000, max: 30, keys: byUser("upload"), message: "Too many files" });

const router = Router();

// The body is the raw encrypted file (not JSON, not a form), read only here.
router.post(
    "/conversations/:conversationId/uploads",
    authMiddleware,
    uploadLimit,
    express.raw({ type: "application/octet-stream", limit: MAX_UPLOAD_BYTES }),
    createUploadController
);
router.get("/uploads/:fileId", authMiddleware, readUploadController);

export default router;
