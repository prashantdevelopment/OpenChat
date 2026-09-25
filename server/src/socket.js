import { Server } from "socket.io";
import { CLIENT_URL } from "./config/env.js";
import socketAuthMiddleware from "./middleware/socket-auth.middleware.js";
import AppError from "./utils/AppError.js";
import { countUnread, getConversationForParticipant, markConversationRead } from "./services/conversation.service.js";
import { createMessage } from "./services/message.service.js";

const userRoom = (userId) => `user:${userId}`;

// Builds the Socket.IO server on top of an HTTP server (like app.js builds
// the Express app). server.js starts it; tests create their own.
const createSocketServer = (httpServer) => {
    const io = new Server(httpServer, {
        cors: {
            origin: CLIENT_URL,
            credentials: true
        }
    });

    io.use(socketAuthMiddleware);
    io.on("connection", (socket) => {
        console.log("A user connected:", socket.id , "User ID:", socket.userId);

        // Personal room: every socket (tab/device) of this user joins it, so the
        // server can reach the user no matter which conversation is open.
        // Joined on every connection, so it survives reconnects automatically.
        socket.join(userRoom(socket.userId));

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
                socket.join(conversation._id.toString());
                console.log("User joined conversation:", conversation._id.toString(), "User:", socket.userId);

                if (typeof ack === "function") ack({ success: true });
            } catch (err) {
                replyWithError(err, ack);
            }
        });

        socket.on("sendMessage", async (data, ack) => {
            try {
                const { message, conversation } = await createMessage(data?.conversationId, socket.userId, data?.content);

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
        });

        // The user has seen everything in this conversation. All of their tabs
        // clear the badge (the other participant is not told: read receipts
        // are a separate, optional feature).
        socket.on("markRead", async (conversationId, ack) => {
            try {
                const conversation = await markConversationRead(conversationId, socket.userId);
                io.to(userRoom(socket.userId)).emit("conversationRead", { _id: conversation._id });

                if (typeof ack === "function") ack({ success: true });
            } catch (err) {
                replyWithError(err, ack);
            }
        });

        socket.on("leaveConversation", (conversationId) => {
            socket.leave(conversationId);
            console.log("User left conversation:", conversationId, "User:", socket.userId);
        });

        socket.on("disconnect", () => {
            console.log("A user disconnected:", socket.id, "User ID:", socket.userId);
        });
    });

    return io;
};

export default createSocketServer;
