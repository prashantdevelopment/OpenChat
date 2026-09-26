import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import User from "../src/models/user.model.js";
import { connectTestDb, disconnectTestDb, registerAndLogin } from "./helpers.js";

let me;
beforeAll(async () => {
    await connectTestDb();
    await User.createIndexes();
    me = await registerAndLogin("kerala_me");
    // 23 people in Kerala (more than one page), 2 elsewhere, 1 who opted out.
    const keralans = await Promise.all(Array.from({ length: 23 }, (_, i) => registerAndLogin(`kl_${String(i).padStart(2, "0")}`)));
    const others = await Promise.all(["goa_one", "goa_two"].map(registerAndLogin));
    const hidden = await registerAndLogin("kl_hidden");
    await User.updateMany({ _id: { $in: [me, ...keralans, hidden].map((u) => u.id) } }, { state: "kerala" });
    await User.updateMany({ _id: { $in: others.map((u) => u.id) } }, { state: "goa" });
    await request(app).patch("/api/users/me").set("Cookie", hidden.cookie).send({ discoverable: false });
});
afterAll(disconnectTestDb);

const discover = (query) => request(app).get("/api/users/discover").query(query).set("Cookie", me.cookie);

describe("Discover: people by state", () => {
    it("lists a state's people in username order, 20 per page", async () => {
        const first = await discover({ state: "kerala" });
        expect(first.status).toBe(200);
        expect(first.body.users).toHaveLength(20);
        expect(first.body.hasMore).toBe(true);
        expect(first.body.users.map((u) => u.username)).toEqual([...first.body.users.map((u) => u.username)].sort());

        const second = await discover({ state: "kerala", after: first.body.users.at(-1).username });
        expect(second.body.users.map((u) => u.username)).toEqual(["kl_20", "kl_21", "kl_22"]);
        expect(second.body.hasMore).toBe(false);
    });

    it("leaves out me and people who opted out (they can still be found by username)", async () => {
        const all = [...(await discover({ state: "kerala" })).body.users, ...(await discover({ state: "kerala", after: "kl_19" })).body.users];
        const names = all.map((u) => u.username);
        expect(names).not.toContain("kerala_me");
        expect(names).not.toContain("kl_hidden");
        const search = await request(app).get("/api/users/search").query({ q: "kl_hid" }).set("Cookie", me.cookie);
        expect(search.body.users.map((u) => u.username)).toEqual(["kl_hidden"]);
    });

    it("narrows by username prefix, safely", async () => {
        expect((await discover({ state: "kerala", q: "KL_1" })).body.users.map((u) => u.username)).toEqual(
            Array.from({ length: 10 }, (_, i) => `kl_1${i}`)
        );
        expect((await discover({ state: "kerala", q: ".*" })).body.users).toEqual([]); // not a regex
        expect((await discover({ state: "goa" })).body.users.map((u) => u.username)).toEqual(["goa_one", "goa_two"]);
    });

    it("shows only public profile fields, never online status or email", async () => {
        const [user] = (await discover({ state: "goa" })).body.users;
        expect(Object.keys(user).sort()).toEqual(["_id", "avatar", "bio", "publicKey", "state", "username"]);
    });

    it("rejects bad input and needs a login", async () => {
        expect((await discover({ state: "atlantis" })).status).toBe(400);
        expect((await discover({})).status).toBe(400);
        expect((await discover({ state: "kerala", q: "x".repeat(31) })).status).toBe(400);
        expect((await discover({ state: "kerala", after: "x".repeat(31) })).status).toBe(400);
        expect((await request(app).get("/api/users/discover").query({ state: "kerala" })).status).toBe(401);
    });

    it("the 'discoverable' setting is strictly true or false", async () => {
        const res = await request(app).patch("/api/users/me").set("Cookie", me.cookie).send({ discoverable: "no" });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe("discoverable must be true or false");
    });
});
