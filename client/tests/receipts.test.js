import { describe, it, expect } from "vitest";
import { mergeReceipts, receiptStatus, whyNotDeletable } from "../src/lib/receipts.js";

const message = { createdAt: "2026-09-26T10:00:00.000Z" };

describe("receiptStatus", () => {
  it("is 'sent' until the other app received it", () => {
    expect(receiptStatus(message, undefined)).toBe("sent");
    expect(receiptStatus(message, { deliveredAt: null, readAt: null })).toBe("sent");
    expect(receiptStatus(message, { deliveredAt: "2026-09-26T09:59:59.000Z", readAt: null })).toBe("sent");
  });

  it("is 'delivered' once received, 'read' once read after sending", () => {
    expect(receiptStatus(message, { deliveredAt: "2026-09-26T10:00:05.000Z", readAt: null })).toBe("delivered");
    expect(receiptStatus(message, { deliveredAt: "2026-09-26T10:01:00.000Z", readAt: "2026-09-26T09:00:00.000Z" })).toBe("delivered");
    expect(receiptStatus(message, { deliveredAt: "2026-09-26T10:01:00.000Z", readAt: "2026-09-26T10:01:00.000Z" })).toBe("read");
  });
});

describe("mergeReceipts", () => {
  it("only moves times forward", () => {
    const current = { deliveredAt: "2026-09-26T10:05:00.000Z", readAt: "2026-09-26T10:04:00.000Z" };
    expect(mergeReceipts(current, { deliveredAt: "2026-09-26T10:01:00.000Z" })).toEqual(current);
    expect(mergeReceipts(current, { deliveredAt: "2026-09-26T10:09:00.000Z", readAt: "2026-09-26T10:09:00.000Z" }))
      .toEqual({ deliveredAt: "2026-09-26T10:09:00.000Z", readAt: "2026-09-26T10:09:00.000Z" });
    expect(mergeReceipts(undefined, { deliveredAt: "2026-09-26T10:01:00.000Z" })).toEqual({ deliveredAt: "2026-09-26T10:01:00.000Z", readAt: null });
  });
});

describe("whyNotDeletable", () => {
  const at = (minutes) => new Date(new Date(message.createdAt).getTime() + minutes * 60 * 1000).getTime();

  it("can be deleted while not read, up to 15 minutes after sending", () => {
    expect(whyNotDeletable(message, undefined, at(1))).toBeNull();
    expect(whyNotDeletable(message, { deliveredAt: "2026-09-26T10:00:05.000Z", readAt: null }, at(15))).toBeNull();
  });

  it("not after 15 minutes", () => {
    expect(whyNotDeletable(message, undefined, at(15.1))).toBe("tooLate");
  });

  it("not once it shows as read (even within the 15 minutes)", () => {
    expect(whyNotDeletable(message, { deliveredAt: null, readAt: "2026-09-26T10:00:30.000Z" }, at(1))).toBe("seen");
    // Read before it was sent: still unread.
    expect(whyNotDeletable(message, { deliveredAt: null, readAt: "2026-09-26T09:59:00.000Z" }, at(1))).toBeNull();
  });
});
