import mongoose from "mongoose";
import request from "supertest";
import app from "../src/app.js";

export const PASSWORD = "Secret@123";

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
        .send({ username, email: `${username}@test.dev`, password: PASSWORD })
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
