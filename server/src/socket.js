import { Server } from "socket.io";
import { CLIENT_URL, TRUST_PROXY } from "./config/env.js";
import { createLimiter } from "./rateLimit.js";
import { sessionEvents } from "./session.js";
import socketAuthMiddleware from "./middleware/socket-auth.middleware.js";
import AppError from "./utils/AppError.js";
import { countUnread, findConversationBetween, getContactIds, getConversationForParticipant, markAllDelivered, markConversationDelivered, markConversationRead, otherParticipant, readReceiptsShared } from "./services/conversation.service.js";
import { blockEvents, hasBlocked, isBlockedBetween } from "./services/block.service.js";
import User from "./models/user.model.js";
import { isOnline, socketClosed, socketOpened } from "./presence.js";
import { markOffline, markOnline, statePresenceSnapshot } from "./statePresence.js";
import { createMessage } from "./services/message.service.js";
import registerCallHandlers from "./calls.js";

const userRoom = (userId) => `user:${userId}`;
const sessionRoom = (jti) => `session:${jti}`;

// Events per user (all their tabs together) in a window. Generous for a
// person, tight for a script. An event over its limit is dropped; if it
// expects an answer, it gets "slow down". Events not listed aren't limited
// (leaveConversation, unwatchStatePresence: they only remove things).
const EVENT_LIMITS = {
    sendMessage: { windowMs: 10_000, max: 30 },
    typing: { windowMs: 10_000, max: 20 },
    markRead: { windowMs: 10_000, max: 60 },
    markDelivered: { windowMs: 10_000, max: 60 },
    joinConversation: { windowMs: 10_000, max: 60 },
    watchStatePresence: { windowMs: 60_000, max: 20 },
    callUser: { windowMs: 60_000, max: 10 },
    answerCall: { windowMs: 60_000, max: 20 },
    endCall: { windowMs: 60_000, max: 30 },
    iceCandidate: { windowMs: 10_000, max: 200 },
    // Reconnecting a dropped call: a couple of offers/answers a minute is plenty.
    callRestart: { windowMs: 60_000, max: 30 },
};
// New connections per IP address a minute (each tab reconnects on its own).
const CONNECTIONS_PER_MINUTE = 60;

