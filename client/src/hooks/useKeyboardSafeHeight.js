import { useEffect } from "react";

// Phones: when the keyboard opens, only the messages should scroll; the chat's
// top bar and the composer stay on screen. Android follows the viewport tag
// (interactive-widget=resizes-content in index.html). iPhone Safari ignores it:
// the keyboard covers the page and Safari scrolls the whole page up. So the
// chat takes the height of the visible area (--app-height) and the page stays
// at the top. A pinch-zoom also shrinks the visible area; then nothing changes.
export const useKeyboardSafeHeight = () => {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const fit = () => {
      if (viewport.scale > 1.01) return;
      root.style.setProperty("--app-height", `${viewport.height}px`);
      if (window.scrollY) window.scrollTo(0, 0);
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      root.style.removeProperty("--app-height");
    };
  }, []);
};
