import { useEffect, useState } from "react";
import socket from "../socket/socket.js";

// Online counts per state, live: { states: [{ code, online }], total }, or
// null while loading. online is null for "fewer than 5" (the server never
// sends small numbers, so nobody can be picked out). Watching starts when a
// page uses this and stops when it goes away.
export const useStatePresence = () => {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    const watch = () =>
      socket.emit("watchStatePresence", (response) => {
        if (response?.success) setSnapshot({ states: response.states, total: response.total });
      });
    const handleUpdate = (update) => setSnapshot(update);

    if (socket.connected) watch();
    socket.on("connect", watch); // a new connection has no rooms: watch again
    socket.on("statePresence", handleUpdate);
    return () => {
      socket.off("connect", watch);
      socket.off("statePresence", handleUpdate);
      if (socket.connected) socket.emit("unwatchStatePresence");
    };
  }, []);

  return snapshot;
};
