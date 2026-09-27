import { useSyncExternalStore } from "react";

// Whether a CSS media query matches right now; re-renders when that changes.
// For layout that must exist only once in the page (CSS hiding would still
// leave a second copy for screen readers).
export const useMediaQuery = (query) =>
  useSyncExternalStore(
    (onChange) => {
      const media = matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
