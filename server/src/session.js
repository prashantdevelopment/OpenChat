import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import JWT from "jsonwebtoken";
import { JWT_SECRET } from "./config/env.js";
import AppError from "./utils/AppError.js";

// Login sessions: a signed token (JWT) in an httpOnly cookie, valid for an
// hour. Each token has its own id (jti), so logging out can end that one
// session on the server too, not only delete the cookie: a copied token
// stops working, and the sockets opened with it are closed (socket.js).

export const SESSION_HOURS = 1;
const ALGORITHM = "HS256"; // pinned: a token signed any other way is refused

// Logged-out token ids -> when the token would have expired anyway (ms).
// In memory, like presence: one server process for now.
const revoked = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [jti, expiresAt] of revoked) {
        if (expiresAt <= now) revoked.delete(jti);
    }
}, 10 * 60 * 1000).unref();

// Each user's sessions that haven't expired: userId -> Map(jti -> expiresAt).
// Changing the password ends all but the current one. (Like `revoked`, this
// is in memory: after a restart, older sessions simply run out within the hour.)
const sessionsOf = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [userId, sessions] of sessionsOf) {
        for (const [jti, expiresAt] of sessions) {
            if (expiresAt <= now) sessions.delete(jti);
        }
        if (sessions.size === 0) sessionsOf.delete(userId);
    }
}, 10 * 60 * 1000).unref();

// socket.js listens: "revoked" (jti) -> close that session's sockets.
export const sessionEvents = new EventEmitter();

// The login cookie (httpOnly: JavaScript can't read it; Strict: never sent
// with requests started by other sites).
export const sessionCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
};

export const setSessionCookie = (res, token) => {
    res.cookie("token", token, { ...sessionCookieOptions, maxAge: SESSION_HOURS * 60 * 60 * 1000 });
};

export const signSessionToken = (userId) => {
    const jti = randomUUID();
    const token = JWT.sign({ userId }, JWT_SECRET, { algorithm: ALGORITHM, expiresIn: `${SESSION_HOURS}h`, jwtid: jti });
    const id = String(userId);
    if (!sessionsOf.has(id)) sessionsOf.set(id, new Map());
    sessionsOf.get(id).set(jti, Date.now() + SESSION_HOURS * 60 * 60 * 1000);
    return token;
};

const revoke = (jti, expiresAt) => {
    revoked.set(jti, expiresAt);
    sessionEvents.emit("revoked", jti);
};

// The token's claims ({ userId, jti, exp, ... }), or throws a 401.
export const verifySessionToken = (token) => {
    let claims;
    try {
        claims = JWT.verify(token, JWT_SECRET, { algorithms: [ALGORITHM] });
    } catch {
        throw new AppError("Invalid or expired token", 401);
    }
    if (claims.jti && revoked.has(claims.jti)) {
        throw new AppError("Invalid or expired token", 401);
    }
    return claims;
};

// Logout: this token is no longer accepted, and its sockets are closed.
// An invalid or expired token needs nothing.
export const endSession = (token) => {
    let claims;
    try {
        claims = verifySessionToken(token);
    } catch {
        return;
    }
    if (!claims.jti) return;
    sessionsOf.get(String(claims.userId))?.delete(claims.jti);
    revoke(claims.jti, claims.exp * 1000);
};

// After a password change: every other session of the user ends (a thief
// logged in with the old password is thrown out); the current one stays.
export const endOtherSessions = (userId, currentJti) => {
    const sessions = sessionsOf.get(String(userId));
    if (!sessions) return;
    for (const [jti, expiresAt] of sessions) {
        if (jti === currentJti) continue;
        sessions.delete(jti);
        revoke(jti, expiresAt);
    }
};
