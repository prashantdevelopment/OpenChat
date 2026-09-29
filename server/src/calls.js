import AppError from "./utils/AppError.js";
import { base64Length, isBase64 } from "./utils/base64.js";
import User, { PUBLIC_USER_FIELDS } from "./models/user.model.js";
import { getConversationForParticipant } from "./services/conversation.service.js";
import { assertNotBlocked } from "./services/block.service.js";
import { isOnline } from "./presence.js";

// Call signaling (WebRTC). The server only relays: the offer, the answer and
// the network candidates are encrypted in the browser with the conversation
// key, so the server can neither read them (they contain IP addresses) nor
// change them. Changing them is how a server could put itself in the middle
// of the call; the encrypted SDP carries the DTLS fingerprint that the two
// browsers then check, so the audio itself is end-to-end encrypted too.
// Call state (busy, missed, timeouts) lives in the browsers; the server only
// remembers a call while it rings, for a callee whose app is closed
// (services/ringingCalls.service.js).

const CALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SIGNAL_BYTES = 32 * 1024; // an SDP is a few KB
// "missed": nobody answered in time (the caller's browser gives up).
const END_REASONS = ["ended", "declined", "cancelled", "busy", "failed", "missed"];
const MEDIA = ["audio", "video"];

// { ciphertext, iv } made by the browser's encryptMessage().
const checkSignal = (signal) => {
    const { ciphertext, iv } = signal ?? {};
    if (!isBase64(ciphertext) || !isBase64(iv) || base64Length(iv) !== 12 || base64Length(ciphertext) > MAX_SIGNAL_BYTES) {
        throw new AppError("Invalid call signal", 400);
    }
    return { ciphertext, iv };
};

const checkCallId = (callId) => {
    if (typeof callId !== "string" || !CALL_ID_PATTERN.test(callId)) {
        throw new AppError("Invalid call id", 400);
    }
    return callId;
};

const registerCallHandlers = (io, socket, { userRoom, replyWithError, ringingCalls }) => {
    // The conversation (the user must be in it) and the other participant.
    // No call signal crosses a block, so blocking also ends a ringing call.
    const callPeer = async (conversationId) => {
        const conversation = await getConversationForParticipant(conversationId, socket.userId);
        const peerId = conversation.participants.map(String).find((id) => id !== socket.userId);
        await assertNotBlocked(socket.userId, peerId, "You can't call this person");
        return { conversation, peerId };
    };

    // Each handler: check, then relay to the other participant's tabs. What a
    // handler returns is added to the ack.
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

    on("callUser", async ({ conversationId, callId, media, offer }) => {
        checkCallId(callId);
        if (!MEDIA.includes(media)) {
            throw new AppError("media must be audio or video", 400);
        }
        const encryptedOffer = checkSignal(offer);
        const { conversation, peerId } = await callPeer(conversationId);
        // Who is calling, so the callee can show a name and derive the key.
        const caller = await User.findById(socket.userId).select(PUBLIC_USER_FIELDS);
        io.to(userRoom(peerId)).emit("incomingCall", {
            callId,
            conversationId: conversation._id,
            media,
            from: caller,
            offer: encryptedOffer,
        });
        // Kept while it rings; a push if they aren't looking at OpenChat.
        ringingCalls.start({ callId, callerId: socket.userId, calleeId: peerId, conversationId: conversation._id, media, offer: encryptedOffer, from: caller })
            .catch((error) => console.error("Ringing call:", error.message));
        // "Ringing" if the callee has the app open somewhere, else "Calling".
        return { ringing: isOnline(peerId) };
    });

    on("answerCall", async ({ conversationId, callId, answer }) => {
        checkCallId(callId);
        const encryptedAnswer = checkSignal(answer);
        const { conversation, peerId } = await callPeer(conversationId);
        ringingCalls.answered(callId, socket.userId);
        io.to(userRoom(peerId)).emit("callAnswered", { callId, conversationId: conversation._id, answer: encryptedAnswer });
        // My other tabs stop ringing: this one took the call.
        socket.to(userRoom(socket.userId)).emit("callHandledElsewhere", { callId });
    });

    on("iceCandidate", async ({ conversationId, callId, candidate }) => {
        checkCallId(callId);
        const encryptedCandidate = checkSignal(candidate);
        const { conversation, peerId } = await callPeer(conversationId);
        ringingCalls.addCandidate(callId, socket.userId, encryptedCandidate);
        io.to(userRoom(peerId)).emit("iceCandidate", { callId, conversationId: conversation._id, candidate: encryptedCandidate });
    });

    // A connected call whose network dropped (the app went to the background,
    // WiFi → mobile data): the browsers set it up again on new routes (ICE
    // restart). Either a new encrypted offer/answer, or `request: true` (the
    // callee, back online, asks the caller to restart).
    on("callRestart", async ({ conversationId, callId, description, request }) => {
        checkCallId(callId);
        const payload = { callId };
        if (description !== undefined) payload.description = checkSignal(description);
        else if (request === true) payload.request = true;
        else throw new AppError("Nothing to restart with", 400);
        const { conversation, peerId } = await callPeer(conversationId);
        io.to(userRoom(peerId)).emit("callRestart", { ...payload, conversationId: conversation._id });
    });

    on("endCall", async ({ conversationId, callId, reason }) => {
        checkCallId(callId);
        if (!END_REASONS.includes(reason)) {
            throw new AppError("Invalid reason", 400);
        }
        const { conversation, peerId } = await callPeer(conversationId);
        ringingCalls.ended(callId, socket.userId);
        io.to(userRoom(peerId)).emit("callEnded", { callId, conversationId: conversation._id, reason });
        // Declining in one tab stops the ringing in the others.
        socket.to(userRoom(socket.userId)).emit("callHandledElsewhere", { callId });
    });
};

export default registerCallHandlers;
