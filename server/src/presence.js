// Who is online, kept in memory: userId -> number of open sockets (one per
// tab or device). A flag in the database would stay "online" forever if the
// server crashed; this map simply starts empty and clients reconnect.
// Count 0 = the last tab just closed; the user stays online for a short grace
// period, because a page reload reconnects within a second or two.
const openSockets = new Map();
const offlineTimers = new Map();

// Returns true if the user just came online (was offline before).
export const socketOpened = (userId) => {
    clearTimeout(offlineTimers.get(userId));
    offlineTimers.delete(userId);
    const wasOnline = openSockets.has(userId);
    openSockets.set(userId, (openSockets.get(userId) ?? 0) + 1);
    return !wasOnline;
};

// When the user's last socket closes, waits graceMs and then, if they did
// not come back, marks them offline and calls onOffline().
export const socketClosed = (userId, graceMs, onOffline) => {
    const count = Math.max((openSockets.get(userId) ?? 1) - 1, 0);
    openSockets.set(userId, count);
    if (count > 0) return;

    offlineTimers.set(userId, setTimeout(() => {
        offlineTimers.delete(userId);
        if (openSockets.get(userId) === 0) {
            openSockets.delete(userId);
            onOffline();
        }
    }, graceMs));
};

export const isOnline = (userId) => openSockets.has(String(userId));
