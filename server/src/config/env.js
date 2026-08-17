import dotenv from "dotenv";

dotenv.config();

const rawPort = process.env.PORT;
const PORT = Number(rawPort);
    if(!rawPort) {
        throw new Error("PORT is not defined in the environment variables");
    }
     if (!Number.isInteger(PORT)) {
            throw new Error("PORT must be an integer");
        }
            if(PORT < 1 || PORT > 65535) {
                throw new Error("PORT must be a valid port number (1-65535)");
            }

export {
    PORT
};