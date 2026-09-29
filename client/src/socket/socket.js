import { io } from "socket.io-client";
import { API_URL } from "../api/api.js";

const isVisible = () => document.visibilityState === "visible";
// This tab, for as long as the page is loaded.
const tabId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

// No address = this page's own site (see api.js).
// auth.visible: whether this app is on screen when it (re)connects; the
// server sends a push for a new message only when no app of the user is.
// auth.tabId: the server closes an older socket of this same tab.
const socket = io(API_URL || undefined,
    {
        withCredentials: true,
        autoConnect: false,
        // WebSocket first: when the page closes or reloads, the server notices
        // at once. A long-polling start would linger there for ~45 s (until
        // its ping times out), still counted as on screen. Polling stays as
        // the fallback for networks that block WebSockets.
        transports: ["websocket", "polling"],
        tryAllTransports: true,
        auth: (callback) => callback({ visible: isVisible(), tabId }),
    }
);

// Tab switched, window minimised, phone locked or back: tell the server.
document.addEventListener("visibilitychange", () => {
    if (socket.connected) socket.emit("appVisible", isVisible());
});
// The tab is closing: say so at once. The server may only notice the lost
// connection much later, and would keep holding back pushes until then.
window.addEventListener("pagehide", () => {
    if (socket.connected) socket.emit("appVisible", false);
});

socket.on("connect", () => {
    console.log("Connected to server with ID:", socket.id);
});

socket.on("disconnect", () => {
    console.log("Disconnected from server", socket.id);
});

export default socket;
