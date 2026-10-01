import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import {
    acceptInviteController,
    cancelInviteController,
    createGroupController,
    declineInviteController,
    deleteGroupController,
    getGroupController,
    getKeysController,
    makeAdminController,
    updateGroupController,
    leaveController,
    removeMemberController,
    rotateKeyController,
    inviteController,
    listGroupsController,
    listInvitesController,
} from "../controllers/group.controller.js";
import { byUser, rateLimit } from "../rateLimit.js";

// Each invite notifies someone: creating groups and inviting are limited per
// user (on top of the daily invite count in group.service.js).
const inviteLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keys: byUser("groupInvite"), message: "Too many invites, try again later" });

// A new key epoch rewrites a copy for every member: not in a loop.
const keyLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keys: byUser("groupKey"), message: "Too many key changes, try again later" });
const leaveLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, keys: byUser("groupRemove"), message: "Too many changes, try again later" });

const router = Router();

router.get("/groups", authMiddleware, listGroupsController);
router.post("/groups", authMiddleware, inviteLimit, createGroupController);
router.get("/groups/:groupId", authMiddleware, getGroupController);
// Admins: rename, the "all members can invite" switch, make someone admin.
router.patch("/groups/:groupId", authMiddleware, leaveLimit, updateGroupController);
// Admins: delete the group for everyone (with all its messages and files).
router.delete("/groups/:groupId", authMiddleware, leaveLimit, deleteGroupController);
router.post("/groups/:groupId/admins/:userId", authMiddleware, leaveLimit, makeAdminController);
router.post("/groups/:groupId/invites", authMiddleware, inviteLimit, inviteController);
// The group key (step 68): my locked copies; a new epoch (after someone left).
router.get("/groups/:groupId/keys", authMiddleware, getKeysController);
router.post("/groups/:groupId/keys", authMiddleware, keyLimit, rotateKeyController);
router.post("/groups/:groupId/leave", authMiddleware, leaveController);
router.delete("/groups/:groupId/members/:userId", authMiddleware, leaveLimit, removeMemberController);

// Invites sent to me; answer one; the inviter (or an admin) takes one back.
router.get("/group-invites", authMiddleware, listInvitesController);
router.post("/group-invites/:inviteId/accept", authMiddleware, acceptInviteController);
router.post("/group-invites/:inviteId/decline", authMiddleware, declineInviteController);
router.delete("/group-invites/:inviteId", authMiddleware, cancelInviteController);

export default router;
