import { useEffect, useState } from "react";

// The theme's colours from its CSS variables, for code that can't use CSS
// (WebGL). Read again when the theme changes (the "dark" class on <html>).
const readColors = () => {
  const css = getComputedStyle(document.documentElement);
  const get = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    dark: document.documentElement.classList.contains("dark"),
    background: get("--background", "#ffffff"),
    foreground: get("--foreground", "#0f172a"),
    muted: get("--muted", "#f1f5fd"),
    primary: get("--primary", "#1b1714"),
    brand: get("--brand", "#c8321a"),
    ring: get("--ring", "#2563eb"),
  };
};

export const useThemeColors = () => {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return colors;
};
