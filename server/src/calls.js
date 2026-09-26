import AppError from "./utils/AppError.js";
import { base64Length, isBase64 } from "./utils/base64.js";
import User, { PUBLIC_USER_FIELDS } from "./models/user.model.js";
import { getConversationForParticipant } from "./services/conversation.service.js";

// Call signaling (WebRTC). The server only relays: the offer, the answer and
// the network candidates are encrypted in the browser with the conversation
// key, so the server can neither read them (they contain IP addresses) nor
// change them. Changing them is how a server could put itself in the middle
// of the call; the encrypted SDP carries the DTLS fingerprint that the two
// browsers then check, so the audio itself is end-to-end encrypted too.
// Call state (busy, missed, timeouts) lives in the browsers for now.

const CALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SIGNAL_BYTES = 32 * 1024; // an SDP is a few KB
const END_REASONS = ["ended", "declined", "cancelled", "busy", "failed"];

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

const registerCallHandlers = (io, socket, { userRoom, replyWithError }) => {
    // The conversation (the user must be in it) and the other participant.
    const callPeer = async (conversationId) => {
        const conversation = await getConversationForParticipant(conversationId, socket.userId);
        const peerId = conversation.participants.map(String).find((id) => id !== socket.userId);
        return { conversation, peerId };
    };

    // Each handler: check, then relay to the other participant's tabs.
    const on = (event, handle) => {
        socket.on(event, async (data, ack) => {
            try {
                await handle(data ?? {});
                if (typeof ack === "function") ack({ success: true });
            } catch (err) {
                replyWithError(err, ack);
            }
        });
    };

    on("callUser", async ({ conversationId, callId, offer }) => {
        checkCallId(callId);
        const encryptedOffer = checkSignal(offer);
        const { conversation, peerId } = await callPeer(conversationId);
        // Who is calling, so the callee can show a name and derive the key.
        const caller = await User.findById(socket.userId).select(PUBLIC_USER_FIELDS);
        io.to(userRoom(peerId)).emit("incomingCall", {
            callId,
            conversationId: conversation._id,
            media: "audio",
            from: caller,
            offer: encryptedOffer,
        });
    });

    on("answerCall", async ({ conversationId, callId, answer }) => {
        checkCallId(callId);
        const encryptedAnswer = checkSignal(answer);
        const { conversation, peerId } = await callPeer(conversationId);
        io.to(userRoom(peerId)).emit("callAnswered", { callId, conversationId: conversation._id, answer: encryptedAnswer });
        // My other tabs stop ringing: this one took the call.
        socket.to(userRoom(socket.userId)).emit("callHandledElsewhere", { callId });
    });

    on("iceCandidate", async ({ conversationId, callId, candidate }) => {
        checkCallId(callId);
        const encryptedCandidate = checkSignal(candidate);
        const { conversation, peerId } = await callPeer(conversationId);
        io.to(userRoom(peerId)).emit("iceCandidate", { callId, conversationId: conversation._id, candidate: encryptedCandidate });
    });

    on("endCall", async ({ conversationId, callId, reason }) => {
        checkCallId(callId);
        if (!END_REASONS.includes(reason)) {
            throw new AppError("Invalid reason", 400);
        }
        const { conversation, peerId } = await callPeer(conversationId);
        io.to(userRoom(peerId)).emit("callEnded", { callId, conversationId: conversation._id, reason });
        // Declining in one tab stops the ringing in the others.
        socket.to(userRoom(socket.userId)).emit("callHandledElsewhere", { callId });
    });
};

export default registerCallHandlers;
