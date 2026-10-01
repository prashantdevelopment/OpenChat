import { useEffect, useState, useSyncExternalStore } from "react";
import { useIsConnected } from "./useIsConnected.js";

// What the line at the top of the chat says about the connection: null
// (nothing), "offline" (the device has no internet) or "connecting" (it has,
// but OpenChat isn't reachable yet).
//
// Not connected for a moment is normal and says nothing: the app opening (the
// first connection takes a second or two, longer while the free server wakes
// up), a phone coming back from the background, a deploy. So:
// - offline: shown after a second (the device says it has no network);
// - online but not connected: only after several seconds, and it doesn't
//   blame the user's internet.
export const OFFLINE_DELAY_MS = 1000;
export const CONNECTING_DELAY_MS = 6000;

const subscribeOnline = (onChange) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

export const useConnectionBanner = () => {
  const isConnected = useIsConnected();
  const isOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const [late, setLate] = useState(false);
  if (isConnected && late) setLate(false); // reset for the next drop

  useEffect(() => {
    if (isConnected) return;
    const timer = setTimeout(() => setLate(true), isOnline ? CONNECTING_DELAY_MS : OFFLINE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isConnected, isOnline]);

  if (isConnected || !late) return null;
  return isOnline ? "connecting" : "offline";
};
