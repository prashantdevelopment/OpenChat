import { isSameDay } from "./time.js";

// Messages from the same person this close together form one visual group:
// bubbles sit closer and only the last one shows the time.
const GROUP_GAP_MS = 5 * 60 * 1000;

// A group's "joined"/"left" lines stand alone.
const continuesGroup = (earlier, later) =>
  Boolean(earlier && later) &&
  earlier.messageType !== "system" &&
  later.messageType !== "system" &&
  earlier.sender === later.sender &&
  isSameDay(earlier.createdAt, later.createdAt) &&
  new Date(later.createdAt) - new Date(earlier.createdAt) < GROUP_GAP_MS;

// Turns messages (oldest first) into what the chat shows, in order:
// { type: "day", key, date } whenever the calendar day changes, and
// { type: "message", key, message, isFirstInGroup, isLastInGroup }.
// A pure function (no React), so it is easy to test.
// One key for a message's whole life: while sending it only has a clientId,
// once saved an _id too. Same key = React keeps the same bubble (no remount).
const keyOf = (message) => message.clientId ?? message._id;

export const buildTimeline = (messages) => {
  const items = [];
  messages.forEach((message, i) => {
    const previous = messages[i - 1];
    const next = messages[i + 1];
    if (!previous || !isSameDay(previous.createdAt, message.createdAt)) {
      items.push({ type: "day", key: `day-${keyOf(message)}`, date: message.createdAt });
    }
    items.push({
      type: "message",
      key: keyOf(message),
      message,
      isFirstInGroup: !continuesGroup(previous, message),
      isLastInGroup: !continuesGroup(message, next),
    });
  });
  return items;
};
