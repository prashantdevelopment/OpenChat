import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import User from "../src/models/user.model.js";
import storage from "../src/storage/index.js";
import { connectTestDb, disconnectTestDb, registerAndLogin } from "./helpers.js";

let asha, ravi;
beforeAll(async () => {
    await connectTestDb();
    [asha, ravi] = await Promise.all(["asha_av", "ravi_av"].map(registerAndLogin));
});
afterAll(disconnectTestDb);

// Real file headers ("magic numbers") followed by filler bytes.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500, 2)]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(300, 3)]);

const putAvatar = (user, bytes, type = "image/jpeg") =>
    request(app).put("/api/users/me/avatar").set("Cookie", user.cookie).set("Content-Type", type).send(bytes);
const putLarge = (user, id, bytes, type = "image/jpeg") =>
    request(app).put(`/api/users/me/avatar/${id}/large`).set("Cookie", user.cookie).set("Content-Type", type).send(bytes);
const getAvatar = (id, suffix = "") => request(app).get(`/api/avatars/${id}${suffix}`).buffer(true).parse((res, done) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => done(null, Buffer.concat(chunks)));
});

describe("profile photos", () => {
    it("uploads a JPEG and serves it publicly, as an image only", async () => {
        const res = await putAvatar(asha, jpeg);
        expect(res.status).toBe(200);
        expect(res.body.avatar).toMatch(/^[a-f0-9]{32}$/);

        const photo = await getAvatar(res.body.avatar); // no login needed
        expect(photo.status).toBe(200);
        expect(Buffer.compare(photo.body, jpeg)).toBe(0);
        expect(photo.headers["content-type"]).toBe("image/jpeg");
        expect(photo.headers["x-content-type-options"]).toBe("nosniff");
        expect(photo.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
        expect(photo.headers["cache-control"]).toMatch(/immutable/);
    });

    it("takes the type from the bytes: PNG and WebP too", async () => {
        const fromPng = await putAvatar(asha, png, "image/png");
        expect((await getAvatar(fromPng.body.avatar)).headers["content-type"]).toBe("image/png");
        const fromWebp = await putAvatar(asha, webp, "image/webp");
        expect((await getAvatar(fromWebp.body.avatar)).headers["content-type"]).toBe("image/webp");
    });

    it("refuses anything that isn't really a JPEG, PNG or WebP", async () => {
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
        const html = Buffer.from("<html><script>alert(1)</script></html>");
        const gif = Buffer.from("GIF89a" + "x".repeat(100));
        for (const bytes of [svg, html, gif]) {
            const res = await putAvatar(asha, bytes, "image/jpeg"); // lying about the type
            expect(res.status).toBe(400);
            expect(res.body.message).toBe("The photo must be a JPEG, PNG or WebP image");
        }
        expect((await putAvatar(asha, svg, "image/svg+xml")).status).toBe(400); // not even read
        expect((await putAvatar(asha, Buffer.concat([jpeg, Buffer.alloc(512 * 1024)]))).status).toBe(413);
    });

    it("a new photo replaces the old one, which is gone", async () => {
        const first = (await putAvatar(asha, jpeg)).body.avatar;
        const second = (await putAvatar(asha, png, "image/png")).body.avatar;
        expect(second).not.toBe(first);
        expect((await getAvatar(first)).status).toBe(404);
        expect((await getAvatar(second)).status).toBe(200);
    });

    it("removing the photo", async () => {
        const id = (await putAvatar(asha, jpeg)).body.avatar;
        const res = await request(app).delete("/api/users/me/avatar").set("Cookie", asha.cookie);
        expect(res.body.avatar).toBe("");
        expect((await User.findById(asha.id)).avatar).toBe("");
        expect((await getAvatar(id)).status).toBe(404);
    });

    it("other users see the photo's id with the public profile", async () => {
        const id = (await putAvatar(ravi, jpeg)).body.avatar;
        const res = await request(app).get("/api/users/search").query({ q: "ravi_av" }).set("Cookie", asha.cookie);
        expect(res.body.users[0].avatar).toBe(id);
    });

    it("a photo missing from storage is a 404, not a server error", async () => {
        await User.updateOne({ _id: ravi.id }, { avatar: "f".repeat(32) });
        expect((await getAvatar("f".repeat(32))).status).toBe(404);
    });

    it("needs a login to change, rejects unknown ids, and can't be set to a URL", async () => {
        expect((await request(app).put("/api/users/me/avatar").set("Content-Type", "image/jpeg").send(jpeg)).status).toBe(401);
        for (const bad of ["0".repeat(32), "..%2F..%2Fpackage.json", "not-an-id"]) {
            expect((await getAvatar(bad)).status).toBe(404);
        }
        await request(app).patch("/api/users/me").set("Cookie", asha.cookie).send({ bio: "x", avatar: "https://tracker.example/p.png" });
        expect((await User.findById(asha.id)).avatar).toBe("");
    });
});

describe("the large copy (viewing a photo full size)", () => {
    const large = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900_000, 7)]);

    it("sent right after the photo, with its id: served at /large, the small one unchanged", async () => {
        const { avatar } = (await putAvatar(asha, jpeg)).body;
        expect((await putLarge(asha, avatar, large)).status).toBe(200);
        const big = await getAvatar(avatar, "/large");
        expect(big.status).toBe(200);
        expect(Buffer.compare(big.body, large)).toBe(0);
        expect(big.headers["content-type"]).toBe("image/jpeg");
        expect(big.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
        expect(Buffer.compare((await getAvatar(avatar)).body, jpeg)).toBe(0);
    });

    it("a photo without one (older photos): /large gives the photo itself", async () => {
        const { avatar } = (await putAvatar(asha, png, "image/png")).body;
        const big = await getAvatar(avatar, "/large");
        expect(big.status).toBe(200);
        expect(Buffer.compare(big.body, png)).toBe(0);
    });

    it("only for my current photo: not someone else's, not an old one, not a made-up id", async () => {
        const { avatar: ashas } = (await putAvatar(asha, jpeg)).body;
        expect((await putLarge(ravi, ashas, large)).status).toBe(404);
        const { avatar: newer } = (await putAvatar(asha, png, "image/png")).body;
        expect((await putLarge(asha, ashas, large)).status).toBe(404); // replaced already
        expect((await putLarge(asha, "f".repeat(32), large)).status).toBe(404);
        expect((await putLarge(asha, "nope", large)).status).toBe(404);
        expect((await request(app).put(`/api/users/me/avatar/${newer}/large`).set("Content-Type", "image/jpeg").send(jpeg)).status).toBe(401);
    });

    it("must really be an image, at most 2 MB", async () => {
        const { avatar } = (await putAvatar(asha, jpeg)).body;
        expect((await putLarge(asha, avatar, Buffer.from("<svg onload=alert(1)>"), "image/jpeg")).status).toBe(400);
        expect((await putLarge(asha, avatar, Buffer.concat([jpeg, Buffer.alloc(2 * 1024 * 1024)]))).status).toBe(413);
    });

    it("a new photo or removing it takes the large copy away too", async () => {
        const { avatar: first } = (await putAvatar(asha, jpeg)).body;
        await putLarge(asha, first, large).expect(200);
        await putAvatar(asha, png, "image/png").expect(200);
        expect((await getAvatar(first, "/large")).status).toBe(404);
        await expect(storage.read(`${first}-large`)).rejects.toThrow(); // gone from storage, not just hidden
        const { avatar: second } = (await putAvatar(asha, jpeg)).body;
        await putLarge(asha, second, large).expect(200);
        await request(app).delete("/api/users/me/avatar").set("Cookie", asha.cookie).expect(200);
        expect((await getAvatar(second, "/large")).status).toBe(404);
        await expect(storage.read(`${second}-large`)).rejects.toThrow();
    });
});
