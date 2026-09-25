# Project Plan — OpenChat

**Status:** Approved, building · **Last updated:** 2026-09-25 · **Next step:** 14 – Response shaping (no emails in conversation list)

> How to use this file: it is the single source of truth for what gets built and in which order.
> Work happens **one step at a time**: pick the next `todo` → build only that → test (two users) → cleanup → mark `done` → the user commits.
> If the plan changes, update this file (and `docs/blueprint.html`) first, then code.

## 1. Overview

- **What:** A real-time, open-world 1:1 communication platform. Any registered user can find and message any other user, with no friend requests.
- **For whom:** Users across India. A signature feature shows live presence per Indian state.
- **Primary goal:** Two strangers can find each other, chat in real time with **end-to-end encrypted** messages, share media and call each other.
- **Learning goal:** Build every layer properly (REST, Socket.IO, MongoDB, cryptography, WebRTC, auth, security, UI craft) and understand it.
- **Stack (existing):**
  - Client: React 19 + Vite, axios, socket.io-client.
  - Server: Express 5, Mongoose 9, Socket.IO 4, JWT in an httpOnly cookie, bcrypt.
  - Database: MongoDB.
- **Stack (planned additions, each added only in the step that needs it):**
  - React Router
  - Web Crypto API (built into the browser, no library)
  - Tailwind CSS v4 + shadcn/coss ui
  - `motion`
  - `three` + `@react-three/fiber` + `@react-three/drei`
  - Vitest + supertest
  - Cloudinary
  - helmet + express-rate-limit
- **Deadline:** none. Quality and understanding over speed.
- **Ground rules:**
  - Keep the existing Route → Controller → Service → Model layering, `AppError` plus the central error handler, and deriving identity on the server (`req.user.userId`, `socket.userId`).
  - JavaScript, no TypeScript migration.
  - No new library unless the step needs it.
  - The user makes every git commit. Agents only propose a checkpoint.

## 2. Sitemap

```mermaid
flowchart TD
    landing["Landing /"] --> login["Login /login"]
    landing --> register["Register /register"]
    login --> chat["Chat /chat"]
    register --> chat
    chat --> convo["Conversation /chat/:conversationId"]
    chat --> discover["Discover /discover"]
    chat --> settings["Settings /settings"]
    discover --> profile["User profile /u/:username"]
    profile -.-> convo
    convo -.-> call(["Call overlay - voice / video"])
    landing -.-> notfound["404 page"]
```

- `/chat`, `/chat/:conversationId`, `/discover`, `/settings` and `/u/:username` are **protected**: they redirect to `/login` without a session.
- `/login` and `/register` redirect to `/chat` if the user is already logged in.
- The call UI is an **overlay**, not a page, so a call survives navigating between chats.

## 3. Pages and sections

### Landing `/` (public)
| # | Section | Purpose | Components | Links / CTAs |
|---|---|---|---|---|
| 1 | Header | Brand, auth links, theme toggle | Header, Button, ThemeToggle | /login, /register |
| 2 | Hero | Promise and a 3D visual (live India presence globe/map, poster fallback) | Hero3D (lazy), Button | /register |
| 3 | Features | Encrypted messaging, media, calls, presence | FeatureGrid | – |
| 4 | Live presence teaser | Aggregate online counts per state | IndiaPresence (lazy) | /register |
| 5 | Footer | Links, copyright | Footer | – |

### Login `/login` and Register `/register`
| # | Section | Purpose | Components | Links / CTAs |
|---|---|---|---|---|
| 1 | Auth card | Form with inline errors, loading and disabled states. Register also asks for **Indian state** (required dropdown) | AuthLayout, FormField, Select, Button | /chat on success |
| 2 | Switch link | "No account? Register" and the reverse | Link | /register ↔ /login |

