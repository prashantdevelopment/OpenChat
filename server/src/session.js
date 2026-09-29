import { EventEmitter } from "events";
import { createHash, randomBytes } from "crypto";
import Session from "./models/session.model.js";
import AppError from "./utils/AppError.js";

// Login sessions, like Instagram's: log in once and stay logged in. The cookie
// holds a random 256-bit token; the database keeps only its hash plus when the
// session ends. "Keep me logged in" (the default): until 60 days without using
// OpenChat, renewed as it is used, and at most a year. Without it (a shared
// computer): the browser's own session, at most a day. Logging out (here, from
// Settings for another device, or everywhere else after a password change)
// deletes the session: its cookie stops working and its sockets close
// (socket.js), also after a server restart.

const DAY_MS = 24 * 60 * 60 * 1000;
export const IDLE_DAYS = 60;
export const MAX_DAYS = 365;
const SHORT_MS = DAY_MS; // without "keep me logged in"
// Renewed at most once a day (one database write a day, not one per request).
const RENEW_AFTER_MS = DAY_MS;

const IDLE_MS = IDLE_DAYS * DAY_MS;
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

// socket.js listens: "revoked" (session id) -> close that session's sockets.
export const sessionEvents = new EventEmitter();

// The login cookie (httpOnly: JavaScript can't read it; Strict: never sent
// with requests started by other sites). With "keep me logged in" it lasts as
// long as the session could (renewed with it); without, until the browser closes.
export const sessionCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
};

export const setSessionCookie = (res, { token, remember }) => {
    res.cookie("token", token, { ...sessionCookieOptions, ...(remember ? { maxAge: IDLE_MS } : {}) });
};

// "Chrome on Android", from the User-Agent: enough to recognise a device in
// Settings, nothing more is kept.
export const describeDevice = (userAgent = "") => {
    const ua = String(userAgent);
    const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /OPR\/|Opera/.test(ua) ? "Opera"
        : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
    const os = /Android/.test(ua) ? "Android" : /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Windows/.test(ua) ? "Windows"
        : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
    return os ? `${browser} on ${os}` : browser;
};

// A new session after logging in. Returns the token for the cookie (never stored).
export const createSession = async (userId, { remember = true, userAgent } = {}) => {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const absoluteExpiresAt = new Date(now + (remember ? MAX_DAYS * DAY_MS : SHORT_MS));
    const session = await Session.create({
        tokenHash: hashToken(token),
        userId,
        remember,
        device: describeDevice(userAgent),
        lastUsedAt: new Date(now),
        absoluteExpiresAt,
        // Without "remember" the day-long hard limit is what ends it.
        expiresAt: new Date(Math.min(now + IDLE_MS, absoluteExpiresAt.getTime())),
    });
    return { token, remember, sessionId: String(session._id) };
};

// Who the cookie belongs to, or a 401. Renews the session at most once a day
// (`renewed`: the caller sends the cookie again so it lasts as long).
export const verifySession = async (token) => {
    if (typeof token !== "string" || !token || token.length > 200) throw new AppError("Invalid or expired token", 401);
    const now = Date.now();
    const session = await Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date(now) } }).lean();
    if (!session) throw new AppError("Invalid or expired token", 401);
    let { expiresAt } = session;
    let renewed = false;
    if (now - session.lastUsedAt.getTime() > RENEW_AFTER_MS) {
        expiresAt = new Date(Math.min(now + IDLE_MS, session.absoluteExpiresAt.getTime()));
        await Session.updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date(now), expiresAt } });
        renewed = true;
    }
    return { userId: String(session.userId), sessionId: String(session._id), remember: session.remember, expiresAt: expiresAt.getTime(), renewed, token };
};

// Still valid? (Sockets check now and then; see socket.js.) The end time, or null.
export const sessionEndsAt = async (sessionId) => {
    const session = await Session.findOne({ _id: sessionId, expiresAt: { $gt: new Date() } }).select("expiresAt").lean();
    return session ? session.expiresAt.getTime() : null;
};

const ended = (sessionIds) => sessionIds.forEach((id) => sessionEvents.emit("revoked", String(id)));

// Logout: this cookie stops working and its sockets close.
export const endSession = async (token) => {
    if (typeof token !== "string" || !token) return;
    const session = await Session.findOneAndDelete({ tokenHash: hashToken(token) }).select("_id").lean();
    if (session) ended([session._id]);
};

// "Log out" next to one device in Settings (only the user's own sessions).
export const endSessionOf = async (userId, sessionId) => {
    const session = await Session.findOneAndDelete({ _id: sessionId, userId }).select("_id").lean();
    if (session) ended([session._id]);
    return Boolean(session);
};

// After a password change, or "Log out of all other devices": every other
// session of the user ends; the current one stays.
export const endOtherSessions = async (userId, currentSessionId) => {
    const others = await Session.find({ userId, _id: { $ne: currentSessionId } }).select("_id").lean();
    if (!others.length) return 0;
    await Session.deleteMany({ _id: { $in: others.map((s) => s._id) } });
    ended(others.map((s) => s._id));
    return others.length;
};

// "Where you're logged in" (Settings): this device first, then the newest use.
export const listSessions = async (userId, currentSessionId) => {
    const sessions = await Session.find({ userId, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }).lean();
    const isCurrent = (s) => String(s._id) === String(currentSessionId);
    return [...sessions.filter(isCurrent), ...sessions.filter((s) => !isCurrent(s))].map((s) => ({
        _id: String(s._id),
        device: s.device,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        remember: s.remember,
        current: String(s._id) === String(currentSessionId),
    }));
};
