import { describe, it, expect } from "vitest";
import { formatConversationTime, formatFullDateTime } from "../src/lib/time.js";

// A fixed "now": Saturday 26 September 2026, 3:30 pm (local time).
const now = new Date(2026, 8, 26, 15, 30);
const at = (month, day, hour = 10, minute = 42, year = 2026) => new Date(year, month, day, hour, minute);

describe("formatConversationTime", () => {
  it("shows the time for today", () => {
    expect(formatConversationTime(at(8, 26, 10, 42), now)).toMatch(/^10:42\s?am$/i);
    expect(formatConversationTime(at(8, 26, 0, 5), now)).toMatch(/^12:05\s?am$/i);
  });

  it("says Yesterday for yesterday, even just after midnight", () => {
    expect(formatConversationTime(at(8, 25, 23, 59), now)).toBe("Yesterday");
    expect(formatConversationTime(at(8, 25, 23, 59), new Date(2026, 8, 26, 0, 1))).toBe("Yesterday");
  });

  it("shows the weekday within the last week", () => {
    expect(formatConversationTime(at(8, 22), now)).toBe("Tue");
  });

  // en-IN writes September as "Sept" (Indian/British style); allow both forms.
  it("shows day and month for older dates this year", () => {
    expect(formatConversationTime(at(8, 12), now)).toMatch(/^12 Sept?$/);
  });

  it("adds the year for other years", () => {
    expect(formatConversationTime(at(11, 31, 10, 0, 2025), now)).toBe("31 Dec 2025");
  });

  it("accepts the ISO strings the API sends", () => {
    expect(formatConversationTime(at(8, 12).toISOString(), now)).toMatch(/^12 Sept?$/);
  });

  it("treats a slightly future time (clock difference) as today", () => {
    expect(formatConversationTime(new Date(now.getTime() + 60_000), now)).toMatch(/^3:31\s?pm$/i);
  });
});

describe("formatFullDateTime", () => {
  it("gives the full date and time", () => {
    expect(formatFullDateTime(at(8, 12, 10, 42))).toMatch(/^12 Sept?,? 2026,? (at )?10:42\s?am$/i);
  });
});
