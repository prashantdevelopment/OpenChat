import { Agent } from "https";
import webpush from "web-push";
import PushSubscription from "../models/pushSubscription.model.js";
import Session from "../models/session.model.js";
import { PUSH, PUSH_TEST_ORIGIN } from "../config/env.js";
import { sessionEvents } from "../session.js";
import AppError from "../utils/AppError.js";

// Web Push: notifications while OpenChat is closed. The browser subscribes at
// its own push service (Google's for Chrome/Android, Mozilla's, Apple's,
// Microsoft's) and gives us an endpoint URL plus keys; we send each message to
// that URL, encrypted for the browser (RFC 8291) and signed with our VAPID key
// (RFC 8292), through the `web-push` library.
// - Only endpoints of those push services are accepted: the server makes the
//   request, so any other URL would let a client aim it at anything (SSRF).
// - A subscription belongs to the login session that made it: logging out on
//   that device (or from another one) removes it, so the next person using
//   that browser gets nothing of the previous one's.

const PUSH_SERVICE_HOSTS = [
    "fcm.googleapis.com", // Chrome, Edge on Android, Samsung Internet, Opera
    "updates.push.services.mozilla.com", // Firefox
    "push.apple.com", // Safari (web.push.apple.com)
    "notify.windows.com", // Edge on Windows (*.notify.windows.com)
];
const MAX_PER_USER = 10;
const testAgent = PUSH_TEST_ORIGIN ? new Agent({ rejectUnauthorized: false }) : null;

export const pushEnabled = () => Boolean(PUSH);
export const pushPublicKey = () => PUSH?.publicKey ?? null;

const isPushService = (url) =>
    (url.protocol === "https:" && PUSH_SERVICE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) ||
    (PUSH_TEST_ORIGIN !== null && url.origin === PUSH_TEST_ORIGIN);

const base64urlBytes = (value) => (typeof value === "string" && /^[\w-]+=*$/.test(value) ? Buffer.from(value, "base64url") : null);

// The subscription the browser made ({ endpoint, keys: { p256dh, auth } }), checked.
const checkSubscription = (body) => {
    const { endpoint, keys } = body ?? {};
    let url;
    try {
        url = typeof endpoint === "string" && endpoint.length <= 1024 ? new URL(endpoint) : null;
    } catch {
        url = null;
    }
    if (!url || !isPushService(url)) throw new AppError("This isn't a push service's address", 400);
    const p256dh = base64urlBytes(keys?.p256dh);
    const auth = base64urlBytes(keys?.auth);
    // An uncompressed P-256 public key (65 bytes, 0x04 first) and a 16-byte secret.
    if (!p256dh || p256dh.length !== 65 || p256dh[0] !== 4 || !auth || auth.length !== 16) {
        throw new AppError("The subscription's keys look wrong", 400);
    }
    return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
};

// Turn on for this browser (or move it to this account/session).
export const saveSubscription = async (userId, sessionId, body) => {
    if (!PUSH) throw new AppError("Notifications while OpenChat is closed aren't set up on this server", 404);
    const subscription = checkSubscription(body);
    await PushSubscription.updateOne(
        { endpoint: subscription.endpoint },
        { $set: { userId, sessionId, keys: subscription.keys } },
        { upsert: true },
    );
    // A few devices each; the oldest go.
    const extra = await PushSubscription.find({ userId }).sort({ updatedAt: -1 }).skip(MAX_PER_USER).select("_id").lean();
    if (extra.length) await PushSubscription.deleteMany({ _id: { $in: extra.map((s) => s._id) } });
};

// Turn off for this browser (only the user's own).
export const removeSubscription = async (userId, endpoint) => {
    if (typeof endpoint !== "string") throw new AppError("endpoint is required", 400);
    await PushSubscription.deleteOne({ userId, endpoint });
};

// Sends `payload` (JSON, shown by the service worker) to every browser of the
// user that is still logged in. Gone subscriptions (404/410) are removed.
// urgency: "high" for calls; topic: a newer push with the same topic replaces
// an undelivered one (one per chat). Returns how many were accepted.
export const sendPush = async (userId, payload, { urgency = "normal", ttlSeconds = 60 * 60, topic } = {}) => {
    if (!PUSH) return 0;
    const subscriptions = await PushSubscription.find({ userId }).lean();
    if (!subscriptions.length) return 0;
    const live = new Set((await Session.find({ _id: { $in: subscriptions.map((s) => s.sessionId) }, expiresAt: { $gt: new Date() } }).select("_id").lean()).map((s) => String(s._id)));
    const stale = subscriptions.filter((s) => !live.has(String(s.sessionId)));
    if (stale.length) await PushSubscription.deleteMany({ _id: { $in: stale.map((s) => s._id) } });

    const body = JSON.stringify(payload);
    const results = await Promise.all(subscriptions.filter((s) => live.has(String(s.sessionId))).map(async (s) => {
        try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, {
                vapidDetails: { subject: PUSH.subject, publicKey: PUSH.publicKey, privateKey: PUSH.privateKey },
                TTL: ttlSeconds,
                urgency,
                ...(topic ? { topic } : {}),
                timeout: 10_000,
                ...(testAgent && s.endpoint.startsWith(PUSH_TEST_ORIGIN) ? { agent: testAgent } : {}),
            });
            return true;
        } catch (error) {
            if (error.statusCode === 404 || error.statusCode === 410) {
                await PushSubscription.deleteOne({ _id: s._id }); // the browser unsubscribed or expired it
            } else {
                console.error("Push failed:", error.statusCode ?? error.code ?? error.message);
            }
            return false;
        }
    }));
    return results.filter(Boolean).length;
};

// A device logged out (or was logged out): its subscriptions go with it.
sessionEvents.on("revoked", (sessionId) => {
    PushSubscription.deleteMany({ sessionId }).catch((error) => console.error("Could not remove push subscriptions:", error));
});
