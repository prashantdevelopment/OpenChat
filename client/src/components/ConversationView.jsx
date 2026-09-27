import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownIcon, FileIcon, LockIcon, MicIcon, PaperclipIcon, SendHorizontalIcon, Trash2Icon, VideoIcon, XIcon } from "lucide-react";
import socket from "../socket/socket.js";
import api from "../api/api.js";
import { rememberText, useConversationKey } from "../crypto/hooks.js";
import { encryptMessage, MAX_MESSAGE_LENGTH } from "../crypto/messages.js";
import { encryptFile } from "../crypto/files.js";
import { formatDuration, formatFileSize, prepareAttachment } from "../lib/attachments.js";
import { rememberFile } from "../lib/encryptedFiles.js";
import { canRecordVoice, useVoiceRecorder } from "../hooks/useVoiceRecorder.js";
import MessageBubble from "./MessageBubble.jsx";
import { buildTimeline } from "../lib/timeline.js";
import { usePeerTyping, useTypingSender } from "../socket/useTyping.js";
import { formatDayLabel } from "../lib/time.js";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toastManager } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

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

// How long to wait for the server to confirm a message before calling it "Not sent".
const SEND_TIMEOUT_MS = 5000;
// Show how many characters are left once the text gets this close to the limit.
const COUNTER_FROM = MAX_MESSAGE_LENGTH - 200;

// Closer than this to the bottom counts as "at the newest message".
const NEAR_BOTTOM_PX = 80;

// Enter sends on a keyboard. On a touch screen there is no Shift+Enter, so
// Enter adds a new line there and the Send button sends.
const enterSends = () => !window.matchMedia("(pointer: coarse)").matches;

