import { NavLink } from "react-router";
import { useConversationKey, useDecryptedText } from "../crypto/hooks.js";

// One conversation in the sidebar. Its last-message preview is encrypted too,
// so it is decrypted here, in the browser.
const ConversationListItem = ({ conversation, currentUserId }) => {
  const otherParticipant = conversation.participants.find((participant) => participant._id !== currentUserId);
  const conversationKey = useConversationKey(conversation._id, otherParticipant?.publicKey);
  const { lastMessage } = conversation;
  const { text, failed } = useDecryptedText(conversationKey, lastMessage, lastMessage?.sender);

  let preview = null;
  if (lastMessage?.ciphertext) {
    const body = failed ? "[could not decrypt]" : (text ?? "...");
    preview = lastMessage.sender === currentUserId ? `You: ${body}` : body;
  }

  return (
    <p>
      {/* NavLink marks the open conversation with aria-current="page". */}
      <NavLink
        to={`/chat/${conversation._id}`}
        style={({ isActive }) => ({ fontWeight: isActive ? "bold" : "normal" })}
      >
        {otherParticipant?.username}
        {conversation.unreadCount > 0 ? <strong> ({conversation.unreadCount} unread)</strong> : null}
        {preview ? (
          <>
            <br />
            <small>{preview}</small>
          </>
        ) : null}
      </NavLink>
    </p>
  );
};

export default ConversationListItem;
