import { describe, it, expect } from "vitest";
import { buildTimeline } from "../src/lib/timeline.js";
import { formatDayLabel, formatTimeOfDay, isSameDay } from "../src/lib/time.js";

const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString();
let id = 0;
const msg = (sender, createdAt) => ({ _id: `m${id++}`, sender, createdAt });

// Short description of the timeline: "day", or sender + F (first) / L (last) of group.
const shape = (items) =>
  items.map((item) =>
    item.type === "day" ? "day" : `${item.message.sender}${item.isFirstInGroup ? "F" : ""}${item.isLastInGroup ? "L" : ""}`,
  );

describe("buildTimeline", () => {
  it("returns nothing for no messages", () => {
    expect(buildTimeline([])).toEqual([]);
  });

  it("starts with a day separator", () => {
    const items = buildTimeline([msg("a", at(20, 10))]);
    expect(shape(items)).toEqual(["day", "aFL"]);
  });

  it("groups consecutive messages from the same person", () => {
    const items = buildTimeline([msg("a", at(20, 10, 0)), msg("a", at(20, 10, 1)), msg("a", at(20, 10, 2)), msg("b", at(20, 10, 3))]);
    expect(shape(items)).toEqual(["day", "aF", "a", "aL", "bFL"]);
  });

  it("starts a new group after a 5-minute pause, even from the same person", () => {
    const items = buildTimeline([msg("a", at(20, 10, 0)), msg("a", at(20, 10, 4)), msg("a", at(20, 10, 9))]);
    expect(shape(items)).toEqual(["day", "aF", "aL", "aFL"]);
  });

  it("adds a separator when the day changes and never groups across days", () => {
    const items = buildTimeline([msg("a", at(20, 23, 58)), msg("a", at(21, 0, 1)), msg("b", at(21, 9))]);
    expect(shape(items)).toEqual(["day", "aFL", "day", "aFL", "bFL"]);
  });

  it("gives every item a unique key", () => {
    const items = buildTimeline([msg("a", at(20, 10)), msg("b", at(21, 10)), msg("a", at(22, 10))]);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });

  it("keeps a message's key from 'sending' to 'saved' (same bubble, no remount)", () => {
    const sending = { _id: "pending-c1", clientId: "c1", sender: "a", createdAt: at(20, 10) };
    const saved = { _id: "server-id", clientId: "c1", sender: "a", createdAt: at(20, 10) };
    expect(buildTimeline([sending]).at(-1).key).toBe(buildTimeline([saved]).at(-1).key);
    expect(buildTimeline([msg("b", at(20, 10))]).at(-1).key).toMatch(/^m\d+$/); // no clientId: _id
  });
});

describe("day and time labels", () => {
  const now = new Date(2026, 8, 26, 15, 30); // Saturday 26 September 2026

  it("labels days relative to today", () => {
    expect(formatDayLabel(new Date(2026, 8, 26, 9), now)).toBe("Today");
    expect(formatDayLabel(new Date(2026, 8, 25, 23), now)).toBe("Yesterday");
    expect(formatDayLabel(new Date(2026, 8, 21, 9), now)).toBe("Monday, 21 September");
    expect(formatDayLabel(new Date(2025, 11, 31, 9), now)).toBe("Wednesday, 31 December 2025");
  });

  it("formats the time of day", () => {
    expect(formatTimeOfDay(new Date(2026, 8, 26, 22, 5))).toMatch(/^10:05\s?pm$/i);
  });

  it("knows when two moments are on the same day", () => {
    expect(isSameDay(new Date(2026, 8, 26, 0, 1), new Date(2026, 8, 26, 23, 59))).toBe(true);
    expect(isSameDay(new Date(2026, 8, 25, 23, 59), new Date(2026, 8, 26, 0, 1))).toBe(false);
  });
});
