import app from "./app.js";
import { PORT } from "./config/env.js";
import { createServer } from "http";
import { Server } from "socket.io";
import { CLIENT_URL } from "./config/env.js";
import connectDatabase from "./config/database.js";
import socketAuthMiddleware from "./middleware/socket-auth.middleware.js";
import Conversation from "./models/conversation.model.js";
import { createMessage } from "./services/message.service.js";

const startServer = async () => {

    try{
    await connectDatabase();

    const server = createServer(app);
    const io = new Server(server, {
        cors: {
            origin: CLIENT_URL,
            credentials: true
        }
    });

    io.use(socketAuthMiddleware);
    io.on("connection", (socket) => {
        console.log("A user connected:", socket.id , "User ID:", socket.userId);

        socket.on("joinConversation", async (conversationId) => {
            console.log("Joining conversation:", conversationId);
            const conversation = await Conversation.findById(conversationId);
            if (!conversation) {
                return console.log("Conversation not found:", conversationId);
            }
            const isParticipant = conversation.participants.some(
                participant => participant.toString() === socket.userId.toString()
            );

            if (!isParticipant) {
                return console.log("User is not a participant in this conversation:", socket.userId);
            }  

            socket.join(conversationId);
            console.log(
            "User joined conversation:",
                        conversationId,
                                "User:",
                            socket.userId);
            });

            socket.on("sendMessage", async (data) => {
                console.log("Received message:", data);
                const { conversationId, content } = data;
                const message = await createMessage(conversationId, socket.userId, content);
                console.log("Message saved:", message._id);

                io.to(conversationId).emit("newMessage", message);
            })

        socket.on("disconnect", () => {
            console.log("A user disconnected:", socket.id, "User ID:", socket.userId);
        });
    });

    server.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
    }catch(err){
    console.error("Error starting server:", err);
    process.exit(1); 
}
}


startServer();