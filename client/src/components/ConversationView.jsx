import { useEffect, useState } from "react";
import socket from "../socket/socket.js";
import api from "../api/api.js";

// Tells the server the user has seen this conversation, which clears the
// unread badge in all their tabs. Only while this browser tab is actually
// visible: a chat open in a background tab has not been read.
const markRead = (conversationId) => {
  if (document.visibilityState === "visible") {
    socket.emit("markRead", conversationId);
  }
};

// One open conversation: its messages, real-time updates and the input.
// Chat.jsx renders it with key={conversationId}, so switching conversation
// mounts a fresh instance and all of this state starts empty.
const ConversationView = ({ conversationId, currentUser }) => {
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  // The id comes from the URL now, so it can be wrong or belong to someone else.
  const [joinError, setJoinError] = useState(null);
  const currentUserId = currentUser._id;

  // Receive real-time messages
  useEffect(() => {
    const handleNewMessage = (message) => {
      // Sirf currently selected conversation ka message add karo
      if (message.conversationId === conversationId) {
        setMessages((prevMessages) => [...prevMessages, message]);
        // Seen as it arrives (our own messages are never unread).
        if (message.sender !== currentUserId) {
          markRead(conversationId);
        }
      }
    };

    socket.on("newMessage", handleNewMessage);

    return () => {
      socket.off("newMessage", handleNewMessage);
    };
  }, [conversationId, currentUserId]);

  // Coming back to this browser tab with the chat open counts as reading it.
  useEffect(() => {
    const handleVisibilityChange = () => markRead(conversationId);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [conversationId]);

  // Join the conversation room, then load its history.
  useEffect(() => {
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
          setJoinError(response.message);
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
          markRead(conversationId);
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

  // Send message
  const handleSendMessage = () => {
    if (!messageInput.trim()) {
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

  if (joinError) {
    return <p role="alert">Could not open this conversation: {joinError}</p>;
  }

  return (
    <div>
      {/* role="log": the ARIA role for chat history; screen readers announce
          new messages added to it. */}
      <div role="log" aria-label="Messages">
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

export default ConversationView;
