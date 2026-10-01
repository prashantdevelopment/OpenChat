import mongoose from "mongoose";
import app from "./app.js";
import { PORT } from "./config/env.js";
import { createServer } from "http";
import connectDatabase from "./config/database.js";
import createSocketServer from "./socket.js";
import { removeOrphanUploads } from "./services/upload.service.js";
import { createShutdown, handleProcessErrors } from "./lifecycle.js";

// Uploads no message uses after a day (a send that failed halfway) are
// removed: checked at start and then every hour.
const ORPHAN_CHECK_MS = 60 * 60 * 1000;
const removeUnusedUploads = () => removeOrphanUploads().catch((err) => console.error("Upload clean-up:", err.message));

const startServer = async () => {
    try {
        await connectDatabase();

        const server = createServer(app);
        const io = createSocketServer(server);
        // A clean stop on every deploy, and the last safety net (lifecycle.js).
        handleProcessErrors({ shutdown: createShutdown({ httpServer: server, io, closeDatabase: () => mongoose.disconnect() }) });
        removeUnusedUploads();
        setInterval(removeUnusedUploads, ORPHAN_CHECK_MS).unref();

        server.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    } catch (err) {
        console.error("Error starting server:", err);
        process.exit(1);
    }
};

startServer();
