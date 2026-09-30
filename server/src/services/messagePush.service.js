import User from "../models/user.model.js";
import Conversation from "../models/conversation.model.js";
import { isMuted } from "./conversation.service.js";
import { sendPush } from "./push.service.js";

// Push for a new message (step 64; groups and muting: step 72): to each other participant who isn't
// looking at OpenChat anywhere (no tab or app on screen: the in-app alert
// covers that). What it says: who it is from (unless they chose not to show
// it) and the kind of message, never the text: it is end-to-end encrypted and
// the server can't read it. One notification per chat (same tag and topic, a
// newer replaces it), and at most one per chat every few seconds: a burst of
// messages ends in one notification ("3 new messages").

const KINDS = { image: "Photo", video: "Video", audio: "Voice message", file: "File" };
const bodyFor = (messageType, unread) => (unread > 1 ? `${unread} new messages` : KINDS[messageType] ?? "New message");

// hasVisibleApp(userId): is OpenChat on this user's screen somewhere (socket.js).
export const createMessagePush = ({ hasVisibleApp, throttleMs = 10_000 }) => {
    const recent = new Map(); // `${recipient}:${conversation}` -> { sentAt, timer, latest }

    const send = async ({ recipientId, conversationId, senderId, messageType, unread }) => {
        // Looking at it by now (opened the app during the wait): nothing to do.
        if (await hasVisibleApp(recipientId)) return;
        const [sender, recipient, chat] = await Promise.all([
            User.findById(senderId).select("name username").lean(),
            User.findById(recipientId).select("pushShowSender").lean(),
            Conversation.findById(conversationId).select("type name mutedUntil"),
        ]);
        if (!sender || !recipient || !chat) return;
        // Muted meanwhile (the push waited for the end of a burst).
        if (isMuted(chat, recipientId)) return;
        const showSender = recipient.pushShowSender !== false;
        const senderName = sender.name || sender.username;
        const kind = bodyFor(messageType, unread);
        // A group: its name, and who wrote ("Riya: Photo"); with senders hidden, neither.
        const title = chat.type === "group" ? (showSender ? chat.name : "OpenChat") : showSender ? senderName : "OpenChat";
        const body = chat.type === "group" ? (showSender ? `${senderName}: ${kind}` : `${kind} in a group`) : kind;
        await sendPush(
            recipientId,
            {
                title,
                body,
                url: `/chat/${conversationId}`,
                tag: conversationId,
            },
            // high: Android delivers it at once, also in battery saving; a day to arrive.
            { urgency: "high", topic: conversationId, ttlSeconds: 24 * 60 * 60 },
        );
    };

    // After a message was saved and sent live. unreadCounts[i] belongs to
    // conversation.participants[i]. Call records are left out (calls: step 65).
    return (conversation, message, unreadCounts) => {
        if (message.messageType === "call") return;
        const conversationId = String(conversation._id);
        const senderId = String(message.sender);
        conversation.participants.forEach(async (participant, i) => {
            const recipientId = String(participant);
            if (recipientId === senderId) return;
            if (isMuted(conversation, recipientId)) return; // muted by them
            // Seen on screen as it arrived: never pushed, not even later
            // (leaving the app a moment after must not bring it up again).
            if (await hasVisibleApp(recipientId).catch(() => false)) return;
            const job = { recipientId, conversationId, senderId, messageType: message.messageType, unread: unreadCounts[i] };
            const key = `${recipientId}:${conversationId}`;
            const entry = recent.get(key);
            const now = Date.now();
            const run = (next) => send(next).catch((error) => console.error("Message push failed:", error.message));
            if (!entry || now - entry.sentAt >= throttleMs) {
                recent.set(key, { sentAt: now, timer: null, latest: null });
                run(job);
                return;
            }
            // Within the window: one more push at its end, with the latest count.
            entry.latest = job;
            entry.timer ??= setTimeout(() => {
                recent.set(key, { sentAt: Date.now(), timer: null, latest: null });
                run(entry.latest);
            }, entry.sentAt + throttleMs - now);
            entry.timer.unref?.();
        });
        // Forget old entries now and then (memory stays small).
        if (recent.size > 5000) {
            const cutoff = Date.now() - throttleMs;
            for (const [k, v] of recent) if (v.sentAt < cutoff && !v.timer) recent.delete(k);
        }
    };
};
