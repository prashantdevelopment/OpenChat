import dotenv from "dotenv";

dotenv.config();



const CLIENT_URL = process.env.CLIENT_URL;
if(!CLIENT_URL) {
    throw new Error("CLIENT_URL is not defined in the environment variables");
}

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

const MONGO_URI = process.env.MONGO_URI;
            if(!MONGO_URI) {
                throw new Error("MONGO_URI is not defined in the environment variables");
            }

const JWT_SECRET = process.env.JWT_SECRET;
            if(!JWT_SECRET) {
                throw new Error("JWT_SECRET is not defined in the environment variables");
            }
            // A short secret can be brute-forced, which lets anyone forge login tokens.
            if(JWT_SECRET.length < 32) {
                throw new Error("JWT_SECRET must be at least 32 characters long");
            }

export {
    PORT,
    MONGO_URI,
    JWT_SECRET,
    CLIENT_URL
};