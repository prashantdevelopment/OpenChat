import { useEffect, useState } from "react";
import socket from "../socket/socket.js";
import api from "../api/api.js";

const Chat = ({ currentUser, onLogout }) => {
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [messageInput, setMessageInput] = useState("");

  // Receive real-time messages
  useEffect(() => {
    const handleNewMessage = (message) => {
      // Sirf currently selected conversation ka message add karo
      if (message.conversationId === conversationId) {
        setMessages((prevMessages) => [...prevMessages, message]);
      }
    };

    socket.on("newMessage", handleNewMessage);

    return () => {
      socket.off("newMessage", handleNewMessage);
    };
  }, [conversationId]);

  // Join the conversation room, then load its history.
  useEffect(() => {
    if (!conversationId) {
      return;
    }

    // Set to true when the user switches conversation (or leaves the page),
    // so a slow response for the old conversation is thrown away.
    let ignore = false;

    // Join first, fetch second: anything sent after the join arrives through
    // the socket, anything before it is in the history. Merging by _id removes
    // the overlap.
    const joinAndLoadMessages = () => {
      socket.emit("joinConversation", conversationId, async (response) => {
        if (ignore) return;
        if (!response.success) {
          console.error("Could not join conversation:", response.message);
          return;
        }

        try {
          const res = await api.get(`/conversations/${conversationId}/messages`);
          if (ignore) return;

          const history = res.data.messages;
          const historyIds = new Set(history.map((message) => message._id));
          setMessages((prevMessages) => [
            ...history,
            ...prevMessages.filter((message) => !historyIds.has(message._id)),
          ]);
        } catch (error) {
          console.error("Error fetching messages:", error);
        }
      });
    };

    // After a reconnect the server sees a brand-new socket with no rooms,
    // so join again (and refetch to fill the gap) on every "connect".
    if (socket.connected) {
      joinAndLoadMessages();
    }
    socket.on("connect", joinAndLoadMessages);

    return () => {
      ignore = true;
      socket.off("connect", joinAndLoadMessages);
      if (socket.connected) {
        socket.emit("leaveConversation", conversationId);
      }
    };
  }, [conversationId]);

  const handleConversationClick = (id) => {
    if (id === conversationId) {
      return;
    }

    setMessages([]);
    setConversationId(id);
  };
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

  // Send message
  const handleSendMessage = () => {
    if (!conversationId) {
      console.log("Please select a conversation first.");
      return;
    }
    if (!messageInput.trim()) {
      console.log("Message input is empty.");
      return;
    }

    // While disconnected, Socket.IO would buffer the emit and send it after
    // reconnecting — after our timeout already said "failed". Refuse instead,
    // so a retry can't produce a duplicate message.
    if (!socket.connected) {
      console.error("Message not sent: not connected to the server");
      return;
    }

    const content = messageInput.trim();

    // timeout(): if the server never answers (e.g. socket disconnected),
    // the callback still runs with an error instead of waiting forever.
    socket
      .timeout(5000)
      .emit("sendMessage", { conversationId, content }, (err, response) => {
        if (err || !response.success) {
          console.error("Message not sent:", err ? "Server did not respond" : response.message);
          // Give the text back so the user doesn't lose it.
          setMessageInput((current) => current || content);
        }
      });
    setMessageInput("");
  };

  return (
    <div>
      <h1>Chat</h1>
      <p>
        Logged in as {currentUser.username}{" "}
        <button type="button" onClick={onLogout}>Logout</button>
      </p>

      <div>
        <h2>Conversations:</h2>

        {conversations.map((conversation) => {
          const otherParticipant = conversation.participants.find(
            (participant) => participant._id !== currentUser._id,
          );

          return (
            <p
              key={conversation._id}
              onClick={() => handleConversationClick(conversation._id)}
              style={{ cursor: "pointer" }}
            >
              {otherParticipant?.username}
            </p>
          );
        })}
      </div>

      <div>
        <h2>Messages:</h2>

        {messages.map((message) => {
          const isOwnMessage = message.sender === currentUser._id;

          return (
            <div
              key={message._id}
              style={{
                display: "flex",
                justifyContent: isOwnMessage ? "flex-end" : "flex-start",
                marginBottom: "10px",
              }}
            >
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: "12px",
                  maxWidth: "70%",
                }}
              >
                {message.content}
              </div>
            </div>
          );
        })}
      </div>
      <div>
        <input
          type="text"
          placeholder="Type a message..."
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSendMessage();
            }
          }}
        />

        <button onClick={handleSendMessage}>Send</button>
      </div>
    </div>
  );
};

export default Chat;
