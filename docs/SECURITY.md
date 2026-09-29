# OpenChat security review

**Date:** 2026-09-27 (plan step 51) · **Scope:** server (Express 5, Socket.IO, Mongoose), client (React), the end-to-end encryption, dependencies · **Method:** OWASP Top 10:2025 and ASVS 5.0 (L1, parts of L2), code read end to end, plus the automated test suites (server: Vitest; browser: Playwright, incl. mutation checks).

## 1. What OpenChat protects, and from whom

| Asset | Protected against | How |
|---|---|---|
| Message text, photos, videos, voice notes, files, call audio/video | The server, its database and file store, anyone who steals them | End-to-end encryption in the browser (section 3). The server stores only ciphertext. |
| The private key | The server; a stolen database | Locked with the password (PBKDF2, 600,000 rounds); the unlocked key is non-extractable. |
| Accounts | Password guessing, stolen sessions | bcrypt, rate limits, database-backed sessions (60 idle days, a year at most) that can be ended from any device. |
| Who is online | Strangers | Presence only to people you chat with; state counts under 5 are hidden. |

**Not protected (by design, stated honestly):**
- **Metadata** the server needs to route messages: who talks to whom, when, message sizes and kinds (text / photo / call), call times, IP addresses.
- **A malicious server handing out a fake public key** on first contact. The safety number is the check; key change detection (below) catches a swap after first contact.
- **A compromised device** (malware, a malicious browser extension, an XSS bug in OpenChat): it can use the unlocked key while the app is open.

## 2. Findings

