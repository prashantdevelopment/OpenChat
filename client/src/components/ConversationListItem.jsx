import { NavLink } from "react-router";
import { useConversationKey, useDecryptedText } from "../crypto/hooks.js";
import { formatConversationTime, formatFullDateTime } from "../lib/time.js";
import { cn } from "@/lib/utils";
import Avatar from "./Avatar.jsx";

// One conversation in the sidebar: avatar, name, time, one-line preview and
// unread badge. The preview is encrypted too, so it is decrypted here.
const ConversationListItem = ({ conversation, currentUserId }) => {
  const otherParticipant = conversation.participants.find((participant) => participant._id !== currentUserId);
  const conversationKey = useConversationKey(conversation._id, otherParticipant?.publicKey);
  const { lastMessage, lastMessageAt, unreadCount } = conversation;
  const { text, failed } = useDecryptedText(conversationKey, lastMessage, lastMessage?.sender);
  const isUnread = unreadCount > 0;

  let preview = "No messages yet";
  if (lastMessage?.ciphertext) {
    const body = failed ? "[could not decrypt]" : (text ?? "...");
    preview = lastMessage.sender === currentUserId ? `You: ${body}` : body;
  }

  return (
    <li>
      {/* NavLink marks the open conversation with aria-current="page". */}
      <NavLink
        to={`/chat/${conversation._id}`}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-foreground no-underline transition-colors duration-150 hover:bg-accent",
            isActive && "bg-accent",
          )
        }
      >
        <Avatar name={otherParticipant?.username} />

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate", isUnread ? "font-semibold" : "font-medium")}>
              {otherParticipant?.username}
            </span>
            {lastMessageAt ? (
              <time
                dateTime={lastMessageAt}
                title={formatFullDateTime(lastMessageAt)}
                className={cn("shrink-0 text-xs", isUnread ? "font-semibold text-primary" : "text-muted-foreground")}
              >
                {formatConversationTime(lastMessageAt)}
              </time>
            ) : null}
          </span>

          <span className="flex items-center gap-2">
            {/* truncate: one line with "..." however long the message is */}
            <span className={cn("min-w-0 flex-1 truncate text-sm", isUnread ? "text-foreground" : "text-muted-foreground")}>
              {preview}
            </span>
            {isUnread ? (
              <span className="min-w-5 shrink-0 rounded-full bg-primary px-1.5 text-center text-xs leading-5 font-semibold text-primary-foreground">
                {unreadCount > 99 ? "99+" : unreadCount}
                <span className="sr-only"> unread</span>
              </span>
            ) : null}
          </span>
        </span>
      </NavLink>
    </li>
  );
};

export default ConversationListItem;
