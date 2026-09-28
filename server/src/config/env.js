import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();



// The app's address (CORS, sockets). On Render it defaults to the service's
// own address, since the same server serves the app.
const CLIENT_URL = process.env.CLIENT_URL ?? process.env.RENDER_EXTERNAL_URL;
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
            // Hosts like Render's free plan wipe the disk on every restart:
            // files kept there would vanish. Production uses Cloudinary, unless
            // a (persistent) folder is given on purpose.
            if (STORAGE_DRIVER === "local" && process.env.NODE_ENV === "production" && !process.env.UPLOADS_DIR) {
                throw new Error("In production, set STORAGE_DRIVER=cloudinary (or UPLOADS_DIR to a persistent disk)");
            }

const CLOUDINARY = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    folder: process.env.CLOUDINARY_FOLDER ?? "openchat",
};
            if (STORAGE_DRIVER === "cloudinary" && (!CLOUDINARY.cloudName || !CLOUDINARY.apiKey || !CLOUDINARY.apiSecret)) {
                throw new Error("STORAGE_DRIVER=cloudinary needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET");
            }

// How many proxies (e.g. the host's load balancer) sit in front of the server.
// Rate limits count per client IP address, which Express can only see behind
// a proxy if it is told to trust it. 0 = none (development). Never higher
// than the real number: the client could then fake its address.
const TRUST_PROXY = Number(process.env.TRUST_PROXY ?? 0);
            if (!Number.isInteger(TRUST_PROXY) || TRUST_PROXY < 0) {
                throw new Error("TRUST_PROXY must be a whole number (the number of proxies in front of the server)");
            }

// Rate limits (src/rateLimit.js): "on", or "off" for the test suites, which
// send far more requests than any person could. Never off in production.
const RATE_LIMITS = process.env.RATE_LIMITS ?? "on";
            if (!["on", "off"].includes(RATE_LIMITS)) {
                throw new Error(`RATE_LIMITS must be "on" or "off", not "${RATE_LIMITS}"`);
            }
            if (RATE_LIMITS === "off" && process.env.NODE_ENV === "production") {
                throw new Error("RATE_LIMITS can't be off in production");
            }

// Cloudflare Realtime TURN (relays calls the two browsers can't connect
// directly): a TURN key's id and API token, from the Cloudflare dashboard.
// Optional: without them calls use STUN only. Both or neither.
const TURN = process.env.CLOUDFLARE_TURN_KEY_ID || process.env.CLOUDFLARE_TURN_KEY_API_TOKEN
    ? { keyId: process.env.CLOUDFLARE_TURN_KEY_ID, apiToken: process.env.CLOUDFLARE_TURN_KEY_API_TOKEN }
    : null;
            if (TURN && (!TURN.keyId || !TURN.apiToken)) {
                throw new Error("Cloudflare TURN needs both CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_KEY_API_TOKEN");
            }
            if (TURN && !/^[A-Za-z0-9_-]+$/.test(TURN.keyId)) {
                throw new Error("CLOUDFLARE_TURN_KEY_ID looks wrong (letters, digits, - and _ only)");
            }

// Sign in with Google (OAuth 2.0 / OpenID Connect): the OAuth client's id and
// secret from Google Cloud. Optional: without them the button isn't shown.
// Both or neither. Google sends people back to GOOGLE_REDIRECT_URI, which must
// be listed on the OAuth client exactly: by default /api/auth/google/callback
// on the site (production, where the server serves the app) or on this server.
const GOOGLE = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_SECRET
    ? {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI
            ?? (process.env.NODE_ENV === "production" ? `${CLIENT_URL}/api/auth/google/callback` : `http://localhost:${PORT}/api/auth/google/callback`),
        // Only the browser tests point these at a stand-in for Google.
        authUrl: process.env.GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token",
    }
    : null;
            if (GOOGLE && (!GOOGLE.clientId || !GOOGLE.clientSecret)) {
                throw new Error("Sign in with Google needs both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
            }
            if (GOOGLE && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(GOOGLE.clientId)) {
                throw new Error("GOOGLE_CLIENT_ID looks wrong (it ends in .apps.googleusercontent.com)");
            }
            if ((process.env.GOOGLE_AUTH_URL || process.env.GOOGLE_TOKEN_URL) && process.env.NODE_ENV === "production") {
                throw new Error("GOOGLE_AUTH_URL / GOOGLE_TOKEN_URL are for tests only, never in production");
            }

export {
    GOOGLE,
    TURN,
    TRUST_PROXY,
    RATE_LIMITS,
    STORAGE_DRIVER,
    CLOUDINARY,
    UPLOADS_DIR,
    PORT,
    MONGO_URI,
    JWT_SECRET,
    CLIENT_URL
};