// Date/time labels in the style Indian users expect (en-IN locale).
const LOCALE = "en-IN";
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

// Short label for the conversation list: "10:42 am", "Yesterday", "Mon",
// "12 Sept" (en-IN spelling), or "12 Sept 2025" for another year.
export const formatConversationTime = (value, now = new Date()) => {
  const date = new Date(value);
  // Calendar days between the two dates (rounded, so clock changes don't matter).
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);

  if (days <= 0) return date.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(LOCALE, { weekday: "short" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
};

// Full date and time, for tooltips and screen readers.
export const formatFullDateTime = (value) =>
  new Date(value).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" });
