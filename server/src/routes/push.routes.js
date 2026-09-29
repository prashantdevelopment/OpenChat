import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { configController, subscribeController, testController, unsubscribeController } from "../controllers/push.controller.js";
import { byUser, rateLimit } from "../rateLimit.js";

const subscribeLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, keys: byUser("push-subscribe"), message: "Too many changes to notifications" });
const testLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 5, keys: byUser("push-test"), message: "Too many test notifications" });

const router = Router();

router.get("/push/config", authMiddleware, configController);
router.post("/push/subscriptions", authMiddleware, subscribeLimit, subscribeController);
router.delete("/push/subscriptions", authMiddleware, subscribeLimit, unsubscribeController);
router.post("/push/test", authMiddleware, testLimit, testController);

export default router;
