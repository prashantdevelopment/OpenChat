import { Server } from "socket.io";
import { CLIENT_URL } from "./config/env.js";
import socketAuthMiddleware from "./middleware/socket-auth.middleware.js";
import AppError from "./utils/AppError.js";
import { getConversationForParticipant } from "./services/conversation.service.js";
import { createMessage } from "./services/message.service.js";

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
                const message = await createMessage(data?.conversationId, socket.userId, data?.content);
                io.to(message.conversationId.toString()).emit("newMessage", message);

                if (typeof ack === "function") ack({ success: true, message });
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
