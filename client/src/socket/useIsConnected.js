import { useSyncExternalStore } from "react";
import socket from "./socket.js";

// Whether the real-time connection is up right now. useSyncExternalStore
// subscribes React to the socket's own connect/disconnect events.
const subscribe = (onChange) => {
  socket.on("connect", onChange);
  socket.on("disconnect", onChange);
  return () => {
    socket.off("connect", onChange);
    socket.off("disconnect", onChange);
  };
};

export const useIsConnected = () => useSyncExternalStore(subscribe, () => socket.connected);
