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

// socket.js listens: "revoked" (jti) -> close that session's sockets.
export const sessionEvents = new EventEmitter();

export const signSessionToken = (userId) =>
    JWT.sign({ userId }, JWT_SECRET, { algorithm: ALGORITHM, expiresIn: `${SESSION_HOURS}h`, jwtid: randomUUID() });

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
    revoked.set(claims.jti, claims.exp * 1000);
    sessionEvents.emit("revoked", claims.jti);
};
