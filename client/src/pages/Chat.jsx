import { useEffect, useEffectEvent, useState } from "react";
import { useNavigate, useParams } from "react-router";
import api from "../api/api.js";
import socket from "../socket/socket.js";
import { useAuth } from "../auth/AuthContext.js";
import ConversationListItem from "../components/ConversationListItem.jsx";
import ConversationView from "../components/ConversationView.jsx";
import SafetyNumber from "../components/SafetyNumber.jsx";
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
    <div>
      <h1>Chat</h1>
      <p>
        Logged in as {currentUser.username}{" "}
        <button type="button" onClick={logout}>Logout</button>
      </p>

      <UserSearch onMessageUser={handleMessageUser} />

      <nav aria-label="Conversations">
        <h2>Conversations:</h2>

        {conversations.map((conversation) => (
          <ConversationListItem key={conversation._id} conversation={conversation} currentUserId={currentUser._id} />
        ))}
      </nav>

      {conversationId ? (
        <>
          <SafetyNumber myPublicKey={currentUser.publicKey} peerPublicKey={peer?.publicKey} peerName={peer?.username} />
          <ConversationView
            key={conversationId}
            conversationId={conversationId}
            currentUser={currentUser}
            peerPublicKey={peer?.publicKey}
          />
        </>
      ) : (
        <p>Select a conversation to start chatting.</p>
      )}
    </div>
  );
};

export default Chat;
