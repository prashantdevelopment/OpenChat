import express, { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { createUploadController, readUploadController } from "../controllers/upload.controller.js";
import { MAX_UPLOAD_BYTES } from "../services/upload.service.js";

const router = Router();

// The body is the raw encrypted file (not JSON, not a form), read only here.
router.post(
    "/conversations/:conversationId/uploads",
    authMiddleware,
    express.raw({ type: "application/octet-stream", limit: MAX_UPLOAD_BYTES }),
    createUploadController
);
router.get("/uploads/:fileId", authMiddleware, readUploadController);

export default router;
