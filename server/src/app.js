import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { CLIENT_URL, TRUST_PROXY } from "./config/env.js";
import { byIp, rateLimit } from "./rateLimit.js";
import errorMiddleware from "./middleware/error.middleware.js";
import AppError from "./utils/AppError.js";
import healthRoutes from "./routes/health.routes.js";
import userRoutes from "./routes/user.routes.js";
import authRoutes from "./routes/auth.routes.js";
import pushRoutes from "./routes/push.routes.js";
import conversationRoutes from "./routes/conversation.routes.js";
import messageRoutes from "./routes/message.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import presenceRoutes from "./routes/presence.routes.js";
import blockRoutes from "./routes/block.routes.js";
import callRoutes from "./routes/call.routes.js";
import groupRoutes from "./routes/group.routes.js";
import { createClientApp } from "./clientApp.js";



const app = express();
// req.ip is the client's address even behind the host's proxy (rate limits).
app.set("trust proxy", TRUST_PROXY);
// Security headers on every response (no MIME sniffing, no framing, HSTS,
// no X-Powered-By, a strict CSP for anything the API itself returns...).
// Resources may be used by the app on the same site only: profile photos are
// shown from the app's pages (cookies are SameSite=Strict anyway, so the app
// and the API have to share a site).
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
// A ceiling for every API request per IP address: far above normal use
// (a chat with many photos), low enough to stop a script hammering the server.
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 600, keys: byIp("api"), message: "Too many requests" }));
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
app.use("/api", pushRoutes);
app.use("/api", conversationRoutes);
app.use("/api", messageRoutes);
app.use("/api", uploadRoutes);
app.use("/api", presenceRoutes);
app.use("/api", blockRoutes);
app.use("/api", callRoutes);
app.use("/api", groupRoutes);

// Production: the built React app for every other path (clientApp.js).
if (process.env.NODE_ENV === "production") {
    const clientApp = createClientApp();
    if (clientApp) app.use(clientApp);
    else console.warn("No client build found (client/dist): run `npm run build` first. Serving the API only.");
}

app.use(() => {
    throw new AppError("Route not found", 404);
});
app.use(errorMiddleware);

export default app;