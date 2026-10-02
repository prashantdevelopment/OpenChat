import { NavLink } from "react-router";
import Avatar from "./Avatar.jsx";
import { useSlideOnMove } from "../hooks/useSlideOnMove.js";
import { useDecryptedText } from "../crypto/hooks.js";
import { useGroupCipher } from "../lib/groupCipher.js";
import { formatConversationTime, formatFullDateTime } from "../lib/time.js";
import { describeMessage } from "../lib/messageContent.js";
import { memberCount } from "../lib/groups.js";
import { cn } from "@/lib/utils";
import { BellOffIcon } from "lucide-react";
import { isMutedNow } from "../lib/mute.js";

// A group in the chat list, set like a conversation: its initial, the name,
// the time, a one-line preview with who wrote it ("Riya: Photo") and the
// unread badge. The preview is decrypted here with the group's key.
const GroupListItem = ({ group, currentUserId, nameOf }) => {
  const cipher = useGroupCipher(group._id);
  const { lastMessage, lastMessageAt, unreadCount } = group;
  const { text, failed } = useDecryptedText(cipher, lastMessage, lastMessage?.sender);
  const isUnread = unreadCount > 0;

  let preview = memberCount(group.members.length);
  if (lastMessage?.ciphertext) {
    const isMine = lastMessage.sender === currentUserId;
    const body = failed ? "[could not decrypt]" : text === undefined ? "..." : describeMessage(lastMessage.messageType, text, { isMine });
    preview = `${isMine ? "You" : nameOf(lastMessage.sender)}: ${body}`;
  }

  const slideRef = useSlideOnMove();
  return (
    <li ref={slideRef}>
      <NavLink
        to={`/chat/${group._id}`}
        className={({ isActive }) =>
          cn(
            "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-border px-5 py-3.5 no-underline transition-colors duration-150 md:px-7",
            isActive ? "bg-secondary text-foreground shadow-[inset_3px_0_0_var(--brand)]" : "text-foreground hover:bg-accent",
          )
        }
      >
        {({ isActive }) => (
          <>
            <Avatar name={group.name} className="row-span-2 bg-brand text-brand-foreground" />
            <span className="flex min-w-0 items-center gap-2 font-heading text-[1.1875rem] leading-tight font-semibold">
              <span className="truncate">{group.name}</span>
              <span className="sr-only">, group</span>
              {isMutedNow(group.mutedUntil) ? (
                <>
                  <BellOffIcon aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0 opacity-60" />
                  <span className="sr-only">, muted</span>
                </>
              ) : null}
            </span>
            {lastMessageAt ? (
              <time
                dateTime={lastMessageAt}
                title={formatFullDateTime(lastMessageAt)}
                className={cn("font-mono text-[11.5px]", isUnread && !isActive ? "text-brand" : "opacity-70")}
              >
                {formatConversationTime(lastMessageAt)}
              </time>
            ) : (
              <span />
            )}
            <span className={cn("min-w-0 truncate text-sm", isUnread ? "font-medium" : "opacity-75")}>{preview}</span>
            {isUnread ? (
              <span className="grid h-5.5 min-w-5 place-items-center justify-self-end rounded-full bg-brand px-1.5 font-mono text-[11.5px] text-brand-foreground">
                <span>
                  {unreadCount > 99 ? "99+" : unreadCount}
                  <span className="sr-only"> unread</span>
                </span>
              </span>
            ) : (
              <span />
            )}
          </>
        )}
      </NavLink>
    </li>
  );
};

export default GroupListItem;