### Chat `/chat` and `/chat/:conversationId` (protected, the core app)
| # | Section | Purpose | Components | Links / CTAs |
|---|---|---|---|---|
| 1 | App shell | Two panes on desktop, one pane at a time on mobile | AppLayout | – |
| 2 | Sidebar | Own avatar/menu, search, conversation list (avatar, name, decrypted last message, time, unread badge, online dot) | Sidebar, ConversationItem, Avatar, Badge | /chat/:id, /discover, /settings |
| 3 | Chat header | Other user, online/last-seen, encryption lock, call buttons, back button on mobile | ChatHeader | call overlay, /u/:username |
| 4 | Message thread | Grouped bubbles, timestamps, date separators, receipts, media, infinite scroll up | MessageList, MessageBubble, DateDivider | – |
| 5 | Typing indicator | "typing…" for the other user | TypingIndicator | – |
| 6 | Composer | Multi-line input (Shift+Enter), send, attach, voice note | Composer, AttachButton, VoiceRecorder | – |
| 7 | Empty states | No conversation selected / no messages yet | EmptyState | /discover |

### Discover `/discover` (protected)
| # | Section | Purpose | Components | Links / CTAs |
|---|---|---|---|---|
| 1 | Search | Find users by username | SearchBar, UserCard | /u/:username, start chat |
| 2 | India presence map | Interactive 3D map with online users per state (aggregate) | IndiaPresence (R3F, lazy, 2D fallback) | filter by state |
| 3 | People in state | Users of the selected state | UserCard list | start chat |

### Profile `/u/:username` and Settings `/settings` (protected)
| # | Section | Purpose | Components |
|---|---|---|---|
| 1 | Profile | Avatar, bio, state, online status, "Message" button, key fingerprint (verify) | ProfileCard |
| 2 | Settings | Edit profile (avatar, bio, state), change password (re-wraps the encryption key), theme, privacy (read receipts on/off), blocked users, logout | SettingsForm, FormField |

## 4. Section interlink map

```mermaid
flowchart LR
    subgraph LANDING["Landing"]
        l_hero["Hero 3D"] --> l_feat["Features"] --> l_presence["Presence teaser"]
    end
    subgraph AUTH["Login / Register"]
        a_form["Auth form"]
    end
    subgraph CHAT["Chat"]
        c_side["Sidebar"] --> c_header["Chat header"] --> c_thread["Message thread"] --> c_comp["Composer"]
    end
    subgraph DISCOVER["Discover"]
        d_search["Search"] --> d_map["India map"] --> d_people["People in state"]
    end
    l_hero -.-> a_form
    l_presence -.-> a_form
    a_form -.-> c_side
    c_side -.-> d_search
    d_people -.-> c_thread
    c_header -.-> callov(["Call overlay"])
```

## 5. User flows

```mermaid
flowchart TD
    visit(["New visitor on Landing"]) --> reg["Registers: username, email, password, state"]
    reg --> keys["Browser creates encryption key pair; public key to server, private key wrapped with password"]
    keys --> app["Lands on /chat - empty state"]
    app --> disc["Opens Discover, searches or picks a state"]
    disc --> start["Clicks Message on a user"]
    start --> convo["POST /conversations - create or get"]
    convo --> talk(["Encrypted real-time chat at /chat/:id"])
```

```mermaid
flowchart TD
    a_type(["User A types a message"]) --> enc["A's browser encrypts - AES-GCM, key from ECDH of A private + B public"]
    enc --> s_val["Server: auth, participant check, validate size"]
    s_val --> db["Save ciphertext + iv - server cannot read it"]
    db --> ack["Ack to A - sent"]
    db --> room["Emit newMessage to conversation room"]
    db --> urooms["Emit conversationUpdated to user rooms of A and B"]
    urooms --> b_list["B's sidebar: reorder + unread badge"]
    room --> dec["B's browser decrypts with B private + A public"]
    dec --> b_open["Bubble appears, B emits markRead"]
    b_open --> receipt(["A sees Read"])
```

```mermaid
flowchart TD
    caller(["A clicks Call"]) --> offer["callUser - SDP offer via Socket.IO user room"]
    offer --> ring["B sees incoming call overlay"]
    ring -->|accept| answer["answerCall - SDP answer"]
    ring -->|reject or timeout| missed(["Missed call message saved"])
    answer --> ice["ICE candidates exchanged - STUN / TURN"]
    ice --> media(["Peer-to-peer audio/video - DTLS-SRTP encrypted"])
```

## 6. Shared components (built before the screens that use them)

