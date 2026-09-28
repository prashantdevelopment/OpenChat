import { NavLink } from "react-router";
import { useSlideOnMove } from "../hooks/useSlideOnMove.js";
import { useConversationKey, useDecryptedText } from "../crypto/hooks.js";
import { formatConversationTime, formatFullDateTime } from "../lib/time.js";
import { cn } from "@/lib/utils";
import { describeMessage } from "../lib/messageContent.js";
import { displayName } from "../lib/people.js";

// One conversation in the list, set like a line in a magazine's contents:
// the name in the serif, time in mono, a one-line preview and a red unread
// badge; the open one is printed in reverse (ink background). The preview is
// encrypted too, so it is decrypted here.
const ConversationListItem = ({ conversation, currentUserId }) => {
  const otherParticipant = conversation.participants.find((participant) => participant._id !== currentUserId);
  const conversationKey = useConversationKey(conversation._id, otherParticipant?.publicKey);
  const { lastMessage, lastMessageAt, unreadCount } = conversation;
  const { text, failed } = useDecryptedText(conversationKey, lastMessage, lastMessage?.sender);
  const isUnread = unreadCount > 0;

  let preview = "No messages yet";
  if (lastMessage?.ciphertext) {
    const isMine = lastMessage.sender === currentUserId;
    const body = failed ? "[could not decrypt]" : text === undefined ? "..." : describeMessage(lastMessage.messageType, text, { isMine });
    // Call records already say who called ("Outgoing ...", "Missed ...").
    preview = isMine && lastMessage.messageType !== "call" ? `You: ${body}` : body;
  }

  const slideRef = useSlideOnMove(); // moves to the top smoothly
  return (
    <li ref={slideRef}>
      {/* NavLink marks the open conversation with aria-current="page". */}
      <NavLink
        to={`/chat/${conversation._id}`}
        className={({ isActive }) =>
          cn(
            "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-border px-5 py-3.5 no-underline transition-colors duration-150 md:px-7",
            isActive ? "bg-foreground text-background" : "text-foreground hover:bg-accent",
          )
        }
      >
        {({ isActive }) => (
          <>
            <span className="flex min-w-0 items-center gap-2 font-heading text-[1.3125rem] leading-tight">
              <span className="truncate">{displayName(otherParticipant)}</span>
              {otherParticipant?.online ? (
                <>
                  <span data-online aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", isActive ? "bg-[#9be7b9]" : "bg-success")} />
                  <span className="sr-only">, online</span>
                </>
              ) : null}
            </span>
            {lastMessageAt ? (
              <time
                dateTime={lastMessageAt}
                title={formatFullDateTime(lastMessageAt)}
                className={cn("self-center font-mono text-[11.5px]", isUnread && !isActive ? "text-brand" : "opacity-70")}
              >
                {formatConversationTime(lastMessageAt)}
              </time>
            ) : (
              <span />
            )}
            {/* truncate: one line with "..." however long the message is */}
            <span className={cn("min-w-0 truncate text-sm", isUnread ? "font-medium" : "opacity-75")}>{preview}</span>
            {isUnread ? (
              <span className="grid h-5.5 min-w-5 place-items-center justify-self-end rounded-full bg-brand px-1.5 font-mono text-[11.5px] text-brand-foreground">
                <span>
                  {unreadCount > 99 ? "99+" : unreadCount}
                  <span className="sr-only"> unread</span>
                </span>
              </span>
            ) : null}
          </>
        )}
      </NavLink>
    </li>
  );
};

export default ConversationListItem;
