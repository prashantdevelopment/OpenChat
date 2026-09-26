// Tick status of one of my messages, from the other person's receipt times
// ({ deliveredAt, readAt } of the conversation, see the server's receiptsFor):
// "read" if they read the chat after it was sent, "delivered" if their app
// received it, "sent" if it is only on the server so far.
export const receiptStatus = (message, receipts) => {
  const sentAt = new Date(message.createdAt);
  if (receipts?.readAt && sentAt <= new Date(receipts.readAt)) return "read";
  if (receipts?.deliveredAt && sentAt <= new Date(receipts.deliveredAt)) return "delivered";
  return "sent";
};

// Receipt times only move forward (an older event can arrive late).
const later = (a, b) => (!a ? b : !b ? a : new Date(a) >= new Date(b) ? a : b);
export const mergeReceipts = (current, update) => ({
  deliveredAt: later(current?.deliveredAt ?? null, update.deliveredAt ?? null),
  readAt: later(current?.readAt ?? null, update.readAt ?? null),
});
