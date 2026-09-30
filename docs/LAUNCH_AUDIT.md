# Launch readiness audit — OpenChat (backend app, no payments)

Date: 2026-09-30 · Live: https://openchat-6cl5.onrender.com · Checklist: `.claude/checklists/launch-readiness.md` (34 items apply; 7.2 payments does not).

**Result: 34/34 pass** after 4 fixes made during the audit. 3 items need your decision (below).

## Fixed during the audit

| Item | What was wrong | Fix |
|---|---|---|
| 6.10 / 7.3 `npm audit` | 1 high: `engine.io` 6.6.0–6.6.9, "Protocol Revision Mismatch DoS" (GHSA-2gc4-cqfq-p2gv), inside socket.io | `npm audit fix`: engine.io 6.6.11 (lockfile only, no new package). Server and client: 0 vulnerabilities. |
| 3.4 Custom 404 | Unknown pages showed "Page not found" (noindex) but with status **200** ("soft 404") | `server/src/clientApp.js`: the app's pages answer 200, anything else gets the same page with **404** (`isAppPage`, tested in `server/tests/clientApp.test.js`). |
| 6.8 Debug logs | The server logged every connect/disconnect and every chat opened ("User joined conversation: <chat> User: <user>"): a record of who used which chat when, kept in the host's logs; the browser logged socket ids | Chat opens/closes are no longer logged at all; connect/disconnect only in development (the E2E suites read it), never in production; the browser logs nothing. Startup and error logs stay; codes are printed only in development without Brevo. |
| 7.1 Offline | Going offline showed nothing for up to ~45 s (the server's ping timeout), so a message could look like it was sending | The app drops its connection on the browser's `offline` event: "Not connected. Trying to reconnect..." at once, messages wait for Retry, it reconnects when the network is back. |

## Evidence per group

1. **Mobile & layout** — every page (landing, login, register, 404, chat list, a chat, settings, discover, profile) at 360 / 390 / 414 / 768 / 1024 / 1440px: no sideways scroll, nothing past the edge; inputs ≥ 16px on phones (no iPhone zoom); viewport allows zoom (`e2e-audit`, 110 checks). No hamburger menu: the app bar has icon buttons with labels (`e2e-a11y`).
2. **Links & navigation** — `linkinator` on the production build: 13/13 static links 200; every link rendered on the public pages loads, no `href="#"`, new-tab links have `noopener`; the logo links home with a name. 2.5/2.6: OpenChat shows no phone number or email address, nothing to link.
3. **SEO & identity** — favicon.ico/svg, apple-touch-icon, manifest 192/512/maskable; each public page has its own title and a 50–170 character description, Open Graph image (174 KB), canonical, sitemap and robots on the live address; 404 status (fixed); the year is `new Date().getFullYear()`. Lighthouse (live, mobile): SEO 100, Accessibility 100.
4. **Content** — no lorem/TODO/example.com/placeholder images in the code; test users exist only in the test databases (`openchat_test`, `openchat_e2e_test`); biggest image 174 KB; shared photos are redrawn on a canvas (EXIF with camera and location dropped).
5. **Feedback** — loading, empty, error and retry states (`e2e-states`, `e2e-composer`, `e2e-scroll`, `e2e-reconnect`), field errors next to the field (`e2e-register`, `e2e-settings`), toasts for results; double-clicking Send on Slow 3G sends one message (`e2e-audit`).
6. **Security** — no secret value from `server/.env` in the browser build or anywhere in the git history (scanned by value, names only printed); `.env` ignored, `.env.example` present; every API and socket event checks the session and membership on the server, outsiders get 403/404 (server tests for every feature, two users + an outsider); manual validation with size limits on every input; rate limits on login, sign-up, email codes, invites, uploads, pushes, socket events; uploads: encrypted in the browser, 10 MB limit, random ids, members only (type can't be checked on ciphertext, so the browser checks it before encrypting); errors: generic messages, no stack traces (bad JSON → 400, 2 MB body → 413, NoSQL operators → 400); live headers: HSTS, CSP (no inline scripts except two hashed), nosniff, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, COOP/CORP.
7. **Resilience** — Slow 3G: the chat opens with its loading states and works; offline banner (fixed) and recovery. Full regression: lint, 79 client + 512 server tests, production build, 67/67 E2E suites (the new `e2e-audit` included; `e2e-prod` now expects the real 404; `e2e-mute` split one check that raced a closing dialog).

## Needs your decision

1. **MongoDB Atlas (6.4):** can't be seen from the code. Check that the app's database user has only "readWrite" on the OpenChat database (not Atlas admin), that Network Access lists Render's outbound IPs instead of `0.0.0.0/0` if you want it tighter, and that backups are on (the free tier has no automatic backups: export now and then).
2. **Performance 78 (Lighthouse, mobile, landing page):** largest paint 3.2 s, blocking time 0.5 s on a throttled phone. Accessibility/SEO are 100. Making the landing lighter (loading the motion code after the first paint) is a separate piece of work.
3. **Best practices 96:** the only point lost is a 401 in the console for logged-out visitors (the app asks whether a session exists). Harmless; removing it means changing that endpoint to answer 200 with "no user".

## Tools run

`npm audit --omit=dev` (server, client), a value-based secret scan of the build and git history, `linkinator`, Lighthouse 12 (live, mobile), Playwright sweeps (`e2e-audit`), the full regression (lint, client + server tests, production build, all E2E suites), manual abuse requests against the production build. Viewports 360–1440px, Slow 3G, offline.