Severity is by exploitability in this app, not by pattern.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `qs` (via Express) had two advisories (array-limit bypass, DoS) | Moderate | **Fixed**: `npm audit fix`, qs 6.16.0; `npm audit`: 0 vulnerabilities |
| 2 | A changed public key went unnoticed: a server swapping someone's key after first contact could read new messages and join calls (man in the middle), unless both compared safety numbers | Medium | **Fixed**: key change detection (`client/src/crypto/keyPins.js`). The first key seen per person is remembered on the device; a different key blocks the chat's composer and calls until the user compares the safety number and trusts it. An incoming call with a changed key ends while it rings. OpenChat keys never change legitimately (a password change keeps the key). |
| 3 | Changing the password left other logged-in devices logged in (up to an hour) | Medium | **Fixed**: `endOtherSessions` (`server/src/session.js`): every other session of the user ends and its sockets close; the current one stays. |
| 4 | The WebSocket handshake had no Origin check (Socket.IO's CORS only covers polling) | Low (the SameSite=Strict cookie already stops other sites) | **Fixed**: `allowRequest` accepts browsers only from `CLIENT_URL`. |
| 5 | Accepting a call while the caller hung up could crash the call code (the offer was cleared during the microphone prompt) | Low (bug, seen once in the test suite) | **Fixed**: the offer is taken first, and the call is re-checked after the microphone opens. |
| 6 | The message kind (`messageType`) and message order are not covered by the encryption's authentication: a malicious server could relabel a text as a photo (it fails to display) or show an old message again | Low | **Accepted**: no secret leaks either way; binding them would change the ciphertext format and break existing messages. Revisit with a v2 message format. |
| 7 | Registering reveals whether an email is already used ("Email already exists") | Low | **Accepted**: usernames are public and searchable anyway; registration is limited to 10 per hour per address. |
| 8 | Revoked sessions and per-user session lists live in memory: a restart forgets them (a logged-out token would work again until its hour ends) | Low | **Fixed (step 61b)**: sessions live in MongoDB, so logouts hold across restarts. Rate limits and presence are still per process (one server). |
| 9 | No forward secrecy (section 4) | Medium (only matters after a key compromise) | **Studied**, not built now (section 4). |
| 10 | Server logs print user ids on every socket connect/join | Info | **Accepted** for now; reduce when a real logger is added at deploy. |

**Checked and fine** (no change needed): parameterised Mongoose queries with type checks before every query (no NoSQL operator injection; search input is regex-escaped); mass assignment blocked by allowlists; ownership checked for conversations, messages, uploads (participants only) and blocks; avatars sniffed by magic bytes (JPEG/PNG/WebP only, never SVG); uploads served as attachments with `nosniff`; passwords: 8–64 characters, at most 72 bytes (bcrypt's limit), common passwords refused, bcrypt cost 10; login errors don't say which part was wrong; session tokens are 256 random bits, only their SHA-256 stored (step 61b; JWT with a 32+ character secret, HS256 pinned, only for the short Google sign-in steps); httpOnly, SameSite=Strict, Secure (production) cookie; helmet headers; CORS to one origin; rate limits on HTTP and socket events; errors never expose stack traces; no secrets in git (only `.env.example`).

## 3. The encryption as built

- **Keys:** each user has an ECDH P-256 key pair made in the browser. The private key is wrapped with AES-256-GCM under a PBKDF2-SHA-256 key (600,000 rounds, 16-byte salt); the server enforces at least 100,000 rounds so a client can't store a weak blob. Unlocked, the key is non-extractable and kept in IndexedDB.
- **Messages:** ECDH(my key, their key) → HKDF-SHA-256 (info = version + conversation id) → one AES-256-GCM key per conversation. Every message has a fresh random 96-bit IV; the sender's id is authenticated data, so the server can't change who sent a message. Random IVs are safe far beyond any real chat (the limit is about 2³² messages per conversation).
- **Files:** a fresh AES-256-GCM key per file; that key travels inside the end-to-end encrypted message.
- **Calls:** WebRTC is encrypted by DTLS-SRTP; the offer/answer/candidates are encrypted with the conversation key, so the server can't swap the DTLS fingerprint to sit in the middle. Reconnecting a dropped call (ICE restart, step 61) sends its new offer/answer the same way (`callRestart`), so it gives the server no new chance to step in.
- **Safety number:** SHA-512 over both public keys (sorted, domain-separated), shown as 60 digits.

- **Sign in with Google (step 59):** OAuth 2.0 authorization code flow with PKCE (S256), `state` and `nonce`, all kept in a signed httpOnly cookie (SameSite=Lax, path `/api/auth/google`, 10 minutes). The server swaps the code for the ID token directly with Google over TLS (so, per OIDC Core 3.1.3.7, it checks the claims rather than the signature): issuer, audience = our client id, expiry, nonce, and `email_verified`. No Google script on our pages, no tokens in URLs, the client secret only on the server. New accounts are created only after a second step in the browser (the private key is locked with an **encryption password** the server never sees); an email that already belongs to a password account is linked only after that account's password is entered (a Google account with the same address isn't proof of owning the OpenChat account). Step tokens between callback and sign-up are signed with a key derived from `JWT_SECRET` for this purpose only, so they can never be used as a login session. Google-only accounts have no bcrypt password: password login answers like a wrong password, and the change-password form is replaced by a note.

- **Email codes at sign-up (step 60):** a 6-digit code from `crypto.randomInt`, stored only as an HMAC (key derived from `JWT_SECRET`), valid 10 minutes, 5 tries counted atomically before the comparison (parallel guesses can't get more), compared in constant time, used up when the account is created, one per address (a new one replaces the old), at most one a minute and 5 an hour per address plus 10 an hour per network. The answer never tells whether an address has an account: that inbox gets "you already have an account" instead of a code. Sent through Brevo's HTTPS API (the key only on the server; Brevo's error details only in the log). `EMAIL_VERIFICATION=off` exists for the test suites and is refused in production; production without Brevo switches email sign-up off (503) rather than creating unverified accounts.

- **Sessions (step 61b):** log in once and stay logged in, like Instagram. The cookie holds a random 256-bit token; MongoDB keeps only its SHA-256, the user, a device label ("Chrome on Android", nothing more), and two ends: 60 days after the last use (renewed at most once a day, the cookie too) and a hard limit a year after login. "Keep me logged in" off (shared computers): a browser-session cookie and a day at most. Logout, "Log out" next to a device in Settings, "Log out of all other devices" and a password change delete sessions in the database (so they hold after restarts) and close their sockets at once; sockets also look their session up at its end time and at least hourly (a 60-day timer can't be set in JavaScript). Trade-off: a stolen cookie works longer than an hour; it can't be read by scripts (httpOnly), isn't sent by other sites (SameSite=Strict), and can be ended from Settings. Old one-hour JWT cookies are refused (everyone logs in once after the change).

- **Web Push (step 63):** the `web-push` library (RFC 8291 payload encryption for the browser's keys, RFC 8292 VAPID signatures); the private VAPID key only on the server. Subscriptions are accepted only for the browsers' push services (FCM, Mozilla, Apple, WNS; HTTPS, exact host or subdomain), because the server itself posts to the endpoint: any other URL would be a server-side request forgery. Keys checked (65-byte P-256 point, 16-byte secret); at most 10 devices per user; each subscription belongs to the login session that made it, and logout, "log out other devices" or an ended session remove it (so the next person on a shared browser gets nothing); 404/410 from the push service remove it too. Pushes never carry message text (chats are end-to-end encrypted: the server can't read them). `PUSH_TEST_ORIGIN` (a local stand-in push service with a self-signed certificate) exists only for tests and is refused in production.

## 4. Forward secrecy study

**What it is.** Forward secrecy means that stealing a key today doesn't unlock messages from yesterday. OpenChat's conversation key comes from the two long-term keys, so anyone who later gets a user's private key (their password plus the locked blob from the server, or their unlocked device) and has recorded the ciphertext can read the **whole history** of that user's chats.

**How much it matters here.** The ciphertext is stored on the server anyway, so "recorded ciphertext" is simply the database. The private key's protection is the password: a database thief can try passwords offline at the cost of 600,000 PBKDF2 rounds each. A strong password makes this impractical; a weak one doesn't.

**Options.**

| Option | What it gives | Cost for OpenChat |
|---|---|---|
| A. Signal protocol (X3DH + Double Ratchet) | Forward secrecy and recovery after a compromise, per message | Large: prekeys uploaded and replenished, per-device sessions, out-of-order handling. It also clashes with OpenChat's model of "log in on any browser and read your history": ratchet keys are deleted by design, so a new browser can't read old messages without a separate encrypted backup. |
| B. MLS (RFC 9420) | The same, designed for groups | Larger still; no mature browser library that fits a small codebase. |
| C. Periodic key rotation (new key pair every N months, old private keys kept locked by the password) | Limits what a *future* key can read; nothing for a stolen password | Medium; little real gain, since the password unlocks all old keys too. |
| D. Stronger password protection of the key (Argon2id via WebAssembly instead of PBKDF2; optional recovery key) | Makes offline guessing of the locked key much slower | Small to medium; a dependency (argon2 WASM) and a migration for existing users. |

**Recommendation.** Keep the current design for launch and document it, like the other honest limits above. It is the right trade for a web app whose promise is "your history on any browser with your password". If stronger protection is wanted later, do **D first** (cheap, protects every message against a stolen database), and consider **A** only together with a real multi-device design and an encrypted backup, as its own project.

## 5. Deploy (step 53) and later

- **Done:** in production the server serves the app itself with a Content-Security-Policy (`server/src/clientApp.js`): scripts only from the server plus the two small inline scripts by SHA-256 hash (the theme script in `client/index.html`, the retry script in `client/public/offline.html`, hashed from the build at start), images and media also from `blob:` (decrypted files), no framing. CSP is the main defence against XSS, which would let an attacker use the unlocked key.
- One server instance (in-memory rate limits and presence; sessions in the database), `TRUST_PROXY` set to the host's proxy count (Render: 1), `NODE_ENV=production` (Secure cookies; `RATE_LIMITS=off` and local file storage are refused), app and API on one address (SameSite=Strict cookie). How to set it up: `docs/DEPLOY.md`.
- Run `npm audit` before every release.
