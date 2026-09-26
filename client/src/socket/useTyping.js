import { useEffect, useRef, useState } from "react";
import socket from "./socket.js";

// While typing, "typing: true" is sent again every few seconds; the other
// side hides the indicator if it hears nothing for a little longer. So a
// closed tab or a lost connection never leaves "typing..." on screen.
const REPEAT_MS = 3000;
const IDLE_MS = 5000; // no keystroke for this long = stopped typing
const EXPIRE_MS = 5000; // receiver: no refresh for this long = hide

// Sender side. Call onInput(text) on every change of the composer and stop()
// after sending. Sends at most one event per REPEAT_MS while typing.
export const useTypingSender = (conversationId) => {
  const state = useRef({ isTyping: false, lastSentAt: 0, idleTimer: null });

  const stop = () => {
    const typing = state.current;
    clearTimeout(typing.idleTimer);
    if (typing.isTyping) {
      typing.isTyping = false;
      socket.emit("typing", { conversationId, isTyping: false });
    }
  };

  const onInput = (text) => {
    const typing = state.current;
    clearTimeout(typing.idleTimer);
    if (!text.trim()) {
      stop();
      return;
    }
    if (!typing.isTyping || Date.now() - typing.lastSentAt >= REPEAT_MS) {
      typing.isTyping = true;
      typing.lastSentAt = Date.now();
      socket.emit("typing", { conversationId, isTyping: true });
    }
    typing.idleTimer = setTimeout(stop, IDLE_MS);
  };

  // Leaving the conversation (or the page) while typing: say we stopped.
  useEffect(() => {
    const typing = state.current;
    return () => {
      clearTimeout(typing.idleTimer);
      if (typing.isTyping) {
        typing.isTyping = false;
        socket.emit("typing", { conversationId, isTyping: false });
      }
    };
  }, [conversationId]);

  return { onInput, stop };
};

// Receiver side: whether the other person is typing in this conversation.
export const usePeerTyping = (conversationId, currentUserId) => {
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    let expireTimer;
    const hide = () => {
      clearTimeout(expireTimer);
      setIsTyping(false);
    };

    const handleTyping = (event) => {
      if (event.conversationId !== conversationId || event.userId === currentUserId) return;
      clearTimeout(expireTimer);
      setIsTyping(event.isTyping);
      if (event.isTyping) expireTimer = setTimeout(hide, EXPIRE_MS);
    };
    // Their message arrived: they are done typing it.
    const handleNewMessage = (message) => {
      if (message.conversationId === conversationId && message.sender !== currentUserId) hide();
    };

    socket.on("typing", handleTyping);
    socket.on("newMessage", handleNewMessage);
    socket.on("disconnect", hide);
    return () => {
      clearTimeout(expireTimer);
      socket.off("typing", handleTyping);
      socket.off("newMessage", handleNewMessage);
      socket.off("disconnect", hide);
    };
  }, [conversationId, currentUserId]);

  return isTyping;
};
