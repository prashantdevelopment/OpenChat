import { useEffect, useEffectEvent, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router";
import api from "../api/api.js";
import socket from "../socket/socket.js";
import { useAuth } from "../auth/AuthContext.js";
import { getConversationKey } from "../crypto/hooks.js";
import { decryptMessage } from "../crypto/messages.js";
import { describeMessage } from "../lib/messageContent.js";
import { getNotificationPrefs, playChime, setAppBadge, shouldNotify } from "../lib/notifications.js";
import { displayName } from "../lib/people.js";
import { getGroupCipher } from "../lib/groupCipher.js";
import { isMutedNow } from "../lib/mute.js";
import { toastManager } from "@/components/ui/toast";
import { UnreadContext } from "./UnreadContext.js";

const TYPE_LABELS = { image: "Photo", video: "Video", audio: "Voice message", file: "File", call: "Call" };

// chat id -> { unreadCount, peer } for 1:1 chats, { unreadCount, group } for groups.
const fetchChats = async (myId) => {
  const [chats, groups] = await Promise.all([api.get("/conversations"), api.get("/groups")]);
  return Object.fromEntries([
    ...chats.data.conversations.map((c) => [c._id, { unreadCount: c.unreadCount ?? 0, peer: c.participants.find((p) => p._id !== myId), mutedUntil: c.mutedUntil }]),
    ...groups.data.groups.map((g) => [g._id, { unreadCount: g.unreadCount ?? 0, group: g, mutedUntil: g.mutedUntil }]),
  ]);
};

// New-message alerts on every page of the app (chat, Discover, Settings,
// profiles), not only the chat page:
// - OpenChat is in front: a small alert at the top ("Riya · New message",
//   "Open") and a soft chime, unless that chat or the chat list is on screen
//   (the message is visible there anyway);
// - OpenChat is in the background: a browser notification, if turned on;
// - the unread total: in every tab title (UnreadContext → PageMeta) and on the
//   installed app's icon;
// - "delivered" ticks for the sender, wherever the app is open.
// The message text is decrypted here, in the browser, only to show it.
const MessageAlerts = ({ children }) => {
  const { currentUser, privateKey } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // conversation id -> { unreadCount, peer }
  const [chats, setChats] = useState({});


  // What the alert says: the text if previews are on, else the kind of message.
  const describe = async (update, chat, preview) => {
    const fallback = TYPE_LABELS[update.lastMessage.messageType] ?? "New message";
    if (!preview || !privateKey || (!chat?.group && !chat?.peer?.publicKey)) return fallback;
    try {
      const { lastMessage } = update;
      const text = chat.group
        ? await getGroupCipher(currentUser, privateKey, update._id).decrypt(lastMessage, lastMessage.sender)
        : await decryptMessage(await getConversationKey(privateKey, chat.peer.publicKey, update._id), lastMessage, lastMessage.sender);
      return describeMessage(lastMessage.messageType, text);
    } catch {
      return fallback; // can't decrypt: say what kind it is
    }
  };
  // Title and text: a group names itself and who wrote ("Goa trip" · "Riya: Photo").
  const alertFor = async (update, chat, preview) => {
    const body = await describe(update, chat, preview);
    if (!chat?.group) return { title: displayName(chat?.peer) || "Someone", body };
    const sender = chat.group.members.find((member) => member._id === update.lastMessage.sender);
    return { title: chat.group.name, body: `${displayName(sender) || "Someone"}: ${body}` };
  };

  const onUpdate = useEffectEvent(async (update) => {
    setChats((prev) => ({ ...prev, [update._id]: { ...prev[update._id], unreadCount: update.unreadCount ?? prev[update._id]?.unreadCount ?? 0 } }));
    if (!update.lastMessage || update.lastMessage.sender === currentUser._id) return;
    // This device has the message: the sender's ticks turn double.
    socket.emit("markDelivered", update._id);

    // A first message from someone new (or a new group): fetch who they are.
    let chat = chats[update._id];
    if (!chat?.peer && !chat?.group) {
      const fresh = await fetchChats(currentUser._id).catch(() => null);
      if (fresh) setChats(fresh);
      chat = fresh?.[update._id];
    }
    if (isMutedNow(chat?.mutedUntil)) return; // muted: no alert, no sound
    const prefs = getNotificationPrefs();
    const inFront = document.visibilityState === "visible" && document.hasFocus();

    if (inFront) {
      const openChatId = matchPath("/chat/:conversationId", location.pathname)?.params.conversationId;
      if (openChatId === update._id || location.pathname === "/chat") return;
      if (prefs.sound) playChime();
      const { title, body } = await alertFor(update, chat, prefs.preview);
      toastManager.add({
        title,
        description: body,
        actionProps: { children: "Open", onClick: () => navigate(`/chat/${update._id}`) },
      });
      return;
    }
    if (!("Notification" in window) || !shouldNotify({ ...prefs, permission: Notification.permission, isPageActive: false })) return;
    // tag: one notification per chat, a newer one replaces it.
    const { title, body } = await alertFor(update, chat, prefs.preview);
    const notification = new Notification(title, { body, tag: update._id, icon: "/icon-192.png" });
    notification.onclick = () => {
      window.focus();
      navigate(`/chat/${update._id}`);
      notification.close();
    };
  });

  useEffect(() => {
    let ignore = false;
    const load = () =>
      fetchChats(currentUser._id)
        .then((next) => !ignore && setChats(next))
        .catch((error) => console.error("Could not load chats for alerts:", error));
    load();
    const handleUpdate = (update) => onUpdate(update);
    const handleRead = ({ _id }) => setChats((prev) => (prev[_id] ? { ...prev, [_id]: { ...prev[_id], unreadCount: 0 } } : prev));
    const handleReconnect = () => load(); // updates sent while offline are lost
    socket.on("conversationUpdated", handleUpdate);
    socket.on("conversationRead", handleRead);
    socket.on("blocksChanged", handleReconnect);
    socket.on("groupsChanged", handleReconnect);
    socket.on("groupDeleted", handleReconnect); // its unread count goes too
    const handleMute = ({ conversationId, mutedUntil }) =>
      setChats((prev) => (prev[conversationId] ? { ...prev, [conversationId]: { ...prev[conversationId], mutedUntil } } : prev));
    socket.on("muteChanged", handleMute);
    // A deleted message isn't unread any more (no alert: it's gone).
    const handleDeleted = ({ conversationId, unreadCount }) =>
      setChats((prev) => (prev[conversationId] ? { ...prev, [conversationId]: { ...prev[conversationId], unreadCount } } : prev));
    socket.on("messageDeleted", handleDeleted);
    socket.io.on("reconnect", handleReconnect);
    return () => {
      ignore = true;
      socket.off("groupsChanged", handleReconnect);
      socket.off("groupDeleted", handleReconnect);
      socket.off("muteChanged", handleMute);
      socket.off("messageDeleted", handleDeleted);
      socket.off("conversationUpdated", handleUpdate);
      socket.off("conversationRead", handleRead);
      socket.off("blocksChanged", handleReconnect);
      socket.io.off("reconnect", handleReconnect);
    };
  }, [currentUser._id]);

  const unread = Object.values(chats).reduce((sum, chat) => sum + (chat.unreadCount ?? 0), 0);
  useEffect(() => {
    setAppBadge(unread);
  }, [unread]);
  // Logging out: no number left on the icon.
  useEffect(() => () => setAppBadge(0), []);

  return <UnreadContext value={unread}>{children}</UnreadContext>;
};

export default MessageAlerts;
