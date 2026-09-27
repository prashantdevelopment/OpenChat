import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

// The production settings env.js enforces (plan step 53). Each case loads
// env.js in a fresh Node process with exactly the given variables (no .env).
const ENV_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "config", "env.js");
const BASE = { PORT: "5000", MONGO_URI: "mongodb://localhost:27017/x", JWT_SECRET: "x".repeat(40), PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };

const load = (env) => {
    const script = `const env = await import(${JSON.stringify("file://" + ENV_JS.replaceAll("\\", "/"))}); console.log(JSON.stringify({ CLIENT_URL: env.CLIENT_URL, STORAGE_DRIVER: env.STORAGE_DRIVER }));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...BASE, ...env }, cwd: path.dirname(ENV_JS), encoding: "utf8" });
    return result.status === 0 ? { ok: JSON.parse(result.stdout.trim().split("\n").at(-1)) } : { error: result.stderr };
};

describe("production settings (env.js)", () => {
    it("on Render, the app's address defaults to the service's own (RENDER_EXTERNAL_URL)", () => {
        expect(load({ RENDER_EXTERNAL_URL: "https://openchat.onrender.com" }).ok.CLIENT_URL).toBe("https://openchat.onrender.com");
        expect(load({ CLIENT_URL: "http://localhost:5173", RENDER_EXTERNAL_URL: "https://x.onrender.com" }).ok.CLIENT_URL).toBe("http://localhost:5173");
        expect(load({}).error).toMatch(/CLIENT_URL is not defined/);
    });

    it("production refuses local file storage without a persistent folder (Render's disk is wiped)", () => {
        const prod = { NODE_ENV: "production", CLIENT_URL: "https://a.example" };
        expect(load({ ...prod }).error).toMatch(/set STORAGE_DRIVER=cloudinary/);
        expect(load({ ...prod, UPLOADS_DIR: "/var/data/uploads" }).ok.STORAGE_DRIVER).toBe("local");
        expect(load({ ...prod, STORAGE_DRIVER: "cloudinary", CLOUDINARY_CLOUD_NAME: "c", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" }).ok.STORAGE_DRIVER).toBe("cloudinary");
        expect(load({ CLIENT_URL: "http://localhost:5173" }).ok.STORAGE_DRIVER).toBe("local"); // development: fine
    });

    it("production refuses RATE_LIMITS=off", () => {
        expect(load({ NODE_ENV: "production", CLIENT_URL: "https://a.example", STORAGE_DRIVER: "cloudinary", CLOUDINARY_CLOUD_NAME: "c", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s", RATE_LIMITS: "off" }).error)
            .toMatch(/can't be off in production/);
    });
});
