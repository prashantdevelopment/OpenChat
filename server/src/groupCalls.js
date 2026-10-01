import AppError from "./utils/AppError.js";
import Conversation from "./models/conversation.model.js";
import User, { PUBLIC_USER_FIELDS } from "./models/user.model.js";
import { checkCallId, checkSignal } from "./calls.js";
import { sendPush } from "./services/push.service.js";
import { isMuted } from "./services/conversation.service.js";

// Group calls (step 71): a "mesh", where every two people in the call connect
// directly (WebRTC; through TURN when needed). The media never passes the
// server, and the signals between two people are encrypted with their own
// key (like a 1:1 call), so the server only relays them. What it keeps, in
// memory, is who is in each group's call: only members can start or join it,
// at most MAX_IN_CALL people, and a signal goes only between two people in
// the same call. Someone who leaves the group (or whose app disconnects)
// leaves its call.

export const MAX_IN_CALL = 6;
const MEDIA = ["audio", "video"];
const SIGNAL_KINDS = ["offer", "answer", "candidate"];

// A group call starting: an urgent push to members who aren't looking at
// OpenChat and haven't muted the group (useless once the ringing is over).
const RING_SECONDS = 30;
const pushCallStart = async ({ hasVisibleApp, groupId, callId, media, from }) => {
    const group = await Conversation.findById(groupId).select("name participants mutedUntil");
    if (!group) return;
    const callerName = from?.name || from?.username || "Someone";
    await Promise.all(group.participants.map(String).filter((id) => id !== String(from?._id)).map(async (id) => {
        if (isMuted(group, id) || (await hasVisibleApp(id))) return;
        const person = await User.findById(id).select("pushShowSender").lean();
        const showSender = person?.pushShowSender !== false;
        await sendPush(
            id,
            {
                title: showSender ? group.name : "OpenChat",
                body: showSender ? `${callerName} started a ${media === "video" ? "video" : "voice"} call` : "A group call started",
                url: `/chat/${groupId}`,
                tag: `groupcall-${callId}`,
                call: true,
            },
            { urgency: "high", ttlSeconds: RING_SECONDS, topic: callId.replaceAll("-", "") },
        );
    }));
};

