import { useEffect, useEffectEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeftIcon } from "lucide-react";
import api from "../api/api.js";
import socket from "../socket/socket.js";
import { useAuth } from "../auth/AuthContext.js";
import ConversationListItem from "../components/ConversationListItem.jsx";
import ConversationView from "../components/ConversationView.jsx";
import SafetyNumber from "../components/SafetyNumber.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import UserSearch from "../components/UserSearch.jsx";

const getConversations = async () => (await api.get("/conversations")).data.conversations;

const Chat = () => {
  const { currentUser, logout } = useAuth();
  // The open conversation lives in the URL (/chat/:conversationId), so
  // refresh, back/forward and shared links all keep it.
  const { conversationId } = useParams();
  const [conversations, setConversations] = useState([]);
  const navigate = useNavigate();

  // Fetch conversations
  useEffect(() => {
    getConversations()
      .then(setConversations)
      .catch((error) => console.error("Error fetching conversations:", error));
  }, []);

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
    <div className="flex h-dvh overflow-hidden bg-background">
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
          {conversations.map((conversation) => (
            <ConversationListItem key={conversation._id} conversation={conversation} currentUserId={currentUser._id} />
          ))}
        </nav>
      </aside>

      {/* Open conversation. Mobile: shown instead of the sidebar. */}
      <main className={cn("min-w-0 flex-1 flex-col md:flex", conversationId ? "flex" : "hidden")}>
        {conversationId ? (
          <>
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                render={<Link to="/chat" />}
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Back to conversations"
              >
                <ArrowLeftIcon aria-hidden="true" />
              </Button>
              <h2 className="min-w-0 flex-1 truncate text-lg">{peer?.username ?? "Conversation"}</h2>
            </header>
            <div className="border-b border-border px-4 py-2 text-sm">
              <SafetyNumber myPublicKey={currentUser.publicKey} peerPublicKey={peer?.publicKey} peerName={peer?.username} />
            </div>
            <ConversationView
              key={conversationId}
              conversationId={conversationId}
              currentUser={currentUser}
              peerPublicKey={peer?.publicKey}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-muted-foreground">
            <p>Select a conversation to start chatting.</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Chat;
