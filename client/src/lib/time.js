// Date/time labels in the style Indian users expect (en-IN locale).
const LOCALE = "en-IN";
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

// "10:42 am"
export const formatTimeOfDay = (value) =>
  new Date(value).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });

// True if both dates fall on the same calendar day (local time).
export const isSameDay = (a, b) => startOfDay(new Date(a)).getTime() === startOfDay(new Date(b)).getTime();

// Date separator in a chat: "Today", "Yesterday", "Monday, 21 September",
// or with the year for other years.
export const formatDayLabel = (value, now = new Date()) => {
  const date = new Date(value);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
};

// Short label for the conversation list: "10:42 am", "Yesterday", "Mon",
// "12 Sept" (en-IN spelling), or "12 Sept 2025" for another year.
export const formatConversationTime = (value, now = new Date()) => {
  const date = new Date(value);
  // Calendar days between the two dates (rounded, so clock changes don't matter).
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);

  if (days <= 0) return formatTimeOfDay(date);
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

// Chat header, for someone who is offline: "Last seen today at 10:42 am",
// "Last seen yesterday at 9:05 pm", "Last seen Tue at 8:00 am" (this week),
// "Last seen 12 Sept" or "Last seen 12 Sept 2025".
export const formatLastSeen = (value, now = new Date()) => {
  const date = new Date(value);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return `Last seen today at ${formatTimeOfDay(date)}`;
  if (days === 1) return `Last seen yesterday at ${formatTimeOfDay(date)}`;
  if (days < 7) return `Last seen ${formatConversationTime(date, now)} at ${formatTimeOfDay(date)}`;
  return `Last seen ${formatConversationTime(date, now)}`;
};
