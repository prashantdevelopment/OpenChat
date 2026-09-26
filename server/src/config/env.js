import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

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

// Where uploaded (encrypted) files are kept: "local" (server/uploads by
// default, git-ignored) or "cloudinary" (needs the three CLOUDINARY_* values).
const STORAGE_DRIVER = process.env.STORAGE_DRIVER ?? "local";
            if (!["local", "cloudinary"].includes(STORAGE_DRIVER)) {
                throw new Error(`STORAGE_DRIVER must be "local" or "cloudinary", not "${STORAGE_DRIVER}"`);
            }
const UPLOADS_DIR = process.env.UPLOADS_DIR
    ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "uploads");

const CLOUDINARY = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    folder: process.env.CLOUDINARY_FOLDER ?? "openchat",
};
            if (STORAGE_DRIVER === "cloudinary" && (!CLOUDINARY.cloudName || !CLOUDINARY.apiKey || !CLOUDINARY.apiSecret)) {
                throw new Error("STORAGE_DRIVER=cloudinary needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET");
            }

export {
    STORAGE_DRIVER,
    CLOUDINARY,
    UPLOADS_DIR,
    PORT,
    MONGO_URI,
    JWT_SECRET,
    CLIENT_URL
};