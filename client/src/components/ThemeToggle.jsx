import { useState } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// Keep in sync with the inline script in index.html, which applies the saved
// theme before the first paint.
const STORAGE_KEY = "openchat-theme";

// Switches between the light (default) and dark theme. The whole palette
// lives in CSS variables; the "dark" class on <html> swaps them.
const ThemeToggle = () => {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  const toggle = () => {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Storage can be blocked (e.g. some private windows): the theme still
      // changes, it just isn't remembered.
    }
    setIsDark(next);
  };

  return (
    <Button variant="outline" size="icon" onClick={toggle} aria-label="Dark theme" aria-pressed={isDark}>
      {isDark ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
    </Button>
  );
};

export default ThemeToggle;
