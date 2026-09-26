import { useState } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyThemeChoice } from "../lib/theme.js";

// Switches between the light (default) and dark theme. The whole palette
// lives in CSS variables; the "dark" class on <html> swaps them.
const ThemeToggle = () => {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  const toggle = () => setIsDark(applyThemeChoice(isDark ? "light" : "dark"));

  return (
    <Button variant="outline" size="icon" onClick={toggle} aria-label="Dark theme" aria-pressed={isDark}>
      {isDark ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
    </Button>
  );
};

export default ThemeToggle;
