import { useDecryptedText } from "../crypto/hooks.js";
import { formatFullDateTime, formatTimeOfDay } from "../lib/time.js";
import { cn } from "@/lib/utils";

// One message. It arrives encrypted and is decrypted here, in the browser.
// Mine: right, blue. Theirs: left, muted. Within a group (see lib/timeline.js)
// bubbles sit close together and only the last one shows the time.
const MessageBubble = ({ message, conversationKey, isOwnMessage, senderName, isFirstInGroup, isLastInGroup }) => {
  const { text, failed } = useDecryptedText(conversationKey, message, message.sender);

  let content = text;
  let isStatus = true; // a note about the message rather than its text
  if (!message.ciphertext) content = "[Sent before encryption; can't be shown]";
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

      {isLastInGroup && message.createdAt ? (
        <time
          dateTime={message.createdAt}
          title={formatFullDateTime(message.createdAt)}
          className="mt-1 px-1 text-xs text-muted-foreground"
        >
          {formatTimeOfDay(message.createdAt)}
        </time>
      ) : null}
    </div>
  );
};

export default MessageBubble;
