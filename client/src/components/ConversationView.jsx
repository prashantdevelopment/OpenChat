import { useEffect, useState } from "react";
import socket from "../socket/socket.js";
import api from "../api/api.js";
import { useConversationKey } from "../crypto/hooks.js";
import { encryptMessage, MAX_MESSAGE_LENGTH } from "../crypto/messages.js";
import MessageBubble from "./MessageBubble.jsx";
import { buildTimeline } from "../lib/timeline.js";
import { formatDayLabel } from "../lib/time.js";

// Tells the server the user has seen this conversation, which clears the
// unread badge in all their tabs. Only while this browser tab is actually
// visible: a chat open in a background tab has not been read.
const markRead = (conversationId) => {
  if (document.visibilityState === "visible") {
    socket.emit("markRead", conversationId);
  }
};

// Oldest first; messages with the same timestamp are ordered by _id, the same
// tie-breaker the server uses for pages.
const byTime = (a, b) => a.createdAt.localeCompare(b.createdAt) || a._id.localeCompare(b._id);

// Combines two lists of messages without duplicates, oldest first.
const mergeMessages = (a, b) => {
  const byId = new Map([...a, ...b].map((message) => [message._id, message]));
  return [...byId.values()].sort(byTime);
};

// One open conversation: its messages, real-time updates and the input.
// Chat.jsx renders it with key={conversationId}, so switching conversation
// mounts a fresh instance and all of this state starts empty.
// peerPublicKey: the other participant's public key, needed to derive the
// conversation's encryption key (undefined until the conversation list loads).
const ConversationView = ({ conversationId, currentUser, peerPublicKey, peerName }) => {
  // The loaded messages and whether older ones exist on the server. Kept in
  // one state object because they always change together.
  const [history, setHistory] = useState({ messages: [], hasOlder: false });
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  // The id comes from the URL now, so it can be wrong or belong to someone else.
  const [joinError, setJoinError] = useState(null);
  const currentUserId = currentUser._id;
  // AES key shared with the other participant (null while being derived).
  const conversationKey = useConversationKey(conversationId, peerPublicKey);

  // Receive real-time messages
  useEffect(() => {
    const handleNewMessage = (message) => {
      // Sirf currently selected conversation ka message add karo
      if (message.conversationId === conversationId) {
        setHistory((prev) => ({ ...prev, messages: [...prev.messages, message] }));
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
    // the socket, anything before it is in the newest page. Merging by _id
    // removes the overlap.
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

          const { messages: newest, hasMore } = res.data;
          setHistory((prev) => {
            const newestIds = new Set(newest.map((message) => message._id));
            // After a reconnect we may have missed more than one page: then the
            // newest page doesn't touch what we have, and merging would hide
            // the gap. Start again from the newest page instead.
            const hasGap = hasMore && !prev.messages.some((message) => newestIds.has(message._id));
            if (prev.messages.length === 0 || hasGap) {
              return { messages: newest, hasOlder: hasMore };
            }
            // Overlap: keep the older pages already loaded (and hasOlder).
            return { ...prev, messages: mergeMessages(prev.messages, newest) };
          });
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

  // The page right before the oldest loaded message.
  const loadOlderMessages = async () => {
    setIsLoadingOlder(true);
    try {
      const res = await api.get(`/conversations/${conversationId}/messages`, {
        params: { before: history.messages[0]._id },
      });
      setHistory((prev) => ({
        messages: mergeMessages(res.data.messages, prev.messages),
        hasOlder: res.data.hasMore,
      }));
    } catch (error) {
      console.error("Error loading older messages:", error);
    } finally {
      setIsLoadingOlder(false);
    }
  };

  // Send message: encrypted in the browser; the server only gets ciphertext.
  const handleSendMessage = async () => {
    if (!messageInput.trim() || !conversationKey) {
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
    setMessageInput("");
    let encrypted;
    try {
      encrypted = await encryptMessage(conversationKey, content, currentUserId);
    } catch (error) {
      console.error("Message not sent: could not encrypt it", error);
      setMessageInput((current) => current || content);
      return;
    }
    const { ciphertext, iv } = encrypted;

    // timeout(): if the server never answers (e.g. socket disconnected),
    // the callback still runs with an error instead of waiting forever.
    socket
      .timeout(5000)
      .emit("sendMessage", { conversationId, ciphertext, iv }, (err, response) => {
        if (err || !response.success) {
          console.error("Message not sent:", err ? "Server did not respond" : response.message);
          // Give the text back so the user doesn't lose it.
          setMessageInput((current) => current || content);
        }
      });
  };

  if (joinError) {
    return (
      <p role="alert" className="p-4 text-destructive-foreground">
        Could not open this conversation: {joinError}
      </p>
    );
  }

  return (
    // Fills the space under the chat header: messages scroll, the composer stays at the bottom.
    <div className="flex min-h-0 flex-1 flex-col">
      {/* role="log": the ARIA role for chat history; screen readers announce
          new messages added to it. */}
      <div role="log" aria-label="Messages" className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <h2 className="sr-only">Messages</h2>

        {history.hasOlder ? (
          <div className="mb-3 flex justify-center">
            <button type="button" onClick={loadOlderMessages} disabled={isLoadingOlder}>
              {isLoadingOlder ? "Loading..." : "Load older messages"}
            </button>
          </div>
        ) : null}

        {buildTimeline(history.messages).map((item) =>
          item.type === "day" ? (
            // A heading per day, so screen-reader users can jump between days.
            <h3 key={item.key} className="my-4 flex justify-center font-sans text-xs font-medium first:mt-0">
              <time dateTime={item.date} className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                {formatDayLabel(item.date)}
              </time>
            </h3>
          ) : (
            <MessageBubble
              key={item.key}
              message={item.message}
              conversationKey={conversationKey}
              isOwnMessage={item.message.sender === currentUserId}
              senderName={peerName}
              isFirstInGroup={item.isFirstInGroup}
              isLastInGroup={item.isLastInGroup}
            />
          ),
        )}
      </div>
      <div className="flex shrink-0 gap-2 border-t border-border p-3">
        <input
          type="text"
          className="min-w-0 flex-1"
          aria-label="Message"
          placeholder="Type a message..."
          maxLength={MAX_MESSAGE_LENGTH}
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSendMessage();
            }
          }}
        />

        {/* Disabled until the encryption key for this conversation is ready. */}
        <button onClick={handleSendMessage} disabled={!conversationKey}>Send</button>
      </div>
    </div>
  );
};

export default ConversationView;
