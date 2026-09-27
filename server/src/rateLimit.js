import AppError from "./utils/AppError.js";

// Rate limits, kept in memory: a fixed window per key ("login:<ip>:<name>",
// "sendMessage:<userId>", ...). One server process for now (like presence.js);
// several would need a shared store such as Redis.
//
// Checked on every call (not once at start) so the test suites can switch
// them off with RATE_LIMITS=off; env.js refuses "off" in production.
const enabled = () => process.env.RATE_LIMITS !== "off";

// A limiter: at most `max` hits per `windowMs` for each key.
export const createLimiter = ({ windowMs, max }) => {
    const windows = new Map(); // key -> { count, resetAt }
    // Forget finished windows, so the map doesn't grow with every IP ever seen.
    setInterval(() => {
        const now = Date.now();
        for (const [key, window] of windows) {
            if (window.resetAt <= now) windows.delete(key);
        }
    }, windowMs).unref();

    return {
        // Counts one hit; { allowed, retryAfterMs }.
        hit: (key) => {
            if (!enabled()) return { allowed: true, retryAfterMs: 0 };
            const now = Date.now();
            let window = windows.get(key);
            if (!window || window.resetAt <= now) {
                window = { count: 0, resetAt: now + windowMs };
                windows.set(key, window);
            }
            window.count += 1;
            return { allowed: window.count <= max, retryAfterMs: window.resetAt - now };
        },
    };
};

// "in 3 minutes" / "in 20 seconds", for messages.
const inTime = (ms) => {
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    if (seconds < 60) return `in ${seconds} second${seconds === 1 ? "" : "s"}`;
    const minutes = Math.ceil(seconds / 60);
    return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
};

// Express middleware: 429 with Retry-After once a key is over its limit.
// `keys(req)` returns one key or several (e.g. per IP and per IP + account);
// every key counts the request, and any one over its limit stops it.
export const rateLimit = ({ windowMs, max, keys, message = "Too many requests" }) => {
    const limiter = createLimiter({ windowMs, max });
    return (req, res, next) => {
        const list = [keys(req)].flat();
        const results = list.map((key) => limiter.hit(key));
        const blocked = results.filter((result) => !result.allowed);
        if (blocked.length === 0) return next();
        const retryAfterMs = Math.max(...blocked.map((result) => result.retryAfterMs));
        res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
        throw new AppError(`${message}. Try again ${inTime(retryAfterMs)}.`, 429);
    };
};

// Who is asking: the logged-in user if known (after authMiddleware), else the IP.
export const byUser = (name) => (req) => `${name}:${req.user?.userId ?? req.ip}`;
export const byIp = (name) => (req) => `${name}:${req.ip}`;
