import { useEffect, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import api from "../api/api.js";
import { useAuth } from "../auth/AuthContext.js";
import ConversationView from "../components/ConversationView.jsx";
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
