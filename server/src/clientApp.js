import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import helmet from "helmet";

// In production one server does everything (one site, so the SameSite=Strict
// cookie and the socket just work): the API under /api, and the React app
// built by `npm run build` (client/dist) for every other path.
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "client", "dist");

// SHA-256 of each inline <script> in a page, for the CSP: the theme script in
// index.html and the retry script in offline.html. Read from the built files
// at start, so the policy always matches them. Browsers hash the script as
// parsed, and the HTML parser turns CRLF line ends into LF: so do we.
const inlineScriptHashes = (file) => {
    const html = readFileSync(path.join(DIST, file), "utf8").replace(/\r\n?/g, "\n");
    return [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)]
        .map(([, body]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`);
};

// The router serving the app, or null when there is no build (development:
// Vite serves the app itself).
// The app's pages (keep in step with client/src/App.jsx). Anything else still
// gets the app, which shows "Page not found", but with a real 404 status, so
// search engines don't count it as a page.
const APP_PAGES = [/^\/$/, /^\/(login|register|register\/google|discover|settings)\/?$/, /^\/chat(\/[0-9a-f]{24})?\/?$/, /^\/u\/[^/]+\/?$/];
export const isAppPage = (pathname) => APP_PAGES.some((pattern) => pattern.test(pathname));

export const createClientApp = () => {
    if (!existsSync(path.join(DIST, "index.html"))) return null;
    const scriptHashes = [...new Set(["index.html", "offline.html"].flatMap(inlineScriptHashes))];
    const router = express.Router();

    // The page's own rules on top of the API's headers (app.js): everything
    // comes from this server; decrypted photos, videos and voice notes are
    // blob: URLs; the socket is same-origin (wss:). The only inline scripts
    // allowed are the two known ones (by hash): an injected script can't run
    // and use the unlocked key.
    router.use(helmet.contentSecurityPolicy({
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", ...scriptHashes],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            mediaSrc: ["'self'", "blob:"],
            fontSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            workerSrc: ["'self'"],
            manifestSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: null, // HSTS already keeps browsers on https
        },
    }));

    // Built files: /assets/* have their content hash in the name, so they can
    // be cached for a year; everything else (index.html, sw.js, the manifest)
    // must be checked on every visit, or an update would never arrive.
    router.use(express.static(DIST, {
        index: false,
        setHeaders: (res, filePath) => {
            const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
            res.set("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
        },
    }));

    // Any other page (/chat/..., /u/..., unknown ones): the app decides what
    // to show, including its own "Page not found" (marked noindex).
    router.get(/^(?!\/api(\/|$)).*/, (req, res) => {
        res.set("Cache-Control", "no-cache");
        res.status(isAppPage(req.path) ? 200 : 404).sendFile(path.join(DIST, "index.html"));
    });
    return router;
};