```mermaid
flowchart TD
    root["App - Router + AuthProvider + ThemeProvider"] --> pub["PublicLayout"]
    root --> prot["ProtectedRoute"]
    prot --> applayout["AppLayout - sidebar + main"]
    pub --> header["Header"]
    pub --> footer["Footer"]
    applayout --> sidebar["Sidebar"]
    applayout --> chatpane["Chat pane"]
    sidebar --> avatar["Avatar + online dot"]
    sidebar --> badge["Badge"]
    chatpane --> bubble["MessageBubble"]
    chatpane --> composer["Composer"]
    root --> ui["UI primitives - Button, FormField, Select, Dialog, Toast, Skeleton, Loader, EmptyState"]
```

- **Client state:** `AuthContext` for the current user, session and the unlocked private key. Theme is a small context or just a `data-theme` attribute plus `localStorage`. Chat state stays in the chat page and its hooks. No Redux/Zustand unless a real need appears.
- **One `api` axios instance** (baseURL from `VITE_API_URL`, `withCredentials`), **one `socket`** module and **one `crypto` module** (all Web Crypto calls live there, nowhere else).

## 7. Data & API map

```mermaid
erDiagram
    USER ||--o{ CONVERSATION : "participates in"
    CONVERSATION ||--o{ MESSAGE : contains
    USER ||--o{ MESSAGE : sends
    USER ||--o{ BLOCK : "blocks"
    USER {
        string username
        string email
        string password "bcrypt, select false"
        string state "required, Indian state or UT code"
        string publicKey "ECDH P-256, public"
        string encryptedPrivateKey "wrapped with password-derived key"
        string keySalt "PBKDF2 salt"
        string avatar
        string bio
        date lastSeen
        bool readReceipts
    }
    CONVERSATION {
        ObjectId participants "2 users"
        string conversationKey "unique"
        object lastMessage "ciphertext, iv, type, sender, at"
        date lastMessageAt
        object lastReadAt "per participant"
    }
    MESSAGE {
        ObjectId conversationId
        ObjectId sender
        string messageType "text image video file audio call"
        string ciphertext "encrypted content"
        string iv "random per message"
        object media "url, mime, size, duration, encrypted file key"
        date deliveredAt
        date createdAt
    }
    BLOCK {
        ObjectId blocker
        ObjectId blocked
    }
```

**Key data decisions (explained when each step is built):**
- **State is chosen by the user at registration** from a fixed list of the 28 states + 8 UTs, and validated on the server against the same list. Not detected from the IP address: VPNs, mobile carrier IPs (often routed through another state) and proxies make IP-based location wrong, it needs a paid geo-IP database, and asking is more transparent for privacy.
- **Online status lives in memory, not in MongoDB.** A server-side `Map<userId, socketCount>` tracks who is online, so multiple tabs work. `lastSeen` is written to the DB only on the final disconnect. The existing `isOnline` field is dropped because it goes stale after a crash.
- **Read state is per participant on the conversation** (`lastReadAt[userId]`), not an `isRead` flag on every message. One update marks everything read; unread count = messages from the other user after my `lastReadAt`.
- **Indexes:** `Message {conversationId: 1, createdAt: -1}` and `Conversation {participants: 1, lastMessageAt: -1}`.
- **Media files live in Cloudinary** (encrypted before upload). MongoDB stores only the URL and metadata.

### End-to-end encryption design (Phase C)
- **Library:** the browser's built-in **Web Crypto API** (`crypto.subtle`). No npm package needed.
- **Keys:**
  - Each user gets an **ECDH P-256** key pair, generated in the browser at registration.
  - The **public key** is stored on the server.
  - The **private key** is encrypted (wrapped) in the browser with an AES key derived from the user's password (PBKDF2-SHA-256, 600k iterations, random salt). Only that wrapped blob goes to the server, so the server never sees the private key or the password-derived key.
