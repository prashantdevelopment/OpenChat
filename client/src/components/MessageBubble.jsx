import { useDecryptedText } from "../crypto/hooks.js";

// One message. It arrives encrypted and is decrypted here, in the browser.
const MessageBubble = ({ message, conversationKey, isOwnMessage }) => {
  const { text, failed } = useDecryptedText(conversationKey, message, message.sender);

  let content = text;
  if (!message.ciphertext) content = "[Sent before encryption; can't be shown]";
  else if (failed) content = "[This message could not be decrypted]";
  else if (text === undefined) content = "Decrypting...";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isOwnMessage ? "flex-end" : "flex-start",
        marginBottom: "10px",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderRadius: "12px",
          maxWidth: "70%",
        }}
      >
        {content}
      </div>
    </div>
  );
};

export default MessageBubble;