// The client's address, also behind the host's proxies (see TRUST_PROXY).
const clientAddress = (socket) => {
    const forwarded = String(socket.handshake.headers["x-forwarded-for"] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    return (TRUST_PROXY > 0 && forwarded.at(-TRUST_PROXY)) || socket.handshake.address;
};

// Builds the Socket.IO server on top of an HTTP server (like app.js builds
// the Express app). server.js starts it; tests create their own.
// presenceGraceMs: how long a user whose last tab closed still counts as
// online (a page reload reconnects within that time). Tests make it short.
// statePresenceIntervalMs: the state counts (for the Discover page) are sent
// at most this often, and only when they changed.
const STATE_PRESENCE_ROOM = "state-presence";
const createSocketServer = (httpServer, { presenceGraceMs = 5000, statePresenceIntervalMs = 3000 } = {}) => {
    const io = new Server(httpServer, {
        cors: {
            origin: CLIENT_URL,
            credentials: true
        },
        // CORS only covers the polling transport; a WebSocket handshake isn't
        // checked by it. Browsers always send Origin: only the app's own is
        // let in (another site can't open a socket as the user, on top of the
        // SameSite cookie). Non-browser clients send none and still need a
        // valid session cookie.
        allowRequest: (req, callback) => {
            const origin = req.headers.origin;
            callback(null, origin === undefined || origin === CLIENT_URL);
        },
    });

    const connectionLimiter = createLimiter({ windowMs: 60_000, max: CONNECTIONS_PER_MINUTE });
    io.use((socket, next) => {
        if (connectionLimiter.hit(`connect:${clientAddress(socket)}`).allowed) return next();
        next(new Error("Too many connections"));
    });
    io.use(socketAuthMiddleware);

    const eventLimiters = Object.fromEntries(Object.entries(EVENT_LIMITS).map(([event, limit]) => [event, createLimiter(limit)]));

    // Logout ended a session: its sockets are told, then closed.
    const onSessionRevoked = (jti) => {
        io.to(sessionRoom(jti)).emit("sessionExpired");
        io.in(sessionRoom(jti)).disconnectSockets(true);
    };
    sessionEvents.on("revoked", onSessionRevoked);

    // Delivered / read receipt: to the other participants (every tab), so
    // their messages get the right ticks. { deliveredAt } and/or { readAt }.
    const sendReceipt = (conversation, userId, times) => {
        conversation.participants
            .filter((participantId) => participantId.toString() !== userId)
            .forEach((participantId) => {
                io.to(userRoom(participantId)).emit("receipt", { conversationId: conversation._id, userId, ...times });
            });
    };

    // Receipts never cross a block (they would show the other one is active).
    const sendReceiptUnlessBlocked = async (conversation, userId, times) => {
        if (await isBlockedBetween(userId, otherParticipant(conversation, userId))) return;
        sendReceipt(conversation, userId, times);
    };

    // A block or unblock (block.service.js). The blocker's tabs leave the
    // chat's room (so the blocked person's typing never reaches them) and
    // reload their chat list; the blocked person just sees them go offline,
    // as if they closed the app. Unblocking shows each the other's real status.
    const onBlocked = async ({ blockerId, blockedId }) => {
        try {
            const conversation = await findConversationBetween(blockerId, blockedId);
            if (conversation) io.in(userRoom(blockerId)).socketsLeave(conversation._id.toString());
            io.to(userRoom(blockerId)).emit("blocksChanged", { userId: blockedId, blocked: true });
            io.to(userRoom(blockedId)).emit("presence", { userId: blockerId, online: false, lastSeen: null });
        } catch (err) {
            console.error("Block error:", err);
        }
    };
    const onUnblocked = async ({ blockerId, blockedId }) => {
        try {
            io.to(userRoom(blockerId)).emit("blocksChanged", { userId: blockedId, blocked: false });
            if (!(await isBlockedBetween(blockerId, blockedId))) {
                const blocker = await User.findById(blockerId).select("lastSeen");
                io.to(userRoom(blockedId)).emit("presence", { userId: blockerId, online: isOnline(blockerId), lastSeen: blocker?.lastSeen ?? null });
            }
        } catch (err) {
            console.error("Block error:", err);
        }
    };
    blockEvents.on("blocked", onBlocked);
    blockEvents.on("unblocked", onUnblocked);
    // Tests start and stop many servers: don't leave listeners behind.
    httpServer.on("close", () => {
        blockEvents.off("blocked", onBlocked);
        blockEvents.off("unblocked", onUnblocked);
        sessionEvents.off("revoked", onSessionRevoked);
    });

    // Online counts per state, to the pages that watch them (Discover).
    // Batched: many people coming online at once cause one update.
    let lastSentCounts = JSON.stringify(statePresenceSnapshot());
    let countsTimer = null;
    const scheduleStateCounts = () => {
        if (countsTimer) return;
        countsTimer = setTimeout(() => {
            countsTimer = null;
            const snapshot = statePresenceSnapshot();
            const json = JSON.stringify(snapshot);
            if (json === lastSentCounts) return;
            lastSentCounts = json;
            io.to(STATE_PRESENCE_ROOM).emit("statePresence", snapshot);
        }, statePresenceIntervalMs);
        countsTimer.unref(); // never keeps the process alive on its own
    };

    // Presence goes only to people who share a conversation with the user.
    const notifyContacts = async (userId, presence) => {
        const contactIds = await getContactIds(userId);
        contactIds.forEach((contactId) => io.to(userRoom(contactId)).emit("presence", { userId, ...presence }));
    };
    io.on("connection", (socket) => {
        console.log("A user connected:", socket.id , "User ID:", socket.userId);

        // Personal room: every socket (tab/device) of this user joins it, so the
        // server can reach the user no matter which conversation is open.
        // Joined on every connection, so it survives reconnects automatically.
        socket.join(userRoom(socket.userId));

        // The login session behind this socket: it closes when the session
        // expires (the token was only checked once, at connect) or is ended
        // by logout. The client then asks for a new login.
        const { jti, expiresAt } = socket.data.session;
        if (jti) socket.join(sessionRoom(jti));
        const expiryTimer = setTimeout(() => {
            socket.emit("sessionExpired");
            socket.disconnect(true);
        }, Math.max(0, expiresAt - Date.now()));
        socket.on("disconnect", () => clearTimeout(expiryTimer));

        // Rate limits for every incoming event (see EVENT_LIMITS).
        socket.use(([event, ...args], next) => {
            const limiter = eventLimiters[event];
            if (!limiter || limiter.hit(`${event}:${socket.userId}`).allowed) return next();
            const ack = args.at(-1);
            if (typeof ack === "function") ack({ success: false, message: "You're doing that too often. Wait a moment and try again." });
        });

        // The app is open: messages sent while the user was away have arrived.
        markAllDelivered(socket.userId)
            .then((delivered) => Promise.all(delivered.map(({ conversation, deliveredAt }) => sendReceiptUnlessBlocked(conversation, socket.userId, { deliveredAt }))))
            .catch((err) => console.error("Receipt error:", err));

        // First tab/device: tell the contacts. (More tabs change nothing.)
        if (socketOpened(socket.userId)) {
            notifyContacts(socket.userId, { online: true }).catch((err) => console.error("Presence error:", err));
            // Counted in their state. (Still online once the state is loaded:
            // a very quick disconnect must not leave a count behind.)
            User.findById(socket.userId).select("state")
                .then((user) => {
                    if (user && isOnline(socket.userId)) {
                        markOnline(socket.userId, user.state);
                        scheduleStateCounts();
                    }
                })
                .catch((err) => console.error("Presence error:", err));
        }

        // The Discover page: current counts now (in the ack), then live updates.
        socket.on("watchStatePresence", (ack) => {
            socket.join(STATE_PRESENCE_ROOM);
            if (typeof ack === "function") ack({ success: true, ...statePresenceSnapshot() });
        });
        socket.on("unwatchStatePresence", () => socket.leave(STATE_PRESENCE_ROOM));

        // Socket handlers are not covered by Express's error middleware:
        // an uncaught error here would crash the whole server, so every
        // handler catches its errors and reports them through the ack.
        const replyWithError = (err, ack) => {
            if (!(err instanceof AppError)) {
                console.error("Socket handler error:", err);
            }
            if (typeof ack === "function") {
                ack({
                    success: false,
                    message: err instanceof AppError ? err.message : "Something went wrong"
                });
            }
        };

        socket.on("joinConversation", async (conversationId, ack) => {
            try {
                const conversation = await getConversationForParticipant(conversationId, socket.userId);
                // Someone who blocked the other person reads the history but
                // stays out of the live room: no typing or messages from them.
                if (await hasBlocked(socket.userId, otherParticipant(conversation, socket.userId))) {
                    if (typeof ack === "function") ack({ success: true });
                    return;
                }
                socket.join(conversation._id.toString());
                console.log("User joined conversation:", conversation._id.toString(), "User:", socket.userId);

                if (typeof ack === "function") ack({ success: true });
            } catch (err) {
                replyWithError(err, ack);
            }
        });

        const handleSendMessage = async (data, ack) => {
            try {
                const { message, conversation, duplicate } = await createMessage(data?.conversationId, socket.userId, data);

                // A retry of an already delivered message: everyone has it, just confirm.
                if (duplicate) {
                    if (typeof ack === "function") ack({ success: true, message });
                    return;
                }

                // Each participant has their own unread count. Count BEFORE
                // emitting newMessage: the reader only sends "markRead" after
                // receiving the message, so it can never be counted as unread
                // after it was already marked read.
                const unreadCounts = await Promise.all(
                    conversation.participants.map((participantId) => countUnread(conversation, participantId))
                );

                // Small summary: to every tab of each participant, for their sidebar.
                conversation.participants.forEach((participantId, i) => {
                    io.to(userRoom(participantId)).emit("conversationUpdated", {
                        _id: conversation._id,
                        lastMessage: conversation.lastMessage,
                        lastMessageAt: conversation.lastMessageAt,
                        unreadCount: unreadCounts[i]
                    });
                });

                // Full message: only to people who have this conversation open.
                io.to(message.conversationId.toString()).emit("newMessage", message);

                if (typeof ack === "function") ack({ success: true, message });
            } catch (err) {
                replyWithError(err, ack);
            }
        };

        // One message at a time per connection, in the order they were sent.
        // Handled in parallel, a quick second message could be saved or
        // announced before the first one. handleSendMessage never throws
        // (it catches its errors), so one failed message can't block the queue.
        let sendQueue = Promise.resolve();
        socket.on("sendMessage", (data, ack) => {
            sendQueue = sendQueue.then(() => handleSendMessage(data, ack));
        });

        // The user has seen everything in this conversation. All of their tabs
        // clear the badge (the other participant is not told: read receipts
        // are a separate, optional feature).
        socket.on("markRead", async (conversationId, ack) => {
            try {
                const { conversation, readAt } = await markConversationRead(conversationId, socket.userId);
                io.to(userRoom(socket.userId)).emit("conversationRead", { _id: conversation._id });
                // Read implies delivered. The read time only if both share read receipts.
                const shared = await readReceiptsShared(conversation);
                await sendReceiptUnlessBlocked(conversation, socket.userId, shared ? { deliveredAt: readAt, readAt } : { deliveredAt: readAt });

                if (typeof ack === "function") ack({ success: true });
            } catch (err) {
                replyWithError(err, ack);
            }
        });

        // "Is typing" for the people who have the conversation open. Only
        // relayed into a room this socket has joined, and joinConversation
        // already checked that the user is a participant (no database query
        // per keystroke). The client limits how often it sends this.
        socket.on("typing", (data) => {
            const conversationId = data?.conversationId;
            if (typeof conversationId !== "string" || typeof data.isTyping !== "boolean") return;
            if (!socket.rooms.has(conversationId)) return;
            socket.to(conversationId).emit("typing", { conversationId, userId: socket.userId, isTyping: data.isTyping });
        });

        // The client received a new message notice (conversationUpdated) for a
        // conversation: its messages reached this device.
        socket.on("markDelivered", async (conversationId, ack) => {
            try {
                const { conversation, deliveredAt } = await markConversationDelivered(conversationId, socket.userId);
                await sendReceiptUnlessBlocked(conversation, socket.userId, { deliveredAt });
                if (typeof ack === "function") ack({ success: true });
            } catch (err) {
                replyWithError(err, ack);
            }
        });

        registerCallHandlers(io, socket, { userRoom, replyWithError });

        socket.on("leaveConversation", (conversationId) => {
            socket.leave(conversationId);
            console.log("User left conversation:", conversationId, "User:", socket.userId);
        });

        socket.on("disconnect", () => {
            console.log("A user disconnected:", socket.id, "User ID:", socket.userId);
            socketClosed(socket.userId, presenceGraceMs, async () => {
                markOffline(socket.userId);
                scheduleStateCounts();
                try {
                    const lastSeen = new Date();
                    await User.updateOne({ _id: socket.userId }, { lastSeen });
                    await notifyContacts(socket.userId, { online: false, lastSeen });
                } catch (err) {
                    console.error("Presence error:", err);
                }
            });
        });
    });

    return io;
};

export default createSocketServer;
