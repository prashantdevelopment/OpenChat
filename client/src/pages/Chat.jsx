import { useEffect, useEffectEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeftIcon, ArrowUpRightIcon, PhoneIcon, VideoIcon, WifiOffIcon } from "lucide-react";
import api from "../api/api.js";
import socket from "../socket/socket.js";
import { useAuth } from "../auth/AuthContext.js";
import ConversationListItem from "../components/ConversationListItem.jsx";
import ConversationView from "../components/ConversationView.jsx";
import SafetyNumber from "../components/SafetyNumber.jsx";
import Masthead from "../components/Masthead.jsx";
import MarginNotes from "../components/MarginNotes.jsx";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toastManager } from "@/components/ui/toast";
import { useIsConnected } from "../socket/useIsConnected.js";
import { formatLastSeen } from "../lib/time.js";
import { mergeReceipts } from "../lib/receipts.js";
import { useCall } from "../calls/CallContext.js";
import { getNotificationPrefs, shouldNotify, titleWithUnread } from "../lib/notifications.js";
import { getConversationKey, useConversationKey } from "../crypto/hooks.js";
import { decryptMessage } from "../crypto/messages.js";
import { describeMessage } from "../lib/messageContent.js";
import { unblockUser } from "../lib/blocks.js";
import { checkPeerKey, trustPeerKey } from "../crypto/keyPins.js";
import { cn } from "@/lib/utils";
import UserSearch from "../components/UserSearch.jsx";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { INDIAN_STATES } from "../../../shared/indian-states.js";

const stateName = (code) => INDIAN_STATES.find((state) => state.code === code)?.name;

const getConversations = async () => (await api.get("/conversations")).data.conversations;

