import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

// The production settings env.js enforces (plan step 53). Each case loads
// env.js in a fresh Node process with exactly the given variables (no .env).
const ENV_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "config", "env.js");
const BASE = { PORT: "5000", MONGO_URI: "mongodb://localhost:27017/x", JWT_SECRET: "x".repeat(40), PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };

const load = (env) => {
    const script = `const env = await import(${JSON.stringify("file://" + ENV_JS.replaceAll("\\", "/"))}); console.log(JSON.stringify({ CLIENT_URL: env.CLIENT_URL, STORAGE_DRIVER: env.STORAGE_DRIVER, GOOGLE: env.GOOGLE, EMAIL: env.EMAIL, PUSH: env.PUSH }));`;
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

    it("Sign in with Google: both values or neither, a real-looking client id, test stand-ins never in production", () => {
        const dev = { CLIENT_URL: "http://localhost:5173" };
        const id = "123-abc.apps.googleusercontent.com";
        expect(load(dev).ok.GOOGLE).toBeNull();
        expect(load({ ...dev, GOOGLE_CLIENT_ID: id }).error).toMatch(/needs both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
        expect(load({ ...dev, GOOGLE_CLIENT_ID: "not-a-client-id", GOOGLE_CLIENT_SECRET: "s" }).error).toMatch(/GOOGLE_CLIENT_ID looks wrong/);
        expect(load({ ...dev, GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: "s" }).ok.GOOGLE.redirectUri).toBe("http://localhost:5000/api/auth/google/callback");
        const prod = { NODE_ENV: "production", RENDER_EXTERNAL_URL: "https://openchat.onrender.com", STORAGE_DRIVER: "cloudinary", CLOUDINARY_CLOUD_NAME: "c", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s", GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: "s" };
        expect(load(prod).ok.GOOGLE.redirectUri).toBe("https://openchat.onrender.com/api/auth/google/callback");
        expect(load({ ...prod, GOOGLE_TOKEN_URL: "http://localhost:9/token" }).error).toMatch(/tests only, never in production/);
    });

    it("email codes: Brevo key and sender together, a real sender address, never switched off in production", () => {
        const dev = { CLIENT_URL: "http://localhost:5173" };
        expect(load(dev).ok.EMAIL).toBeNull();
        expect(load({ ...dev, BREVO_API_KEY: "k" }).error).toMatch(/need both BREVO_API_KEY and EMAIL_FROM/);
        expect(load({ ...dev, BREVO_API_KEY: "k", EMAIL_FROM: "not an address" }).error).toMatch(/EMAIL_FROM must be an email address/);
        expect(load({ ...dev, BREVO_API_KEY: "k", EMAIL_FROM: "me@gmail.com" }).ok.EMAIL).toMatchObject({ from: "me@gmail.com", fromName: "OpenChat" });
        const prod = { NODE_ENV: "production", CLIENT_URL: "https://a.example", STORAGE_DRIVER: "cloudinary", CLOUDINARY_CLOUD_NAME: "c", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" };
        expect(load({ ...prod, EMAIL_VERIFICATION: "off" }).error).toMatch(/can't be off in production/);
    });

    it("Web Push: both VAPID keys or neither, in the right shape, a mailto/https subject, no test origin in production", () => {
        const dev = { CLIENT_URL: "http://localhost:5173" };
        const pub = "B" + "a".repeat(86), priv = "c".repeat(43);
        expect(load(dev).ok.PUSH).toBeNull();
        expect(load({ ...dev, VAPID_PUBLIC_KEY: pub }).error).toMatch(/needs both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY/);
        expect(load({ ...dev, VAPID_PUBLIC_KEY: "short", VAPID_PRIVATE_KEY: priv }).error).toMatch(/look wrong/);
        expect(load({ ...dev, VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: "someone" }).error).toMatch(/mailto: or https/);
        expect(load({ ...dev, VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv }).ok.PUSH.subject).toBe("mailto:push@openchat.invalid");
        expect(load({ ...dev, VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, BREVO_API_KEY: "k", EMAIL_FROM: "me@gmail.com" }).ok.PUSH.subject).toBe("mailto:me@gmail.com");
        const prod = { NODE_ENV: "production", CLIENT_URL: "https://a.example", STORAGE_DRIVER: "cloudinary", CLOUDINARY_CLOUD_NAME: "c", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" };
        expect(load({ ...prod, VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv }).ok.PUSH.subject).toBe("https://a.example");
        expect(load({ ...prod, PUSH_TEST_ORIGIN: "https://localhost:9" }).error).toMatch(/tests only/);
    });
});
