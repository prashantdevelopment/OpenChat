import { AlertCircleIcon, CheckCheckIcon, CheckIcon, RotateCwIcon } from "lucide-react";
import { useDecryptedText } from "../crypto/hooks.js";
import { formatFullDateTime, formatTimeOfDay } from "../lib/time.js";
import { receiptStatus } from "../lib/receipts.js";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// One message. It arrives encrypted and is decrypted here, in the browser.
// Mine: right, blue. Theirs: left, muted. Within a group (see lib/timeline.js)
// bubbles sit close together and only the last one shows the time.
// A message still on its way (see ConversationView) has `status` "sending" or
// "failed" and its plain `text`; it shows that status instead of a time.
// Ticks on my messages: one = on the server, two = reached their app, two in
// blue = read. The word is there too (tooltip and screen readers).
const RECEIPTS = {
  sent: { Icon: CheckIcon, label: "Sent", className: "text-muted-foreground" },
  delivered: { Icon: CheckCheckIcon, label: "Delivered", className: "text-muted-foreground" },
  read: { Icon: CheckCheckIcon, label: "Read", className: "text-primary" },
};

const MessageBubble = ({ message, conversationKey, isOwnMessage, senderName, isFirstInGroup, isLastInGroup, receipts, onRetry }) => {
  const { text, failed } = useDecryptedText(conversationKey, message, message.sender);

  let content = message.status ? message.text : text;
  let isStatus = true; // a note about the message rather than its text
  if (message.status) isStatus = false;
  else if (!message.ciphertext) content = "[Sent before encryption; can't be shown]";
  else if (failed) content = "[This message could not be decrypted]";
  else if (text === undefined) content = "Decrypting...";
  else isStatus = false;

  return (
    <div className={cn("flex flex-col", isOwnMessage ? "items-end" : "items-start", isFirstInGroup ? "mt-3" : "mt-0.5")}>
      <div
        className={cn(
          // relative: keeps the sr-only label (position: absolute) inside the
          // scrolling log, otherwise it stretches the whole page.
          "relative max-w-[85%] rounded-2xl px-3.5 py-2 sm:max-w-[70%]",
          isOwnMessage ? "bg-bubble-own text-bubble-own-foreground" : "bg-muted text-foreground",
          // The last bubble of a group gets a smaller corner on its side, like a tail.
          isLastInGroup && (isOwnMessage ? "rounded-br-md" : "rounded-bl-md"),
        )}
      >
        {/* Screen readers hear who said it; sighted users see it from the side. */}
        <span className="sr-only">{isOwnMessage ? "You" : senderName}: </span>
        {/* dir="auto": each message picks its own direction (e.g. Urdu is right-to-left).
            wrap-anywhere keeps long links and words inside the bubble. */}
        <p dir="auto" className={cn("whitespace-pre-wrap wrap-anywhere", isStatus && "italic opacity-80")}>
          {content}
        </p>
      </div>

      {message.status === "sending" ? (
        <span className="reveal-late mt-1 px-1 text-xs text-muted-foreground">Sending...</span>
      ) : message.status === "failed" ? (
        <div className="mt-1 flex items-center gap-2 px-1 text-xs">
          <span className="inline-flex items-center gap-1 text-destructive-foreground">
            <AlertCircleIcon aria-hidden="true" className="size-3.5" />
            Not sent
          </span>
          <Button type="button" variant="outline" size="xs" onClick={onRetry}>
            <RotateCwIcon aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : isLastInGroup && message.createdAt ? (
        <div className="mt-1 flex items-center gap-1 px-1 text-xs text-muted-foreground">
          <time dateTime={message.createdAt} title={formatFullDateTime(message.createdAt)}>
            {formatTimeOfDay(message.createdAt)}
          </time>
          {isOwnMessage ? <ReceiptTicks status={receiptStatus(message, receipts)} /> : null}
        </div>
      ) : null}
    </div>
  );
};

const ReceiptTicks = ({ status }) => {
  const { Icon, label, className } = RECEIPTS[status];
  return (
    <span data-receipt={status} title={label} className={cn("inline-flex", className)}>
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  );
};

export default MessageBubble;
