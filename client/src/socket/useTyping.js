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

// Receiver side: who else is typing in this conversation (user ids, in the
// order they started). In a 1:1 chat that is the other person or nobody.
export const useTypingPeople = (conversationId, currentUserId) => {
  const [people, setPeople] = useState([]);

  useEffect(() => {
    const timers = new Map(); // userId -> expiry timer
    const stop = (userId) => {
      clearTimeout(timers.get(userId));
      timers.delete(userId);
      setPeople((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : prev));
    };
    const stopAll = () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      setPeople([]);
    };

    const handleTyping = (event) => {
      if (event.conversationId !== conversationId || event.userId === currentUserId) return;
      if (!event.isTyping) return stop(event.userId);
      clearTimeout(timers.get(event.userId));
      timers.set(event.userId, setTimeout(() => stop(event.userId), EXPIRE_MS));
      setPeople((prev) => (prev.includes(event.userId) ? prev : [...prev, event.userId]));
    };
    // Their message arrived: they are done typing it.
    const handleNewMessage = (message) => {
      if (message.conversationId === conversationId && message.sender !== currentUserId) stop(message.sender);
    };

    socket.on("typing", handleTyping);
    socket.on("newMessage", handleNewMessage);
    socket.on("disconnect", stopAll);
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      socket.off("typing", handleTyping);
      socket.off("newMessage", handleNewMessage);
      socket.off("disconnect", stopAll);
    };
  }, [conversationId, currentUserId]);

  return people;
};

// Whether the other person is typing (1:1 chats).
export const usePeerTyping = (conversationId, currentUserId) => useTypingPeople(conversationId, currentUserId).length > 0;
