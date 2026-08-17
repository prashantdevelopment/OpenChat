import app from "./app.js";

import { createServer } from "http";


const server = createServer(app);


server.listen(3000, () => {
    console.log("Server is running on port 3000");
})


