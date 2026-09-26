import { useEffect, useEffectEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeftIcon, MessagesSquareIcon, WifiOffIcon } from "lucide-react";
import api from "../api/api.js";
import socket from "../socket/socket.js";
import { useAuth } from "../auth/AuthContext.js";
import ConversationListItem from "../components/ConversationListItem.jsx";
import ConversationView from "../components/ConversationView.jsx";
import SafetyNumber from "../components/SafetyNumber.jsx";
import Avatar from "../components/Avatar.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toastManager } from "@/components/ui/toast";
import { useIsConnected } from "../socket/useIsConnected.js";
import { cn } from "@/lib/utils";
import UserSearch from "../components/UserSearch.jsx";

const getConversations = async () => (await api.get("/conversations")).data.conversations;

const Chat = () => {
  const { currentUser, logout } = useAuth();
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
  // The "not connected" banner waits a second: a quick reconnect shouldn't flash it.
  const [isOfflineLong, setIsOfflineLong] = useState(false);
  if (isConnected && isOfflineLong) setIsOfflineLong(false); // reset for the next drop
  const navigate = useNavigate();

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

  const retryConversations = () => {
    setListStatus("loading");
    setListAttempt((attempt) => attempt + 1);
  };

  // Live sidebar. For every message in any of our conversations, the server
  // sends { _id, lastMessage, lastMessageAt } to our personal room.
  // useEffectEvent: the listener is added once, but always sees the latest list.
  const onConversationUpdated = useEffectEvent((update) => {
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

    socket.on("conversationUpdated", handleConversationUpdated);
    socket.on("conversationRead", handleConversationRead);
    socket.io.on("reconnect", handleReconnect);
    return () => {
      socket.off("conversationUpdated", handleConversationUpdated);
      socket.off("conversationRead", handleConversationRead);
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
  const peer = conversations
    .find((conversation) => conversation._id === conversationId)
    ?.participants.find((participant) => participant._id !== currentUser._id);

  return (
    // The whole app fits the screen (dvh also follows mobile browser bars):
    // the page never scrolls, only the list and the messages do.
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
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
      <div className="flex min-h-0 flex-1">
        {/* Sidebar. Desktop: always visible. Mobile: only when no conversation
            is open (the URL decides, so the phone's back button just works). */}
        <aside
          aria-label="Chats"
          className={cn(
            "w-full flex-col border-border md:flex md:w-80 md:shrink-0 md:border-r",
            conversationId ? "hidden" : "flex",
          )}
        >
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-lg leading-tight">OpenChat</h1>
              <p className="truncate text-sm text-muted-foreground">Logged in as {currentUser.username}</p>
            </div>
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={logout}>
              Logout
            </Button>
          </header>

          <div className="border-b border-border px-4 py-3">
            <UserSearch onMessageUser={handleMessageUser} />
          </div>

          <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto p-2">
            <h2 className="sr-only">Conversations</h2>
            {listStatus === "loading" ? (
              // Skeletons only if loading takes longer than half a second.
              <div role="status" className="reveal-late">
                <span className="sr-only">Loading conversations...</span>
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <Skeleton className="size-10 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-1/3" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : listStatus === "error" ? (
              <div role="alert" className="px-3 py-8 text-center">
                <p className="font-medium">Couldn&apos;t load your chats</p>
                <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={retryConversations}>
                  Try again
                </Button>
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <p className="font-medium">No conversations yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Find someone above and send them a message.</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {conversations.map((conversation) => (
                  <ConversationListItem key={conversation._id} conversation={conversation} currentUserId={currentUser._id} />
                ))}
              </ul>
            )}
          </nav>
        </aside>

        {/* Open conversation. Mobile: shown instead of the sidebar. */}
        <main className={cn("min-w-0 flex-1 flex-col md:flex", conversationId ? "flex" : "hidden")}>
          {conversationId ? (
            <>
              <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
                <Button
                  render={<Link to="/chat" />}
                  variant="ghost"
                  size="icon"
                  className="-ml-2 md:hidden"
                  aria-label="Back to conversations"
                >
                  <ArrowLeftIcon aria-hidden="true" />
                </Button>
                {peer ? <Avatar name={peer.username} /> : null}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base leading-tight">{peer?.username ?? "Conversation"}</h2>
                  <SafetyNumber myPublicKey={currentUser.publicKey} peerPublicKey={peer?.publicKey} peerName={peer?.username} />
                </div>
              </header>
              <ConversationView
                key={conversationId}
                conversationId={conversationId}
                currentUser={currentUser}
                peerPublicKey={peer?.publicKey}
                peerName={peer?.username}
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
              <MessagesSquareIcon aria-hidden="true" className="size-10 opacity-60" />
              <p>Select a conversation to start chatting.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Chat;