- **Per conversation:** ECDH(my private, their public) → HKDF → an AES-256-GCM key. Both users derive the **same** key independently; it is never sent anywhere.
- **Per message:** AES-GCM with a fresh random 12-byte IV. The server stores `ciphertext + iv` only.
- **Login on a new device:** the server returns the wrapped private key, and the browser unwraps it with the password the user just typed.
- **Refresh:** the unwrapped key is kept as a **non-extractable** `CryptoKey` in IndexedDB, and logout deletes it.
- **Change password:** re-wrap the same private key with the new password. Old messages stay readable.
- **Honest limits (documented, revisited in step 51):**
  - **Forgot password means old messages are unreadable.** This is true E2EE: the server cannot recover the key.
  - **No forward secrecy.** Static keys, unlike Signal's Double Ratchet: if a private key leaks, past messages can be decrypted. The Double Ratchet is a possible later study step.
  - **The server serves the JavaScript.** A compromised server could ship malicious code; this is a limit of all web E2EE. A key fingerprint ("safety number") lets users verify each other.
- **Lost by design:** server-side message search, and server-generated notification text.
- **What stays plaintext on the server:** usernames, profile, state, who talks to whom, and timestamps (metadata).

### REST endpoints
| Endpoint | Method | Auth | Status | Used by |
|---|---|---|---|---|
| `/api/health` | GET | public | exists | monitoring |
| `/api/users` | POST | public | exists (needs field whitelist, state, keys) | Register |
| `/api/auth/login` | POST | public | exists (needs input validation; returns wrapped key + salt) | Login |
| `/api/auth/logout` | POST | cookie | exists | Settings / menu |
| `/api/auth/me` | GET | cookie | exists (unused by client) | AuthProvider on app load |
| `/api/users/me` | PATCH | cookie | exists | Settings |
| `/api/users/me/password` | PATCH | cookie | exists (also takes the re-wrapped key) | Settings |
| `/api/users/search?q=` | GET | cookie | planned | Discover, sidebar search |
| `/api/users/:username` | GET | cookie | planned (includes publicKey) | Profile |
| `/api/conversations` | GET | cookie | exists (stop leaking email; include participants' publicKey) | Sidebar |
| `/api/conversations` | POST | cookie | exists | "Message" button |
| `/api/conversations/:id/messages?before=&limit=` | GET | cookie | exists (paginated, step 13) | Message thread |
| `/api/uploads/signature` | POST | cookie | planned | Media upload |
| `/api/presence/states` | GET | cookie | planned | India map |
| `/api/blocks` | POST/DELETE/GET | cookie | planned | Settings, profile |

### Socket.IO events
Rooms: `conversationId` (existing) and `user:<userId>` (planned, joined automatically on connect). Every client → server event returns an **ack** `{ success, ... }` or `{ success: false, message }`.

| Client → Server | Server → Client | Room / target | Status |
|---|---|---|---|
| `joinConversation(id, ack)` | – | conversation | exists (ack added in step 2) |
| `leaveConversation(id)` | – | conversation | exists |
| `sendMessage({conversationId, content}, ack)` | `newMessage` | conversation | exists (hardened in step 2; `content` → `ciphertext, iv` in step 17) |
| – | `conversationUpdated` `{_id, lastMessage, lastMessageAt}` | user rooms of both participants | exists (step 11) |
| `typing({conversationId, isTyping})` | `typing` | conversation (except sender) | planned |
| `markRead(conversationId, ack)` | `conversationRead` `{_id}` | own user room (step 12) | exists |
| – | `messagesRead` (read receipts to the other user) | conversation | planned (step 31) |
| – | `presence:update` | contacts' user rooms | planned |
| `callUser / answerCall / iceCandidate / endCall` | same names | user rooms | planned |

## 8. Design decisions

- **Design system:** **`ui-ux-pro-max`**, chosen by the user. It is a searchable design database (styles, palettes, font pairings, UX rules). In step 19 it generates the design system with `--design-system --persist`, saved as `design-system/openchat/MASTER.md`, which every UI step then reads. It is reference data, not a separate "look", so no other direction skill is stacked on top.
- **Theme:** **light by default**, with a **dark-mode toggle**. Both themes come from the same CSS variables (`:root` + `[data-theme="dark"]`); the choice is saved in `localStorage` and the first visit follows `prefers-color-scheme`. Both themes must pass contrast checks.
- **Styling:** Tailwind CSS v4 (Vite plugin) + shadcn with **coss ui** primitives for app UI (dialogs, inputs, selects, menus, toasts). Kokonut UI only for eye-catching landing pieces.
- **Tokens:** defined once as CSS variables (colors, type scale, spacing, radius, durations `--dur-fast/base`, `--ease-out`).
- **Animation library (one):** `motion` (`motion/react`) for message enter, list reorder/layout, overlays and page transitions. No GSAP inside the app. The landing page can use GSAP only if Motion can't do a specific effect, and that needs approval.
- **3D (only where it supports the message, never in the chat hot path):**
  - Landing hero and Discover: an **interactive India presence map/globe** in React Three Fiber (`three` 0.186, fiber 9, drei 10; React 19 ✓). Base from **ThreeUI** where it fits, with `shader-glsl` / `particle-system` for glowing state points. Colors come from the theme tokens so it works in light and dark.
  - Voice call screen: an audio-reactive **Liquid Orb** (export → web), driven by WebRTC audio levels.
  - Rules: lazy-loaded, static poster/2D fallback, pause off-screen/tab hidden, DPR ≤ 2 (1.5 on mobile), `prefers-reduced-motion` respected.
- **Other kit sources:** Circle Loaders (spinners), liquid-glass (sparingly: floating call controls / mobile composer bar).
- **Skills per phase:**
  - `express-api-backend` + `owasp-security` for backend, auth and crypto
  - `mongodb-schema-design` / `mongodb-query-optimizer` for the database
  - `react-best-practices` + `composition-patterns` for React
  - `ui-ux-pro-max` + `premium-interaction-craft` for UI
  - `react-three-fiber` / `threejs-webgl` / `shader-glsl` for 3D
  - `motion-framer` for animation
  - `ponytail` to keep logic minimal
  - `post-code-cleanup` after every step
  - the `web-app-chat` checklist for chat UX

## 9. Build order

Each step is small enough to build, test with two users, and review in one go. **Phases are in order; don't start a phase while the previous one has broken steps.**

### Phase A — Stabilize the core (backend-first, no new UI)
| # | Step | Status | Done on | Notes |
|---|---|---|---|---|
| 1 | Checkpoint current uncommitted work (message input, leaveConversation, bubbles) | done | 2026-09-25 | Committed by user (`84a8b64`) |
| 2 | Harden socket handlers: try/catch, ack callbacks, content validation (string, trim, max length), one shared participant check | done | 2026-09-25 | Crash fixed; 26/26 two-user checks passed. Messages REST route now returns 400 for invalid ids |
| 3 | REST input validation + error handler: ObjectId checks, `CastError` → 400, login body check, consistent `{success:false,message}` | done | 2026-09-25 | 35/35 REST checks + 12/12 socket regression passed. JSON 404, malformed JSON → 400, `POST /api/messages` removed |
| 4 | Session restore on refresh (`/auth/me`) + logout | done | 2026-09-25 | 14/14 browser E2E checks in Edge (refresh, logout, two-user chat) |
| 5 | Reconnect: re-join room on `connect`; fix history race on fast switching | done | 2026-09-25 | 15/15 browser E2E (network drop, server restart, slow history); old code fails 8 of them. Also: offline send refused (no duplicate) |
| 6 | Client config: `VITE_API_URL`, one `api` axios instance, complete `.env.example` (server + client) | done | 2026-09-25 | 6 hardcoded URLs → `client/src/api/api.js`; `server/.env.example` + `client/.env.example`; JWT_SECRET ≥ 32 chars; README setup. E2E 14/14 + 15/15 |
| 7 | Test harness: Vitest + supertest + two-user socket test against a separate test DB | done | 2026-09-25 | `npm test`: 66 tests (auth, conversations, socket). Socket setup moved to `server/src/socket.js`. Mutation check: 3 injected security bugs all caught. Fixed Mongoose `new: true` deprecation |

### Phase B — Complete the core product flow (functional UI, minimal styling)
| # | Step | Status | Done on | Notes |
|---|---|---|---|---|
| 8 | React Router + AuthContext + protected routes (`/login`, `/register`, `/chat`, `/chat/:id`, 404) | done | 2026-09-25 | React Router 8 (declarative). `/chat/:conversationId?`, deep link kept through login, `ConversationView` keyed by id. 22/22 routing E2E; `/register` route comes with step 9 |
| 9 | Registration page + server field whitelist + **required state** (dropdown, server-validated list) | done | 2026-09-25 | `/register` with labels, field errors, double-submit guard, auto-login. State list in `shared/indian-states.js` (server + client). 70 server tests, 19/19 register E2E |
| 10 | User search API + "start conversation" | done | 2026-09-25 | `GET /api/users/search` (prefix, regex-escaped, public fields, max 20); debounced `UserSearch` in the sidebar; simultaneous conversation creates no longer 409. 101 server tests, 19/19 search E2E |
| 11 | Per-user rooms + live sidebar (`conversationUpdated`: last message, reorder) | done | 2026-09-25 | Personal room `user:<id>` on connect; summary `{_id, lastMessage, lastMessageAt}` to both participants; client merges via `useEffectEvent`, reloads for unknown conversations and after reconnect. Message list is `role="log"`. 104 server tests, 14/14 sidebar E2E (old client fails 8) |
| 12 | Unread counts (`lastReadAt` per participant) | done | 2026-09-25 | `Conversation.lastReadAt` Map; list counts in one aggregation; per-participant `unreadCount` in `conversationUpdated` (sent before `newMessage`); `markRead` → `conversationRead` to own tabs; only while the tab is visible. `Message.isRead` removed. 113 server tests, 15/15 unread E2E |
| 13 | Message pagination (load older on scroll up) + indexes | done | 2026-09-25 | Cursor pagination `?before=<messageId>&limit=` (default 50, max 100), `(createdAt, _id)` tie-break, `hasMore`; indexes `Message {conversationId, createdAt, _id}` and `Conversation {participants, lastMessageAt}` verified with explain(); client merges pages and resets on a reconnect gap. "Load older" is a button for now (auto on scroll in step 25). 128 server tests, 20/20 pagination E2E |
| 14 | Response shaping: no emails in conversation list, no internal fields | todo | | |

### Phase C — End-to-end encryption for text (before UI, so everything later is built on encrypted messages)
| # | Step | Status | Done on | Notes |
|---|---|---|---|---|
| 15 | Key pair at registration: ECDH P-256 in the browser, public key + password-wrapped private key stored on server | todo | | Crypto concepts walkthrough first |
| 16 | Unlock at login, keep a non-extractable key in IndexedDB for refresh, wipe on logout, re-wrap on password change | todo | | |
| 17 | Encrypt/decrypt messages (ECDH → HKDF → AES-GCM); server stores only `ciphertext + iv`; sidebar preview decrypted in the browser | todo | | Existing plaintext dev messages get cleared |
| 18 | Key fingerprint ("safety number") on profile + "forgot password = old messages unreadable" handling | todo | | |

### Phase D — Design foundation + app UI (one piece at a time)
| # | Step | Status | Done on | Notes |
|---|---|---|---|---|
| 19 | Design foundation: `ui-ux-pro-max` design system → MASTER.md, Tailwind v4, shadcn/coss init, tokens, **light default + dark toggle** | todo | | |
| 20 | App layout shell: 2-pane desktop, 1-pane mobile (360 → 1440px) | todo | | |
| 21 | Sidebar + conversation items (avatar, name, last message, time, unread) | todo | | |
| 22 | Chat header (incl. encryption lock indicator) | todo | | |
| 23 | Message bubbles: grouping, timestamps, date separators | todo | | |
| 24 | Composer: multi-line, Shift+Enter, sending/failed state, retry | todo | | |
| 25 | Auto-scroll that never interrupts reading history + "new messages" pill | todo | | |
| 26 | Loading / empty / error states (skeletons, Circle Loaders, toasts) | todo | | |
| 27 | Auth pages UI (login/register with state picker) | todo | | |
| 28 | Settings + profile page (avatar URL, bio, state, password, theme, logout) | todo | | |

### Phase E — Real-time features (one at a time)
| # | Step | Status | Done on | Notes |
|---|---|---|---|---|
| 29 | Presence: online/offline + last seen (multi-tab aware, in memory) | todo | | |
| 30 | Typing indicator (throttled, auto-stop) | todo | | |
| 31 | Delivered + read receipts (privacy toggle) | todo | | |
| 32 | Notifications: tab title badge, optional browser notification (text decrypted in the browser) | todo | | |

### Phase F — Media sharing (encrypted)
| # | Step | Status | Done on | Notes |
|---|---|---|---|---|
| 33 | Cloudinary signed upload + images encrypted in the browser before upload (preview, progress) | todo | | Needs Cloudinary account |
| 34 | Video + file messages (size/type limits server-side) | todo | | |
| 35 | Voice notes (MediaRecorder) + audio player bubble | todo | | |
| 36 | Avatar upload (public, not encrypted) | todo | | |

### Phase G — Calls (WebRTC)
| # | Step | Status | Done on | Notes |
|---|---|---|---|---|
| 37 | Call signaling over Socket.IO + 1:1 voice call (STUN) | todo | | |
| 38 | Video call + controls (mute, camera, switch, end) + call overlay | todo | | |
| 39 | Call states: ringing, busy, missed, timeout → call message in chat | todo | | |
| 40 | Voice-call Liquid Orb (audio-reactive) | todo | | 3D/visual |
| 41 | TURN server for real-world networks | todo | | Needs a TURN provider |

### Phase H — India presence & discovery (signature 3D feature)
| # | Step | Status | Done on | Notes |
|---|---|---|---|---|
| 42 | Aggregated presence per state (API + live socket update, counts only) | todo | | |
| 43 | Discover page: search + people by state (2D first) | todo | | |
| 44 | Interactive 3D India map (R3F), lazy + 2D fallback, light/dark aware | todo | | |

### Phase I — Landing page & motion polish
| # | Step | Status | Done on | Notes |
|---|---|---|---|---|
| 45 | Landing page structure + content | todo | | |
| 46 | Landing 3D hero (ThreeUI / R3F / shader), poster fallback | todo | | |
| 47 | App motion polish with `motion` (messages, lists, overlays, routes) | todo | | |
| 48 | Accessibility + reduced-motion pass (both themes) | todo | | |

### Phase J — Safety, security & launch
| # | Step | Status | Done on | Notes |
|---|---|---|---|---|
| 49 | Block user (server-enforced in messages, calls, search) + report | todo | | Important for an open-world app |
| 50 | helmet, rate limits (auth + socket events), socket session expiry | todo | | |
| 51 | Security review incl. crypto (`owasp-security`); forward-secrecy study | todo | | |
| 52 | SEO basics: titles, favicon, meta, 404 | todo | | |
| 53 | Deploy: MongoDB Atlas, backend on a WebSocket-capable host, frontend host, same-site cookies, HTTPS | todo | | SPA fallback: host must serve `index.html` for all app paths (e.g. `/chat/:id`). Indexes: Mongoose builds them on start (autoIndex); in production create them once at deploy and turn autoIndex off |
| 54 | `launch-readiness-audit` | todo | | |

Status values: `todo` · `in progress` · `done` · `blocked (<reason>)`

## 10. Open questions & risks

1. **Cloudinary and TURN accounts:** free tiers are enough for development. Needed before steps 33 and 41.
2. **Risk, cookies in production:** `sameSite: strict` only works if frontend and API are on the same site (e.g. `app.domain.com` + `api.domain.com`). Decide the hosting setup before step 53.
3. **Risk, WebRTC across networks:** without a TURN server, many calls (mobile data, strict NAT) will fail.
4. **Risk, E2EE and forgotten passwords:** a password reset cannot recover old messages. The UI must say so clearly (step 18).
5. **Existing dev data:** users created before step 9/15 have no `state` or keys. The plan is to clear dev data at step 15 rather than write a migration.

**Resolved (2026-09-25):**
- Design: `ui-ux-pro-max`, light default + dark toggle.
- State: asked at registration (required).
- Text: proper end-to-end encryption.
- Agent Kit moved to the project root.
- Username rules: 3–30 chars, lowercase letters/numbers/`.`/`_`, starts with a letter or number, no trailing or double dot, reserved names (admin, support, openchat, …) blocked.
- Password policy (OWASP ASVS 5.0): 8–64 characters (max 72 bytes, the bcrypt limit), any characters, no composition rules, common passwords blocked. The built-in list is small; a larger breached-password list is part of step 51.
