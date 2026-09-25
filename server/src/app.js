import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { CLIENT_URL } from "./config/env.js";
import errorMiddleware from "./middleware/error.middleware.js";
import AppError from "./utils/AppError.js";
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
// Express 5 leaves req.body undefined when a request has no JSON body;
// default it so controllers can always destructure it safely.
app.use((req, res, next) => {
    req.body ??= {};
    next();
});
app.use(cookieParser());
app.use("/api", healthRoutes);
app.use("/api", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", conversationRoutes);
app.use("/api", messageRoutes);

app.use(() => {
    throw new AppError("Route not found", 404);
});
app.use(errorMiddleware);

export default app;