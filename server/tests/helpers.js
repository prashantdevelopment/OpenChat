import mongoose from "mongoose";
import request from "supertest";
import { generateKeyPairSync, randomBytes } from "crypto";
import app from "../src/app.js";

export const PASSWORD = "Secret@123";

// Encryption keys for test users. The browser normally creates these; the
// server only checks their shape, so one real P-256 public key and a random
// "locked" blob of the right size are enough (shared by all test users).
const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
export const TEST_KEYS = {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    encryptedPrivateKey: {
        data: randomBytes(154).toString("base64"),
        iv: randomBytes(12).toString("base64"),
        salt: randomBytes(16).toString("base64"),
        iterations: 600_000,
    },
};

// Stand-in for an end-to-end encrypted message. The server can't read real
// ciphertext either, so in server tests the "ciphertext" is the text's bytes
// followed by a fake 16-byte AES-GCM tag; readText() turns it back for asserts.
export const encrypted = (text) => ({
    ciphertext: Buffer.concat([Buffer.from(text), Buffer.alloc(16)]).toString("base64"),
    iv: randomBytes(12).toString("base64"),
});
export const readText = ({ ciphertext }) => {
    const bytes = Buffer.from(ciphertext, "base64");
    return bytes.subarray(0, bytes.length - 16).toString();
};

// Fresh, empty test database for each test file.
export const connectTestDb = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    await mongoose.connection.dropDatabase();
};

export const disconnectTestDb = async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
};

// Registers a user through the real API and logs in.
// Returns the user's id and the auth cookie to send with later requests.
export const registerAndLogin = async (username) => {
    await request(app)
        .post("/api/users")
        .send({ username, email: `${username}@test.dev`, password: PASSWORD, state: "delhi", ...TEST_KEYS })
        .expect(201);

    const res = await request(app)
        .post("/api/auth/login")
        .send({ identifier: username, password: PASSWORD })
        .expect(200);

    return {
        id: res.body.user._id,
        cookie: res.headers["set-cookie"][0].split(";")[0],
    };
};
