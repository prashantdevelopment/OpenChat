import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { CLIENT_URL } from "./config/env.js";
import errorMiddleware from "./middleware/error.middleware.js";
import healthRoutes from "./routes/health.routes.js";
import userRoutes from "./routes/user.routes.js";
import authRoutes from "./routes/auth.routes.js";
import conversationRoutes from "./routes/conversation.routes.js";
import messageRoutes from "./routes/message.routes.js";



const app = express();
app.use(cors({
    origin: CLIENT_URL,
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use("/api", healthRoutes);
app.use("/api", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", conversationRoutes);
app.use("/api", messageRoutes);

app.use(errorMiddleware);

export default app;