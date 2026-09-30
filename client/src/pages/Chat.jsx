import { useEffect, useEffectEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowUpRightIcon, UsersRoundIcon, WifiOffIcon } from "lucide-react";
import api from "../api/api.js";
import socket from "../socket/socket.js";
import { useAuth } from "../auth/AuthContext.js";
import ConversationListItem from "../components/ConversationListItem.jsx";
import ConversationView from "../components/ConversationView.jsx";
import ChatHeader from "../components/ChatHeader.jsx";
import Masthead from "../components/Masthead.jsx";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toastManager } from "@/components/ui/toast";
import { useIsConnected } from "../socket/useIsConnected.js";
import { mergeReceipts } from "../lib/receipts.js";
import { useCall } from "../calls/CallContext.js";
import { titleWithUnread } from "../lib/notifications.js";
import { useConversationKey } from "../crypto/hooks.js";
import { unblockUser } from "../lib/blocks.js";
import { checkPeerKey, trustPeerKey } from "../crypto/keyPins.js";
import { cn } from "@/lib/utils";
import UserSearch from "../components/UserSearch.jsx";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { displayName } from "../lib/people.js";
import { useGroups } from "../hooks/useGroups.js";
import GroupInvites from "../components/GroupInvites.jsx";
import NewGroupSheet from "../components/NewGroupSheet.jsx";
import GroupListItem from "../components/GroupListItem.jsx";
import GroupChatHeader from "../components/GroupChatHeader.jsx";
import { useGroupCipher } from "../lib/groupCipher.js";
import { useGroupCall } from "../calls/GroupCallContext.js";

const getConversations = async () => (await api.get("/conversations")).data.conversations;