// One open conversation: its messages, real-time updates and the input.
// Chat.jsx renders it with key={conversationId}, so switching conversation
// mounts a fresh instance and all of this state starts empty.
// peerPublicKey: the other participant's public key, needed to derive the
// conversation's encryption key (undefined until the conversation list loads).
const ConversationView = ({ conversationId, currentUser, peerPublicKey, peerName, receipts }) => {
  // The loaded messages and whether older ones exist on the server. Kept in
  // one state object because they always change together.
  const [history, setHistory] = useState({ messages: [], hasOlder: false });
  // First load of the history: "loading" | "ready" | "error".
  const [historyStatus, setHistoryStatus] = useState("loading");
  // Bumped by "Try again" to join and load once more.
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  // My messages that the server has not confirmed yet ("sending" or "failed"),
  // shown at the end of the chat. Each has a clientId: sending it again after
  // a failure can never create a second copy (the server checks the id).
  const [outbox, setOutbox] = useState([]);
  // Messages that arrived or were sent while this chat was open: only these
  // animate in (never the history loaded when opening or scrolling up).
  const [freshKeys, setFreshKeys] = useState(() => new Set());
  const markFresh = (key) => setFreshKeys((keys) => new Set(keys).add(key));
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  // A photo, video or file chosen to send (see lib/attachments.js, plus a
  // previewUrl), shown above the input; the text becomes its caption.
  const [attachment, setAttachment] = useState(null);
  const [attachError, setAttachError] = useState("");
  // At the time limit the recording is sent (sendVoice is defined below).
  const voice = useVoiceRecorder({ onLimit: () => sendVoice() });
  const isRecording = voice.status !== "idle";
  const voiceSendRef = useRef(null);
  // The mic button disappears when recording starts and the recording bar when
  // it ends: move keyboard focus along, so it is never lost (and Escape works).
  const wasRecording = useRef(false);
  useEffect(() => {
    if (voice.status === "recording") voiceSendRef.current?.focus();
    if (voice.status === "idle" && wasRecording.current) inputRef.current?.focus();
    wasRecording.current = voice.status !== "idle";
  }, [voice.status]);

  // Scrolling. While the user is at the bottom, the chat follows new content
  // (new messages, text appearing after decryption, a taller composer). Once
  // they scroll up to read, it stays put and counts what arrives instead.
  const logRef = useRef(null);
  const contentRef = useRef(null);
  const isAtBottom = useRef(true); // true at first: a chat opens at the newest message
  const [unseenCount, setUnseenCount] = useState(0);
  // Distance from the bottom saved before older messages are added on top.
  const distanceFromBottom = useRef(null);
  const lastScrollTop = useRef(0);
  // The id comes from the URL now, so it can be wrong or belong to someone else.
  const [joinError, setJoinError] = useState(null);
  const currentUserId = currentUser._id;
  // AES key shared with the other participant (null while being derived).
  const conversationKey = useConversationKey(conversationId, peerPublicKey);
  const typing = useTypingSender(conversationId);
  const isPeerTyping = usePeerTyping(conversationId, currentUserId);

  // Receive real-time messages
  useEffect(() => {
    const handleNewMessage = (message) => {
      // Sirf currently selected conversation ka message add karo
      if (message.conversationId === conversationId) {
        markFresh(message.clientId ?? message._id);
        setHistory((prev) => ({ ...prev, messages: mergeMessages(prev.messages, [message]) }));
        if (message.sender !== currentUserId && !isAtBottom.current) {
          setUnseenCount((count) => count + 1);
        }
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
          setHistoryStatus("ready");
          markRead(conversationId);
        } catch (error) {
          console.error("Error fetching messages:", error);
          // Messages already on screen stay (a refetch after a reconnect failed);
          // otherwise there is nothing to show but the error.
          if (!ignore) setHistoryStatus((status) => (status === "ready" ? status : "error"));
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
  }, [conversationId, historyAttempt]);

  const retryHistory = () => {
    setHistoryStatus("loading");
    setHistoryAttempt((attempt) => attempt + 1);
  };

  // Follow the content while at the bottom. ResizeObserver catches every size
  // change of the messages (and of the visible area), whatever caused it.
  useEffect(() => {
    const log = logRef.current;
    const observer = new ResizeObserver(() => {
      if (isAtBottom.current) log.scrollTop = log.scrollHeight;
    });
    observer.observe(log);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  // Older messages were added above: keep the same distance from the bottom,
  // so the message being read stays where it was instead of jumping down.
  useLayoutEffect(() => {
    if (distanceFromBottom.current === null) return;
    const log = logRef.current;
    log.scrollTop = log.scrollHeight - distanceFromBottom.current;
    distanceFromBottom.current = null;
  }, [history.messages]);

  // Only scrolling UP leaves the bottom. The browser also scrolls on its own
  // (scroll anchoring: when messages above grow, e.g. once decrypted, it
  // scrolls down to keep the view steady); that must not count as leaving.
  const handleScroll = () => {
    const log = logRef.current;
    if (log.scrollHeight - log.scrollTop - log.clientHeight < NEAR_BOTTOM_PX) {
      isAtBottom.current = true;
      setUnseenCount(0);
    } else if (log.scrollTop < lastScrollTop.current) {
      isAtBottom.current = false;
    }
    lastScrollTop.current = log.scrollTop;
  };

  const scrollToBottom = ({ smooth = false } = {}) => {
    const log = logRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    isAtBottom.current = true;
    setUnseenCount(0);
    log.scrollTo({ top: log.scrollHeight, behavior: smooth && !reduceMotion ? "smooth" : "auto" });
  };

  // The page right before the oldest loaded message.
  const loadOlderMessages = async () => {
    setIsLoadingOlder(true);
    try {
      const res = await api.get(`/conversations/${conversationId}/messages`, {
        params: { before: history.messages[0]._id },
      });
      const log = logRef.current;
      distanceFromBottom.current = log.scrollHeight - log.scrollTop;
      setHistory((prev) => ({
        messages: mergeMessages(res.data.messages, prev.messages),
        hasOlder: res.data.hasMore,
      }));
    } catch (error) {
      console.error("Error loading older messages:", error);
      toastManager.add({ type: "error", title: "Couldn't load older messages", description: "Check your connection and try again." });
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const updateOutboxItem = (clientId, changes) =>
    setOutbox((prev) => prev.map((item) => (item.clientId === clientId ? { ...item, ...changes } : item)));
  const setOutboxStatus = (clientId, status) => updateOutboxItem(clientId, { status });

  // Sends one outbox message and waits for the server's confirmation. A photo,
  // video or file is uploaded first (encrypted, with progress); a retry skips
  // the upload if it already worked (fileId is kept on the item).
  const deliver = async (item) => {
    const { clientId } = item;
    let payload = item.encrypted;
    // While disconnected, Socket.IO would hold the message and send it later,
    // after it was already shown as "Not sent". Fail now; Retry sends it once
    // the connection is back.
    if (!socket.connected) {
      setOutboxStatus(clientId, "failed");
      return;
    }
    setOutboxStatus(clientId, "sending");

    if (item.attachmentContent) {
      let fileId = item.fileId;
      if (!fileId) {
        try {
          const res = await api.post(`/conversations/${conversationId}/uploads`, item.fileBytes, {
            params: { kind: item.messageType },
            headers: { "Content-Type": "application/octet-stream" },
            onUploadProgress: (e) => e.total && updateOutboxItem(clientId, { progress: e.loaded / e.total }),
          });
          fileId = res.data.fileId;
        } catch (error) {
          console.error("Attachment not sent:", error.response?.data?.message ?? error.message);
          setOutboxStatus(clientId, "failed");
          return;
        }
        // My own file: shown from the local copy, never downloaded again.
        rememberFile(fileId, item.previewUrl);
        updateOutboxItem(clientId, { fileId, progress: 1 });
      }
      payload = { ...item.encrypted, messageType: item.messageType, attachment: { fileId } };
    }

    // timeout(): if the server never answers, the callback still runs with an error.
    socket
      .timeout(SEND_TIMEOUT_MS)
      .emit("sendMessage", { conversationId, clientId, ...payload }, (err, response) => {
        if (err || !response.success) {
          console.error("Message not sent:", err ? "Server did not respond" : response.message);
          setOutboxStatus(clientId, "failed");
          return;
        }
        // Usually "newMessage" already added it; after a retry of a message
        // that was saved the first time, the confirmation is the only copy.
        setHistory((prev) => ({ ...prev, messages: mergeMessages(prev.messages, [response.message]) }));
        setOutbox((prev) => prev.filter((item) => item.clientId !== clientId));
      });
  };

  const chooseFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // choosing the same file again still triggers onChange
    if (!file) return;
    setAttachError("");
    try {
      const prepared = await prepareAttachment(file);
      if (attachment) URL.revokeObjectURL(attachment.previewUrl);
      setAttachment({ ...prepared, previewUrl: URL.createObjectURL(prepared.blob) });
      inputRef.current?.focus();
    } catch (error) {
      setAttachError(error.message);
    }
  };

  const removeAttachment = () => {
    URL.revokeObjectURL(attachment.previewUrl);
    setAttachment(null);
    inputRef.current?.focus();
  };

  // A photo, video or file with an optional caption. The file gets its own
  // key (see crypto/files.js); that key, its details and the caption travel
  // in the message, encrypted like any text.
  const sendAttachment = async (caption, chosen = attachment) => {
    setAttachment(null);
    setMessageInput("");
    typing.stop();
    scrollToBottom();
    inputRef.current?.focus();

    let fileEncrypted, content, encrypted;
    try {
      fileEncrypted = await encryptFile(await chosen.blob.arrayBuffer());
      const { mime, name, width, height, duration } = chosen;
      content = {
        caption,
        file: { key: fileEncrypted.key, iv: fileEncrypted.iv, mime, name, size: chosen.blob.size, width, height, duration },
      };
      encrypted = await encryptMessage(conversationKey, JSON.stringify(content), currentUserId);
    } catch (error) {
      console.error("Attachment not sent: could not encrypt it", error);
      if (chosen.kind !== "audio") setAttachment(chosen);
      setMessageInput((current) => current || caption);
      setAttachError("This file couldn't be encrypted. Please try again.");
      return;
    }
    rememberText(conversationKey, encrypted, currentUserId, JSON.stringify(content));

    const clientId = crypto.randomUUID();
    const item = {
      _id: `pending-${clientId}`,
      clientId,
      sender: currentUserId,
      createdAt: new Date().toISOString(),
      messageType: chosen.kind,
      text: caption,
      attachmentContent: content,
      previewUrl: chosen.previewUrl,
      fileBytes: fileEncrypted.ciphertext,
      fileId: null,
      progress: 0,
      encrypted,
      status: "sending",
    };
    markFresh(clientId);
    setOutbox((prev) => [...prev, item]);
    deliver(item);
  };

  // Voice message: stop recording and send it like any attachment.
  const sendVoice = async () => {
    const recording = await voice.stop();
    if (!recording) return;
    sendAttachment("", {
      kind: "audio",
      blob: recording.blob,
      mime: recording.mime,
      name: "Voice message",
      width: 0,
      height: 0,
      duration: recording.duration,
      previewUrl: URL.createObjectURL(recording.blob),
    });
  };

  // Send message: encrypted in the browser; the server only gets ciphertext.
  const handleSendMessage = async () => {
    const text = messageInput.trim();
    if (!conversationKey) return;
    if (attachment) {
      sendAttachment(text);
      return;
    }
    if (!text) {
      return;
    }

    // Cleared right away so a fast second Enter can't send the text twice.
    setMessageInput("");
    typing.stop();
    // Sending means you want to see your message, even if you had scrolled up.
    scrollToBottom();
    inputRef.current?.focus();
    let encrypted;
    try {
      encrypted = await encryptMessage(conversationKey, text, currentUserId);
    } catch (error) {
      console.error("Message not sent: could not encrypt it", error);
      setMessageInput((current) => current || text);
      return;
    }
    // The server's copy of this message then shows without decrypting again.
    rememberText(conversationKey, encrypted, currentUserId, text);

    const clientId = crypto.randomUUID();
    const item = {
      _id: `pending-${clientId}`,
      clientId,
      sender: currentUserId,
      createdAt: new Date().toISOString(),
      text,
      encrypted,
      status: "sending",
    };
    markFresh(clientId);
    setOutbox((prev) => [...prev, item]);
    deliver(item);
  };

  // The composer grows with its text (up to max-h-40, then it scrolls).
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    const borders = input.offsetHeight - input.clientHeight;
    input.style.height = `${input.scrollHeight + borders}px`;
  }, [messageInput]);

  // A message is confirmed once the server's copy (same clientId) is in the
  // history, even if its confirmation got lost (e.g. it came in a refetch).
  const confirmedClientIds = new Set(history.messages.map((message) => message.clientId));
  const pending = outbox.filter((item) => !confirmedClientIds.has(item.clientId));

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
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* role="log": the ARIA role for chat history; screen readers announce
            new messages added to it. */}
        <div
          ref={logRef}
          role="log"
          aria-label="Messages"
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div ref={contentRef} className="px-4 py-3">
            <h2 className="sr-only">Messages</h2>

            {history.hasOlder ? (
              <div className="mb-3 flex justify-center">
                <Button variant="outline" size="sm" onClick={loadOlderMessages} loading={isLoadingOlder}>
                  Load older messages
                </Button>
              </div>
            ) : null}

            {historyStatus === "loading" ? (
              // Skeletons only if loading takes longer than half a second.
              <div role="status" className="reveal-late">
                <span className="sr-only">Loading messages...</span>
                {["w-40", "w-56", "w-32", "w-48", "w-36"].map((width, i) => (
                  <div key={width} className={cn("mt-3 flex", i % 2 ? "justify-end" : "justify-start")}>
                    <Skeleton className={cn("h-9 max-w-[70%] rounded-2xl", width)} />
                  </div>
                ))}
              </div>
            ) : historyStatus === "error" ? (
              <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
                <p className="font-medium">Couldn&apos;t load messages</p>
                <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={retryHistory}>
                  Try again
                </Button>
              </div>
            ) : history.messages.length === 0 && pending.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-16 text-center">
                <LockIcon aria-hidden="true" className="size-8 text-muted-foreground" />
                <p className="mt-3 font-medium">No messages yet</p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Messages with {peerName ?? "this person"} are end-to-end encrypted. Say hello!
                </p>
              </div>
            ) : null}

            {buildTimeline([...history.messages, ...pending]).map((item) =>
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
                  receipts={receipts}
                  onRetry={item.message.status ? () => deliver(item.message) : undefined}
                  animateIn={freshKeys.has(item.key)}
                />
              ),
            )}

            {/* Three bouncing dots while the other person types (they stand
                still with reduced motion). Read out by the status region below. */}
            {isPeerTyping ? (
              <div aria-hidden="true" data-typing className="mt-3 flex">
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-4 py-3.5">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Always present, so screen readers announce the text when it appears. */}
        <p role="status" className="sr-only">
          {isPeerTyping ? `${peerName ?? "The other person"} is typing` : ""}
        </p>

        {unseenCount > 0 ? (
          <Button
            type="button"
            size="sm"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
            onClick={() => scrollToBottom({ smooth: true })}
          >
            <ArrowDownIcon aria-hidden="true" />
            {unseenCount} new {unseenCount === 1 ? "message" : "messages"}
          </Button>
        ) : null}
      </div>
      <form
        className="relative shrink-0 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
      >
        {attachment ? (
          <div className="mb-2 flex items-center gap-3 rounded-lg border border-border p-2">
            {attachment.kind === "image" ? (
              <img src={attachment.previewUrl} alt="Photo to send" className="size-16 shrink-0 rounded-md object-cover" />
            ) : (
              <span className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {attachment.kind === "video" ? <VideoIcon aria-hidden="true" className="size-6" /> : <FileIcon aria-hidden="true" className="size-6" />}
              </span>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">
                {attachment.kind === "image" ? "Photo" : attachment.kind === "video" ? "Video" : "File"} ready to send
              </p>
              {attachment.kind === "file" ? (
                <p className="truncate text-muted-foreground" title={attachment.name}>
                  {attachment.name} · {formatFileSize(attachment.blob.size)}
                </p>
              ) : (
                <p className="text-muted-foreground">
                  {attachment.kind === "image"
                    ? `${attachment.width} × ${attachment.height}`
                    : formatDuration(attachment.duration)}{" "}
                  · {formatFileSize(attachment.blob.size)}
                  {attachment.kind === "image" ? " · location data removed" : null}
                </p>
              )}
              {/* Photos are redrawn without metadata; videos are sent as they are. */}
              {attachment.kind === "video" ? (
                <p className="text-xs text-muted-foreground">Sent as it is: any location saved in the video is included.</p>
              ) : null}
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove attachment" onClick={removeAttachment}>
              <XIcon aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        {attachError || voice.error ? (
          <p role="alert" className="mb-2 text-sm text-destructive-foreground">
            {attachError || voice.error}
          </p>
        ) : null}
        {/* Announced once when recording starts (the timer itself isn't read out). */}
        <p role="status" className="sr-only">
          {isRecording ? "Recording a voice message" : ""}
        </p>
        {isRecording ? (
          // Escape = cancel.
          <div
            className="flex items-center gap-2"
            onKeyDown={(e) => {
              if (e.key === "Escape") voice.cancel();
            }}
          >
            <Button type="button" variant="ghost" size="icon-xl" aria-label="Cancel recording" onClick={voice.cancel}>
              <Trash2Icon aria-hidden="true" />
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input px-3 py-2">
              <span aria-hidden="true" className="size-2.5 shrink-0 animate-pulse rounded-full bg-destructive" />
              <span aria-hidden="true" className="tabular-nums">
                {voice.status === "starting" ? "Starting..." : formatDuration(voice.seconds)}
              </span>
              <span className="truncate text-sm text-muted-foreground">Recording</span>
            </div>
            <Button
              type="button"
              size="icon-xl"
              aria-label="Send voice message"
              ref={voiceSendRef}
              disabled={voice.status !== "recording"}
              onClick={sendVoice}
            >
              <SendHorizontalIcon aria-hidden="true" />
            </Button>
          </div>
        ) : (
        <div className="flex items-end gap-2">
          <input ref={fileInputRef} type="file" hidden onChange={chooseFile} />
          <Button
            type="button"
            variant="ghost"
            size="icon-xl"
            aria-label="Attach a photo, video or file"
            disabled={!conversationKey}
            onClick={() => fileInputRef.current?.click()}
          >
            <PaperclipIcon aria-hidden="true" />
          </Button>
          <textarea
            ref={inputRef}
            rows={1}
            className="max-h-40 min-w-0 flex-1 resize-none"
            aria-label="Message"
            aria-describedby="composer-hint"
            placeholder={attachment ? "Add a caption..." : "Type a message..."}
            maxLength={MAX_MESSAGE_LENGTH}
            enterKeyHint={enterSends() ? "send" : "enter"}
            value={messageInput}
            onChange={(e) => {
              setMessageInput(e.target.value);
              typing.onInput(e.target.value);
            }}
            onKeyDown={(e) => {
              // isComposing: Enter that confirms a word in an input method
              // (e.g. Hindi transliteration) must not send the message.
              if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || !enterSends()) return;
              e.preventDefault();
              handleSendMessage();
            }}
          />
          {/* Voice message: only while nothing is typed or attached (like other chat apps). */}
          {canRecordVoice() && !messageInput && !attachment ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xl"
              aria-label="Record voice message"
              disabled={!conversationKey}
              onClick={voice.start}
            >
              <MicIcon aria-hidden="true" />
            </Button>
          ) : null}
          {/* Disabled until the encryption key for this conversation is ready. */}
          <Button type="submit" size="icon-xl" aria-label="Send" disabled={!conversationKey}>
            <SendHorizontalIcon aria-hidden="true" />
          </Button>
        </div>
        )}
        <p id="composer-hint" className="sr-only">
          {enterSends() ? "Enter sends, Shift+Enter adds a new line." : "Use the Send button to send."}
        </p>
        {messageInput.length >= COUNTER_FROM ? (
          <p className="mt-1 text-right text-xs text-muted-foreground">
            {MAX_MESSAGE_LENGTH - messageInput.length} characters left
          </p>
        ) : null}
      </form>
    </div>
  );
};

export default ConversationView;
