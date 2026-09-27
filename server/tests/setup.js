import dotenv from "dotenv";
import os from "os";
import path from "path";

// Runs before every test file, before the app is imported.
// Point MONGO_URI at a separate "openchat_test" database on the same MongoDB
// server, so tests (which drop their database) never touch development data.
// dotenv does not override variables that are already set, so env.js keeps this value.
dotenv.config({ quiet: true });

const url = new URL(process.env.MONGO_URI);
url.pathname = "/openchat_test";
process.env.MONGO_URI = url.toString();

if (!new URL(process.env.MONGO_URI).pathname.endsWith("_test")) {
    throw new Error("Refusing to run tests against a non-test database");
}

// Uploaded files go to a temporary folder on disk: never into server/uploads,
// never to Cloudinary (even if server/.env says STORAGE_DRIVER=cloudinary).
process.env.STORAGE_DRIVER = "local";
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `openchat-test-uploads-${process.pid}`);
// Test suites send far more requests than a person could: rate limits off
// (read on every request). tests/security.test.js switches them on for itself.
process.env.RATE_LIMITS = "off";
// Never the real Cloudflare TURN key from server/.env: tests don't call
// outside services. Empty (not deleted), so env.js's dotenv won't load it
// again. tests/iceServers.test.js sets a fake key for itself.
process.env.CLOUDFLARE_TURN_KEY_ID = "";
process.env.CLOUDFLARE_TURN_KEY_API_TOKEN = "";
