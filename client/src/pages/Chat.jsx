import { useEffect, useState } from "react";
import { NavLink, useParams } from "react-router";
import api from "../api/api.js";
import { useAuth } from "../auth/AuthContext.js";
import ConversationView from "../components/ConversationView.jsx";

const Chat = () => {
  const { currentUser, logout } = useAuth();
  // The open conversation lives in the URL (/chat/:conversationId), so
  // refresh, back/forward and shared links all keep it.
  const { conversationId } = useParams();
  const [conversations, setConversations] = useState([]);

  // Fetch conversations
  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const response = await api.get("/conversations");

        setConversations(response.data.conversations);
      } catch (error) {
        console.error("Error fetching conversations:", error);
      }
    };

    fetchConversations();
  }, []);

  return (
    <div>
      <h1>Chat</h1>
      <p>
        Logged in as {currentUser.username}{" "}
        <button type="button" onClick={logout}>Logout</button>
      </p>

      <nav aria-label="Conversations">
        <h2>Conversations:</h2>

        {conversations.map((conversation) => {
          const otherParticipant = conversation.participants.find(
            (participant) => participant._id !== currentUser._id,
          );

          return (
            <p key={conversation._id}>
              {/* NavLink marks the open conversation with aria-current="page". */}
              <NavLink
                to={`/chat/${conversation._id}`}
                style={({ isActive }) => ({ fontWeight: isActive ? "bold" : "normal" })}
              >
                {otherParticipant?.username}
              </NavLink>
            </p>
          );
        })}
      </nav>

      {conversationId ? (
        <ConversationView key={conversationId} conversationId={conversationId} currentUser={currentUser} />
      ) : (
        <p>Select a conversation to start chatting.</p>
      )}
    </div>
  );
};

export default Chat;
