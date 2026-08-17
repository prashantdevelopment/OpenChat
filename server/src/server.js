import app from "./app.js";
import { PORT } from "./config/env.js";
import { createServer } from "http";





const server = createServer(app);


server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})


