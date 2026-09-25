import { useEffect, useState } from "react";
import socket from "../socket/socket.js";
import axios from "axios";

const Chat = ({ currentUser }) => {
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [messageInput, setMessageInput] = useState("");

  // Receive real-time messages
  useEffect(() => {
    const handleNewMessage = (message) => {
      console.log("New message received:", message);

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

  // Fetch messages + join conversation
  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const fetchMessages = async () => {
      try {
        const response = await axios.get(
          `http://localhost:5000/api/conversations/${conversationId}/messages`,
          {
            withCredentials: true,
          },
        );

        setMessages(response.data.messages);
      } catch (error) {
        console.error("Error fetching messages:", error);
      }
    };

    fetchMessages();

    // Conversation room join karo
    if (socket.connected) {
      socket.emit("joinConversation", conversationId);
    }
  }, [conversationId]);
  const handleConversationClick = (id) => {
    if (id === conversationId) {
      return;
    }

    if (conversationId && socket.connected) {
      socket.emit("leaveConversation", conversationId);
    }

    setConversationId(id);
  };
  // Fetch conversations
  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const response = await axios.get(
          "http://localhost:5000/api/conversations",
          {
            withCredentials: true,
          },
        );

        console.log("Conversations:", response.data.conversations);

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

    const messageData = {
      conversationId,
      content: messageInput.trim(),
    };

    socket.emit("sendMessage", messageData);
    setMessageInput("");
  };

  return (
    <div>
      <h1>Chat</h1>

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
