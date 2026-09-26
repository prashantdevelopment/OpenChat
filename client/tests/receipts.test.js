import { describe, it, expect } from "vitest";
import { mergeReceipts, receiptStatus } from "../src/lib/receipts.js";

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
