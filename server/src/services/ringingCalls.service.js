import User from "../models/user.model.js";
import { sendPush } from "./push.service.js";
import { isBlockedBetween } from "./block.service.js";

// Calls that are ringing (step 65). Signaling is otherwise a plain relay
// (calls.js), so a callee whose app is closed would never hear of a call. The
// server keeps each unanswered call for as long as it rings: the encrypted
// offer and the caller's encrypted network candidates (it can't read either).
// - The callee has no OpenChat on screen: an urgent push "Riya · Incoming
//   voice call". Tapping it opens OpenChat, whose socket then gets the call
//   (deliverTo) and rings while the caller still waits.
// - Nobody answered (the caller gave up, cancelled, or vanished): the same
//   notification becomes "Missed voice call".
// Kept in memory: one server instance (Render). A restart drops ringing calls,
// which the caller's side ends by itself.

const MAX_CANDIDATES = 50;
const kindOf = (media) => (media === "video" ? "video call" : "voice call");
// A push topic is at most 32 URL-safe characters: the call id without dashes.
const topicOf = (callId) => callId.replaceAll("-", "");

export const createRingingCalls = ({ hasVisibleApp, ringMs = 35_000 }) => {
    const calls = new Map(); // callId -> { callerId, calleeId, conversationId, media, offer, from, startedAt, candidates, pushed, timer }

    const push = async (call, body, options) => {
        const [caller, callee] = await Promise.all([
            User.findById(call.callerId).select("name username").lean(),
            User.findById(call.calleeId).select("pushShowSender").lean(),
        ]);
        if (!caller || !callee) return 0;
        return sendPush(
            call.calleeId,
            {
                title: callee.pushShowSender !== false ? caller.name || caller.username : "OpenChat",
                body,
                url: `/chat/${call.conversationId}`,
                tag: `call-${call.callId}`,
                ...options.extra,
            },
            { urgency: options.urgency, ttlSeconds: options.ttlSeconds, topic: topicOf(call.callId) },
        );
    };
    const report = (error) => console.error("Call push failed:", error.message);

    // Ended without an answer: "Missed …", only where the ring was a push and
    // the callee still isn't looking at OpenChat.
    const missed = async (call) => {
        if (!call.pushed || (await hasVisibleApp(call.calleeId))) return;
        await push(call, `Missed ${kindOf(call.media)}`, { urgency: "normal", ttlSeconds: 24 * 60 * 60 });
    };

    const remove = (callId) => {
        const call = calls.get(callId);
        if (!call) return null;
        clearTimeout(call.timer);
        calls.delete(callId);
        return call;
    };

    return {
        // After callUser was relayed.
        start: async ({ callId, callerId, calleeId, conversationId, media, offer, from }) => {
            const call = { callId, callerId, calleeId, conversationId: String(conversationId), media, offer, from, startedAt: Date.now(), candidates: [], pushed: false };
            call.timer = setTimeout(() => {
                if (remove(callId)) missed(call).catch(report); // the caller vanished without hanging up
            }, ringMs);
            call.timer.unref?.();
            calls.set(callId, call);
            if (await hasVisibleApp(calleeId)) return; // it rings on their screen
            call.pushed = true;
            // Urgent, and useless after the ring: it must arrive at once or not at all.
            await push(call, `Incoming ${kindOf(media)}`, { urgency: "high", ttlSeconds: Math.ceil(ringMs / 1000), extra: { call: true } })
                .catch(report);
        },
        // The caller's candidates, for a callee who connects later.
        addCandidate: (callId, senderId, candidate) => {
            const call = calls.get(callId);
            if (call?.callerId === senderId && call.candidates.length < MAX_CANDIDATES) call.candidates.push(candidate);
        },
        answered: (callId, userId) => {
            if (calls.get(callId)?.calleeId === userId) remove(callId);
        },
        // endCall from either side. Only the two of them can end it.
        ended: (callId, userId) => {
            const call = calls.get(callId);
            if (!call || (userId !== call.callerId && userId !== call.calleeId)) return;
            remove(callId);
            // The caller gave up, hung up or failed before an answer: a missed call.
            if (userId === call.callerId) missed(call).catch(report);
        },
        // A socket of this user just connected: the calls ringing for them,
        // each with the time it still rings. Never across a block.
        deliverTo: async (socket, userId) => {
            for (const call of calls.values()) {
                if (call.calleeId !== userId) continue;
                if (await isBlockedBetween(call.callerId, call.calleeId)) continue;
                const ringsForMs = Math.max(0, call.startedAt + ringMs - Date.now());
                socket.emit("incomingCall", { callId: call.callId, conversationId: call.conversationId, media: call.media, from: call.from, offer: call.offer, ringsForMs });
                call.candidates.forEach((candidate) => socket.emit("iceCandidate", { callId: call.callId, conversationId: call.conversationId, candidate }));
            }
        },
    };
};
