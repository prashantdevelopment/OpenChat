import dotenv from "dotenv";

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