const Chat = () => {
  const { currentUser, privateKey } = useAuth();
  // The open conversation lives in the URL (/chat/:conversationId), so
  // refresh, back/forward and shared links all keep it.
  const { conversationId } = useParams();
  const [conversations, setConversations] = useState([]);
  // "loading" | "ready" | "error". "No conversations yet" only once we know it
  // is true, not while loading or after a failure.
  const [listStatus, setListStatus] = useState("loading");
  // Bumped by "Try again" to run the loading effect once more.
  const [listAttempt, setListAttempt] = useState(0);
  const isConnected = useIsConnected();
  const { isBusy: isInCall, startCall } = useCall();
  // The "not connected" banner waits a second: a quick reconnect shouldn't flash it.
  const [isOfflineLong, setIsOfflineLong] = useState(false);
  if (isConnected && isOfflineLong) setIsOfflineLong(false); // reset for the next drop
  const navigate = useNavigate();
  // The search sits in the top bar on wider screens and above the list on
  // phones; only one copy is rendered. The margin notes need a wide screen.
  const isWide = useMediaQuery("(min-width: 768px)");
  const isExtraWide = useMediaQuery("(min-width: 1280px)");
  // Phone: one pane at a time. The list is the main content when no
  // conversation is open, and the conversation's name is the page heading.
  const listIsMain = !isWide && !conversationId;
  const ListTag = listIsMain ? "main" : "aside";
  const PeerHeading = isWide ? "h2" : "h1";
  const [photos, setPhotos] = useState([]);

  // Fetch conversations
  useEffect(() => {
    let ignore = false;
    getConversations()
      .then((list) => {
        if (ignore) return;
        setConversations(list);
        setListStatus("ready");
      })
      .catch((error) => {
        console.error("Error fetching conversations:", error);
        if (!ignore) setListStatus("error");
      });
    return () => {
      ignore = true;
    };
  }, [listAttempt]);

  useEffect(() => {
    if (isConnected) return;
    const timer = setTimeout(() => setIsOfflineLong(true), 1000);
    return () => clearTimeout(timer);
  }, [isConnected]);

  // Unread messages in the tab title, e.g. "(3) OpenChat", seen from other tabs.
  const totalUnread = conversations.reduce((sum, conversation) => sum + (conversation.unreadCount ?? 0), 0);

  const retryConversations = () => {
    setListStatus("loading");
    setListAttempt((attempt) => attempt + 1);
  };

  // Live sidebar. For every message in any of our conversations, the server
  // sends { _id, lastMessage, lastMessageAt } to our personal room.
  // useEffectEvent: the listener is added once, but always sees the latest list.
  // Browser notification for someone else's new message, if the user turned
  // them on and isn't looking at OpenChat. The text is decrypted here; the
  // server never sees it. tag: one notification per chat, even with several
  // tabs open (a newer one replaces it).
  const notifyNewMessage = async (update) => {
    const prefs = getNotificationPrefs();
    const isPageActive = document.visibilityState === "visible" && document.hasFocus();
    if (!("Notification" in window) || !shouldNotify({ ...prefs, permission: Notification.permission, isPageActive })) return;

    const sender = conversations
      .find((conversation) => conversation._id === update._id)
      ?.participants.find((participant) => participant._id !== currentUser._id);
    let body = { image: "Photo", video: "Video", audio: "Voice message", file: "File", call: "Call" }[update.lastMessage.messageType] ?? "New message";
    if (prefs.preview && sender?.publicKey && privateKey) {
      try {
        const key = await getConversationKey(privateKey, sender.publicKey, update._id);
        body = describeMessage(update.lastMessage.messageType, await decryptMessage(key, update.lastMessage, update.lastMessage.sender));
      } catch {
        // Can't decrypt: keep "New message".
      }
    }
    const notification = new Notification(sender?.username ?? "OpenChat", { body, tag: update._id, icon: "/icon-192.png" });
    notification.onclick = () => {
      window.focus();
      navigate(`/chat/${update._id}`);
      notification.close();
    };
  };

  const onConversationUpdated = useEffectEvent((update) => {
    // Someone else's new message reached this device: "delivered" (the
    // sender's ticks turn double).
    if (update.lastMessage && update.lastMessage.sender !== currentUser._id) {
      socket.emit("markDelivered", update._id);
      notifyNewMessage(update).catch((error) => console.error("Could not show a notification:", error));
    }
    if (conversations.some((conversation) => conversation._id === update._id)) {
      // Known conversation: new preview, and move it to the top.
      setConversations((prev) => {
        const current = prev.find((conversation) => conversation._id === update._id);
        if (!current) return prev;
        return [{ ...current, ...update }, ...prev.filter((conversation) => conversation !== current)];
      });
    } else {
      // Someone started a conversation with us: the update has no participant
      // names, so reload the list (this only happens on a first message).
      getConversations()
        .then(setConversations)
        .catch((error) => console.error("Error fetching conversations:", error));
    }
  });

  useEffect(() => {
    const handleConversationUpdated = (update) => onConversationUpdated(update);
    // Updates sent while we were offline are lost, so reload after a reconnect.
    // ("reconnect" fires only on reconnection, not on the first connect.)
    const handleReconnect = () => {
      getConversations()
        .then(setConversations)
        .catch((error) => console.error("Error fetching conversations:", error));
    };

    // Read in any of our tabs: clear that conversation's badge (no reordering).
    const handleConversationRead = ({ _id }) => {
      setConversations((prev) =>
        prev.map((conversation) => (conversation._id === _id ? { ...conversation, unreadCount: 0 } : conversation)),
      );
    };

    // A contact came online or went offline (the server only tells us about
    // people we share a conversation with).
    const handlePresence = ({ userId, online, lastSeen }) => {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.participants.some((participant) => participant._id === userId)
            ? {
                ...conversation,
                participants: conversation.participants.map((participant) =>
                  participant._id === userId ? { ...participant, online, lastSeen: lastSeen ?? participant.lastSeen } : participant,
                ),
              }
            : conversation,
        ),
      );
    };

    // The other person received / read a conversation: new ticks on my messages.
    const handleReceipt = ({ conversationId: id, deliveredAt, readAt }) => {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation._id === id ? { ...conversation, receipts: mergeReceipts(conversation.receipts, { deliveredAt, readAt }) } : conversation,
        ),
      );
    };

    socket.on("conversationUpdated", handleConversationUpdated);
    socket.on("receipt", handleReceipt);
    socket.on("presence", handlePresence);
    socket.on("conversationRead", handleConversationRead);
    // I blocked or unblocked someone (in any tab): fresh list, with blockedByMe.
    socket.on("blocksChanged", handleReconnect);
    socket.io.on("reconnect", handleReconnect);
    return () => {
      socket.off("conversationUpdated", handleConversationUpdated);
      socket.off("receipt", handleReceipt);
      socket.off("presence", handlePresence);
      socket.off("conversationRead", handleConversationRead);
      socket.off("blocksChanged", handleReconnect);
      socket.io.off("reconnect", handleReconnect);
    };
  }, []);

  // "Message" on a search result: get (or create) the conversation and open it.
  const handleMessageUser = async (user) => {
    try {
      const response = await api.post("/conversations", { otherUserId: user._id });
      const id = response.data.conversation._id;

      // A brand-new conversation isn't in the sidebar yet: reload the list.
      if (!conversations.some((conversation) => conversation._id === id)) {
        setConversations(await getConversations());
      }
      navigate(`/chat/${id}`);
    } catch (error) {
      console.error("Could not start the conversation:", error);
      toastManager.add({
        type: "error",
        title: `Couldn't open the chat with ${user.username}`,
        description: error.response?.data?.message ?? "Check your connection and try again.",
      });
    }
  };

  // The other participant in the open conversation (their public key is needed
  // for encryption). Undefined until the list has loaded, or if the
  // conversation isn't ours.
  const openConversation = conversations.find((conversation) => conversation._id === conversationId);
  const peer = openConversation?.participants.find((participant) => participant._id !== currentUser._id);
  const conversationKey = useConversationKey(conversationId, peer?.publicKey);
  const place = stateName(peer?.state);
  // Is this the key this device saw for them before? (crypto/keyPins.js)
  const [keyCheck, setKeyCheck] = useState({ publicKey: null, status: null });
  useEffect(() => {
    if (!peer?.publicKey) return;
    let ignore = false;
    checkPeerKey(currentUser._id, peer._id, peer.publicKey).then((status) => !ignore && setKeyCheck({ publicKey: peer.publicKey, status }));
    return () => {
      ignore = true;
    };
  }, [currentUser._id, peer?._id, peer?.publicKey]);
  const keyChanged = keyCheck.publicKey === peer?.publicKey && keyCheck.status === "changed";
  const trustNewKey = async () => {
    await trustPeerKey(currentUser._id, peer._id, peer.publicKey);
    setKeyCheck({ publicKey: peer.publicKey, status: "same" });
  };

  // Only the blocker is told about a block (server: conversation.service.js).
  const blockedByMe = Boolean(openConversation?.blockedByMe);
  const handleUnblock = async () => {
    try {
      await unblockUser(peer._id);
      setConversations((prev) => prev.map((conversation) => (conversation._id === conversationId ? { ...conversation, blockedByMe: false } : conversation)));
      toastManager.add({ type: "success", title: `Unblocked ${peer.username}` });
    } catch (error) {
      toastManager.add({ type: "error", title: "Couldn't unblock", description: error.response?.data?.message ?? "Check your connection and try again." });
    }
  };

  return (
    // The whole app fits the screen (dvh also follows mobile browser bars):
    // the page never scrolls, only the list and the messages do.
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* React keeps the title in the head (and hands it to the next page). */}
      <title>{titleWithUnread(totalUnread)}</title>
      <meta name="robots" content="noindex" />
      {/* The status region is always there; screen readers announce the text
          when it is added. */}
      <div role="status" className="shrink-0">
        {!isConnected && isOfflineLong ? (
          <p className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-1.5 text-sm text-foreground">
            <WifiOffIcon aria-hidden="true" className="size-4 text-warning-foreground" />
            Not connected. Trying to reconnect...
          </p>
        ) : null}
      </div>
      <Masthead>{isWide ? <UserSearch inMasthead onMessageUser={handleMessageUser} /> : null}</Masthead>
      <div
        className={cn(
          "grid min-h-0 flex-1 md:grid-cols-[320px_minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)]",
          isExtraWide && peer && "xl:grid-cols-[360px_minmax(0,1fr)_290px]",
        )}
      >
        {/* The list. Desktop: always visible. Mobile: only when no conversation
            is open (the URL decides, so the phone's back button just works). */}
        <ListTag
          id={listIsMain ? "main" : undefined}
          aria-label="Chats"
          className={cn("min-h-0 flex-col md:flex md:border-r md:border-border", conversationId ? "hidden" : "flex")}
        >
          <div className="px-5 pt-6 pb-4 md:px-7">
            <div className="flex items-baseline justify-between gap-3">
              <h1 className="text-[44px] leading-none">Chats</h1>
              {totalUnread > 0 ? (
                <span className="font-mono text-xs text-brand">{String(totalUnread).padStart(2, "0")} unread</span>
              ) : null}
            </div>
            <p className="mt-2 truncate text-sm text-muted-foreground">Logged in as {currentUser.username}</p>
            {isWide ? null : (
              <div className="mt-4 flex flex-col gap-3">
                <UserSearch onMessageUser={handleMessageUser} />
                <Link to="/discover" className="inline-flex items-center gap-1.5 self-start text-sm text-foreground sm:hidden">
                  Discover India
                  <ArrowUpRightIcon aria-hidden="true" strokeWidth={1.4} className="size-4" />
                </Link>
              </div>
            )}
          </div>

          <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto">
            <h2 className="sr-only">Conversations</h2>
            {listStatus === "loading" ? (
              // Skeletons only if loading takes longer than half a second.
              <div role="status" className="reveal-late">
                <span className="sr-only">Loading conversations...</span>
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="space-y-2 border-t border-border px-7 py-4">
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                ))}
              </div>
            ) : listStatus === "error" ? (
              <div role="alert" className="border-t border-border px-7 py-8 text-center">
                <p className="font-heading text-xl">Couldn&apos;t load your chats</p>
                <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
                <Button variant="outline" size="sm" className="mt-3 rounded-full" onClick={retryConversations}>
                  Try again
                </Button>
              </div>
            ) : conversations.length === 0 ? (
              <div className="border-t border-border px-7 py-8">
                <p className="font-heading text-xl">No conversations yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Find someone in the search and write to them.</p>
              </div>
            ) : (
              <ul className="flex flex-col border-b border-border">
                {conversations.map((conversation) => (
                  <ConversationListItem key={conversation._id} conversation={conversation} currentUserId={currentUser._id} />
                ))}
              </ul>
            )}
          </nav>
        </ListTag>

        {/* Open conversation. Mobile: shown instead of the list. */}
        <main id={listIsMain ? undefined : "main"} className={cn("min-h-0 min-w-0 flex-col md:flex", conversationId ? "flex" : "hidden")}>
          {conversationId ? (
            <>
              {/* Grid: on phones the status line gets its own full-width row under
                  the name and buttons; from 768px it sits under the name. */}
              <header className="grid grid-flow-row-dense grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 border-b border-border px-5 pt-5 pb-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end md:gap-x-4.5 md:gap-y-0 md:px-9 md:pt-6.5">
                <Button
                  render={<Link to="/chat" />}
                  variant="ghost"
                  size="icon"
                  className="-ml-2 self-center md:hidden"
                  aria-label="Back to conversations"
                >
                  <ArrowLeftIcon aria-hidden="true" strokeWidth={1.4} />
                </Button>
                {/* The name set large, in the italic serif, like a byline. */}
                <PeerHeading className="min-w-0 truncate pb-1 font-heading text-4xl leading-[0.95] italic md:text-[52px]">
                    {peer ? (
                      <Link to={`/u/${peer.username}`} className="text-inherit no-underline hover:underline hover:decoration-1 hover:underline-offset-4">
                        {peer.username}
                      </Link>
                    ) : (
                      "Conversation"
                    )}
                  </PeerHeading>
                  <div className="col-span-full flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11.5px] tracking-[0.14em] text-muted-foreground uppercase md:col-span-1 md:col-start-1 md:mt-2">
                    {peer?.online ? (
                      <span className="text-success">
                        <span aria-hidden="true">● </span>Online
                      </span>
                    ) : peer?.lastSeen ? (
                      <span>{formatLastSeen(peer.lastSeen)}</span>
                    ) : null}
                    {place ? (
                      <>
                        {peer?.online || peer?.lastSeen ? <span aria-hidden="true">·</span> : null}
                        <span>{place}</span>
                      </>
                    ) : null}
                    {peer?.online || peer?.lastSeen || place ? <span aria-hidden="true">·</span> : null}
                    <SafetyNumber
                      myPublicKey={currentUser.publicKey}
                      peerPublicKey={peer?.publicKey}
                      peerName={peer?.username}
                      className="font-mono text-[11.5px] tracking-[0.14em] uppercase"
                    />
                  </div>
                <Button
                  variant="outline"
                  size="icon-xl"
                  className="size-11.5 rounded-full border-foreground sm:size-11.5 md:row-span-2 md:self-end"
                  aria-label={`Voice call ${peer?.username ?? ""}`.trim()}
                  disabled={!peer?.publicKey || !isConnected || isInCall || blockedByMe || keyChanged}
                  onClick={() => startCall({ conversationId, peer, media: "audio" })}
                >
                  <PhoneIcon aria-hidden="true" strokeWidth={1.3} />
                </Button>
                <Button
                  size="icon-xl"
                  className="size-11.5 rounded-full sm:size-11.5 md:row-span-2 md:self-end"
                  aria-label={`Video call ${peer?.username ?? ""}`.trim()}
                  disabled={!peer?.publicKey || !isConnected || isInCall || blockedByMe || keyChanged}
                  onClick={() => startCall({ conversationId, peer, media: "video" })}
                >
                  <VideoIcon aria-hidden="true" strokeWidth={1.3} />
                </Button>
              </header>
              <ConversationView
                key={conversationId}
                conversationId={conversationId}
                currentUser={currentUser}
                peerPublicKey={peer?.publicKey}
                peerName={peer?.username}
                receipts={openConversation?.receipts}
                onPhotosChange={setPhotos}
                blocked={blockedByMe}
                onUnblock={handleUnblock}
                keyChanged={keyChanged}
                onTrustKey={trustNewKey}
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="font-heading text-4xl italic">Pick a conversation</p>
              <p className="max-w-xs text-muted-foreground">Or find someone new in the search, or across India in Discover.</p>
            </div>
          )}
        </main>

        {isExtraWide && conversationId && peer ? (
          <MarginNotes peer={peer} myPublicKey={currentUser.publicKey} conversationKey={conversationKey} photos={photos} />
        ) : null}
      </div>
    </div>
  );
};

export default Chat;