const Chat = () => {
  const { currentUser } = useAuth();
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
  const { isBusy: isInOneToOneCall, startCall } = useCall();
  const { isInGroupCall } = useGroupCall();
  const isInCall = isInOneToOneCall || isInGroupCall;
  // The "not connected" banner waits a second: a quick reconnect shouldn't flash it.
  const [isOfflineLong, setIsOfflineLong] = useState(false);
  if (isConnected && isOfflineLong) setIsOfflineLong(false); // reset for the next drop
  const navigate = useNavigate();
  // The search sits in the top bar on wider screens and above the list on
  // phones; only one copy is rendered.
  const isWide = useMediaQuery("(min-width: 768px)");
  // Phone: one pane at a time. The list is the main content when no
  // conversation is open, and the conversation's name is the page heading.
  const listIsMain = !isWide && !conversationId;
  const ListTag = listIsMain ? "main" : "aside";
  const PeerHeading = isWide ? "h2" : "h1";
  const [photos, setPhotos] = useState([]);
  // Groups: invites on top of the list; groups and 1:1 chats in one list,
  // newest first. A group opens as a chat like any other.
  const { groups, setGroups, invites, setInvites } = useGroups();
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  // A group just created opens once the "New group" sheet has closed.
  const [createdGroupId, setCreatedGroupId] = useState(null);
  // Who wrote in a group: its members by id (someone who left: "Former member").
  const nameOfIn = (group) => (userId) => {
    const member = group?.members.find((person) => person._id === userId);
    return member ? displayName(member) : "Former member";
  };
  const handleInviteAnswered = (inviteId) => setInvites((prev) => prev.filter((invite) => invite._id !== inviteId));
  const handleGroupCreated = (group) => {
    setNewGroupOpen(false);
    setGroups((prev) => [group, ...prev.filter((g) => g._id !== group._id)]);
    toastManager.add({
      type: "success",
      title: `“${group.name}” created`,
      description: `${group.invites.length === 1 ? "1 invite" : `${group.invites.length} invites`} sent. People join when they accept.`,
    });
    setCreatedGroupId(group._id);
  };

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
  const totalUnread = [...conversations, ...groups].reduce((sum, chat) => sum + (chat.unreadCount ?? 0), 0);
  // 1:1 chats and groups in one list, the newest message first. A new group
  // without messages counts from when it was made; a 1:1 chat nobody wrote in
  // yet goes last, as before.
  const sortTime = (chat) => new Date(chat.lastMessageAt ?? (chat.type === "group" ? chat.createdAt : 0)).getTime();
  const chats = [...conversations, ...groups].sort((a, b) => sortTime(b) - sortTime(a));

  const retryConversations = () => {
    setListStatus("loading");
    setListAttempt((attempt) => attempt + 1);
  };

  // Live sidebar. For every message in any of our conversations, the server
  // sends { _id, lastMessage, lastMessageAt, unreadCount } to our personal
  // room. (Alerts, notifications and "delivered" for it: MessageAlerts.)
  // useEffectEvent: the listener is added once, but always sees the latest list.
  const onConversationUpdated = useEffectEvent((update) => {
    if (groups.some((group) => group._id === update._id)) {
      setGroups((prev) => prev.map((group) => (group._id === update._id ? { ...group, ...update } : group)));
    } else if (conversations.some((conversation) => conversation._id === update._id)) {
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
      setGroups((prev) => prev.map((group) => (group._id === _id ? { ...group, unreadCount: 0 } : group)));
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
      const withReceipt = (chat) => (chat._id === id ? { ...chat, receipts: mergeReceipts(chat.receipts, { deliveredAt, readAt }) } : chat);
      setConversations((prev) => prev.map(withReceipt));
      setGroups((prev) => prev.map(withReceipt));
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
  }, [setGroups]);

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
        title: `Couldn't open the chat with ${displayName(user)}`,
        description: error.response?.data?.message ?? "Check your connection and try again.",
      });
    }
  };

  // The other participant in the open conversation (their public key is needed
  // for encryption). Undefined until the list has loaded, or if the
  // conversation isn't ours.
  const openConversation = conversations.find((conversation) => conversation._id === conversationId);
  const openGroup = groups.find((group) => group._id === conversationId);
  const groupCipher = useGroupCipher(openGroup?._id);
  const peer = openConversation?.participants.find((participant) => participant._id !== currentUser._id);
  const conversationKey = useConversationKey(conversationId, peer?.publicKey);
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
  const setBlockedByMe = (id, blocked) =>
    setConversations((prev) => prev.map((conversation) => (conversation._id === id ? { ...conversation, blockedByMe: blocked } : conversation)));
  const handleUnblock = async () => {
    try {
      await unblockUser(peer._id);
      setBlockedByMe(conversationId, false);
      toastManager.add({ type: "success", title: `Unblocked ${displayName(peer)}` });
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
      {/* Phones: an open chat gets the whole screen with its own top bar (like
          WhatsApp); the app bar is back on the list. */}
      {isWide || !conversationId ? <Masthead>{isWide ? <UserSearch inMasthead onMessageUser={handleMessageUser} /> : null}</Masthead> : null}
      <div
        className="grid min-h-0 flex-1 md:grid-cols-[320px_minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)]"
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
              <h1 className="text-[2.125rem] leading-none md:text-[2.75rem]">Chats</h1>
              {totalUnread > 0 ? (
                <span className="font-mono text-xs text-brand">{String(totalUnread).padStart(2, "0")} unread</span>
              ) : null}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm text-muted-foreground">Logged in as {currentUser.username}</p>
              <Button variant="outline" className="min-h-[44px] shrink-0 rounded-full px-4 sm:h-8 sm:min-h-0" onClick={() => setNewGroupOpen(true)}>
                <UsersRoundIcon aria-hidden="true" strokeWidth={1.4} />
                New group
              </Button>
            </div>
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
            <GroupInvites invites={invites} onAnswered={handleInviteAnswered} />
            <h2 className={invites.length ? "px-5 pt-4 pb-2 font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase md:px-7" : "sr-only"}>
              Chats
            </h2>
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
            ) : chats.length === 0 ? (
              <div className="border-t border-border px-7 py-8">
                <p className="font-heading text-xl">No conversations yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Find someone in the search and write to them.</p>
              </div>
            ) : (
              <ul className="flex flex-col border-b border-border">
                {chats.map((chat) =>
                  chat.type === "group" ? (
                    <GroupListItem key={chat._id} group={chat} currentUserId={currentUser._id} nameOf={nameOfIn(chat)} />
                  ) : (
                    <ConversationListItem key={chat._id} conversation={chat} currentUserId={currentUser._id} />
                  ),
                )}
              </ul>
            )}
          </nav>
        </ListTag>

        {/* Open conversation. Mobile: shown instead of the list. */}
        <main id={listIsMain ? undefined : "main"} className={cn("min-h-0 min-w-0 flex-col md:flex", conversationId ? "flex" : "hidden")}>
          {openGroup ? (
            <>
              <GroupChatHeader
                group={openGroup}
                currentUserId={currentUser._id}
                nameOf={nameOfIn(openGroup)}
                headingLevel={PeerHeading}
                callDisabled={!isConnected || isInCall}
              />
              <ConversationView
                key={conversationId}
                conversationId={conversationId}
                currentUser={currentUser}
                receipts={openGroup.receipts}
                group={{ name: openGroup.name, cipher: groupCipher, nameOf: nameOfIn(openGroup) }}
              />
            </>
          ) : conversationId ? (
            <>
              <ChatHeader
                peer={peer}
                currentUser={currentUser}
                conversationId={conversationId}
                conversationKey={conversationKey}
                photos={photos}
                blocked={blockedByMe}
                onBlockedChange={(blocked) => setBlockedByMe(conversationId, blocked)}
                headingLevel={PeerHeading}
                callDisabled={!peer?.publicKey || !isConnected || isInCall || blockedByMe || keyChanged}
                onCall={(media) => startCall({ conversationId, peer, media })}
              />
              <ConversationView
                key={conversationId}
                conversationId={conversationId}
                currentUser={currentUser}
                peerPublicKey={peer?.publicKey}
                peerName={displayName(peer)}
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

      </div>
      <NewGroupSheet
        open={newGroupOpen}
        onOpenChange={setNewGroupOpen}
        onClosed={() => {
          if (createdGroupId) navigate(`/chat/${createdGroupId}`);
          setCreatedGroupId(null);
        }}
        conversations={conversations}
        currentUserId={currentUser._id}
        onCreated={handleGroupCreated}
      />
    </div>
  );
};

export default Chat;
