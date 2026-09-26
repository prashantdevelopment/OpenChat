// Theme choice: "light", "dark" or "system" (follow the device). Keep the
// storage key in sync with the inline script in index.html, which applies
// the saved theme before the first paint. "system" = nothing stored.
const STORAGE_KEY = "openchat-theme";

export const getThemeChoice = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage can be blocked (e.g. some private windows).
  }
  return "system";
};

// Applies the choice (the "dark" class on <html> swaps every colour token)
// and remembers it. Returns whether the page is now dark.
export const applyThemeChoice = (choice) => {
  const isDark = choice === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : choice === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not remembered, but the theme still changes.
  }
  return isDark;
};