export const createGroupCalls = ({ io, userRoom, hasVisibleApp = async () => false }) => {
    const calls = new Map(); // groupId -> { callId, media, startedAt, people: Map(userId -> socketId) }

    const summary = (groupId) => {
        const call = calls.get(groupId);
        return call
            ? { groupId, active: true, callId: call.callId, media: call.media, startedAt: call.startedAt, participants: [...call.people.keys()] }
            : { groupId, active: false };
    };
    const members = async (groupId) => (await Conversation.findById(groupId).select("participants").lean())?.participants.map(String) ?? [];
    // Every member's tabs keep the "Call in progress · Join" bar right.
    const tellMembers = async (groupId, extra = []) => {
        const state = summary(groupId);
        new Set([...(await members(groupId)), ...extra]).forEach((id) => io.to(userRoom(id)).emit("groupCallUpdated", state));
    };

    const leave = (groupId, userId, socketId) => {
        const call = calls.get(groupId);
        if (!call || !call.people.has(userId)) return;
        if (socketId && call.people.get(userId) !== socketId) return; // an older tab of theirs
        call.people.delete(userId);
        call.people.forEach((otherSocket) => io.to(otherSocket).emit("groupCallPeerLeft", { groupId, callId: call.callId, userId }));
        if (call.people.size === 0) calls.delete(groupId);
        tellMembers(groupId, [userId]).catch((error) => console.error("Group call:", error.message));
    };

    const memberGroup = async (groupId, userId) => {
        const group = await Conversation.findOne({ _id: groupId, type: "group", participants: userId }).select("name participants mutedUntil");
        if (!group) throw new AppError("Group not found", 404);
        return group;
    };

    const register = (socket, { replyWithError }) => {
        const me = socket.userId;
        // Each handler: its result goes into the ack; errors as { success: false }.
        const on = (event, handle) => {
            socket.on(event, async (data, ack) => {
                try {
                    const extra = await handle(data ?? {});
                    if (typeof ack === "function") ack({ success: true, ...extra });
                } catch (err) {
                    replyWithError(err, ack);
                }
            });
        };

        // Start the group's call, or join the one going on. The answer lists
        // who is in it already: the joiner connects to each of them.
        on("groupCallJoin", async ({ groupId, callId, media }) => {
            if (typeof groupId !== "string") throw new AppError("Invalid group id", 400);
            const group = await memberGroup(groupId, me).catch((error) => {
                if (error.name === "CastError") throw new AppError("Invalid group id", 400);
                throw error;
            });
            let call = calls.get(groupId);
            const starting = !call;
            if (starting) {
                checkCallId(callId);
                if (!MEDIA.includes(media)) throw new AppError("media must be audio or video", 400);
                call = { callId, media, startedAt: new Date(), people: new Map() };
            } else if (!call.people.has(me) && call.people.size >= MAX_IN_CALL) {
                throw new AppError(`At most ${MAX_IN_CALL} people can be in a group call`, 409, { reason: "full" });
            }
            const others = [...call.people.keys()].filter((id) => id !== me);
            // The same person from another device: that one drops out.
            const oldSocket = call.people.get(me);
            if (oldSocket && oldSocket !== socket.id) io.to(oldSocket).emit("groupCallHandledElsewhere", { groupId, callId: call.callId });
            call.people.set(me, socket.id);
            calls.set(groupId, call);
            socket.data.groupCalls ??= new Set();
            socket.data.groupCalls.add(groupId);
            others.forEach((id) => io.to(call.people.get(id)).emit("groupCallPeerJoined", { groupId, callId: call.callId, userId: me }));
            if (starting) {
                const from = await User.findById(me).select(PUBLIC_USER_FIELDS).lean();
                // Members who muted the group don't ring (the "in progress" bar still shows).
                group.participants.map(String).filter((id) => id !== me && !isMuted(group, id)).forEach((id) =>
                    io.to(userRoom(id)).emit("groupCallRinging", { groupId, groupName: group.name, callId, media, from }));
                pushCallStart({ hasVisibleApp, groupId, callId, media, from }).catch((error) => console.error("Group call push:", error.message));
            }
            await tellMembers(groupId);
            return { callId: call.callId, media: call.media, participants: others };
        });

        // An encrypted signal for one other person in the same call.
        on("groupCallSignal", async ({ groupId, callId, to, kind, data }) => {
            const call = calls.get(groupId);
            if (!call || call.callId !== callId || call.people.get(me) !== socket.id) throw new AppError("You are not in this call", 403);
            if (!SIGNAL_KINDS.includes(kind)) throw new AppError("Invalid signal", 400);
            const target = call.people.get(String(to));
            if (!target || String(to) === me) throw new AppError("They are not in this call", 404);
            io.to(target).emit("groupCallSignal", { groupId, callId, from: me, kind, data: checkSignal(data) });
        });

        on("groupCallLeave", async ({ groupId }) => {
            leave(groupId, me, socket.id);
        });

        // Is there a call in this group now? (Members only.)
        on("groupCallState", async ({ groupId }) => {
            await memberGroup(groupId, me).catch((error) => {
                if (error.name === "CastError") throw new AppError("Invalid group id", 400);
                throw error;
            });
            return summary(groupId);
        });

        socket.on("disconnect", () => socket.data.groupCalls?.forEach((groupId) => leave(groupId, me, socket.id)));
    };

    return {
        register,
        // Out of the group: out of its call too.
        leftGroup: (groupId, userId) => leave(String(groupId), String(userId)),
        // The group is gone: its call ends at once for everyone in it.
        endCall: (groupId) => {
            const call = calls.get(String(groupId));
            if (!call) return;
            calls.delete(String(groupId));
            call.people.forEach((_socketId, userId) => io.to(userRoom(userId)).emit("groupCallUpdated", { groupId: String(groupId), active: false }));
        },
    };
};
