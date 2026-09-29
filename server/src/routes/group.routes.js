import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import {
    acceptInviteController,
    cancelInviteController,
    createGroupController,
    declineInviteController,
    getGroupController,
    inviteController,
    listGroupsController,
    listInvitesController,
} from "../controllers/group.controller.js";
import { byUser, rateLimit } from "../rateLimit.js";

// Each invite notifies someone: creating groups and inviting are limited per
// user (on top of the daily invite count in group.service.js).
const inviteLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keys: byUser("groupInvite"), message: "Too many invites, try again later" });

const router = Router();

router.get("/groups", authMiddleware, listGroupsController);
router.post("/groups", authMiddleware, inviteLimit, createGroupController);
router.get("/groups/:groupId", authMiddleware, getGroupController);
router.post("/groups/:groupId/invites", authMiddleware, inviteLimit, inviteController);

// Invites sent to me; answer one; the inviter (or an admin) takes one back.
router.get("/group-invites", authMiddleware, listInvitesController);
router.post("/group-invites/:inviteId/accept", authMiddleware, acceptInviteController);
router.post("/group-invites/:inviteId/decline", authMiddleware, declineInviteController);
router.delete("/group-invites/:inviteId", authMiddleware, cancelInviteController);

export default router;
