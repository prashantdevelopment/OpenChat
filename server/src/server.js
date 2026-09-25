import app from "./app.js";
import { PORT } from "./config/env.js";
import { createServer } from "http";
import connectDatabase from "./config/database.js";
import createSocketServer from "./socket.js";

const startServer = async () => {

    try{
    await connectDatabase();

    const server = createServer(app);
    createSocketServer(server);

    server.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
    }catch(err){
    console.error("Error starting server:", err);
    process.exit(1);
}
}


startServer();
