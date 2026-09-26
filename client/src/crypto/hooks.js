import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { decryptMessage, deriveConversationKey } from "./messages.js";

// Conversation keys are derived once per session and conversation, then shared
// by the sidebar preview and the open chat. Keyed by the private key object,
// so logging in again (a new private key) starts with an empty cache.
const keyCache = new WeakMap(); // privateKey -> Map(conversationId -> Promise<CryptoKey>)

export const getConversationKey = (privateKey, peerPublicKey, conversationId) => {
  if (!keyCache.has(privateKey)) keyCache.set(privateKey, new Map());
  const keys = keyCache.get(privateKey);
  if (!keys.has(conversationId)) {
    keys.set(conversationId, deriveConversationKey(privateKey, peerPublicKey, conversationId));
  }
  return keys.get(conversationId);
};

// The AES key for one conversation, or null while it is being derived (or if
// the other person's public key isn't known yet).
export const useConversationKey = (conversationId, peerPublicKey) => {
  const { privateKey } = useAuth();
  const [result, setResult] = useState({ conversationId: null, key: null });

  useEffect(() => {
    if (!privateKey || !peerPublicKey) return;
    let ignore = false;
    getConversationKey(privateKey, peerPublicKey, conversationId)
      .then((key) => {
        if (!ignore) setResult({ conversationId, key });
      })
      .catch((error) => console.error("Could not derive the conversation key:", error));
    return () => {
      ignore = true;
    };
  }, [privateKey, peerPublicKey, conversationId]);

  return result.conversationId === conversationId ? result.key : null;
};

// Text already known for a message: decrypted once, or encrypted by us before
// sending. Seeing it again (the server's copy of what we just sent, the
// sidebar preview, reopening a chat) then shows the text at once instead of
// flashing "Decrypting...". Per conversation key, and the entry covers sender,
// IV and ciphertext: the same ciphertext under another key or sender is not a
// match and still goes through real decryption.
const knownTexts = new WeakMap(); // conversationKey -> Map(entry -> text)
const entryOf = (encrypted, senderId) => `${senderId}|${encrypted.iv}|${encrypted.ciphertext}`;

export const rememberText = (conversationKey, encrypted, senderId, text) => {
  if (!knownTexts.has(conversationKey)) knownTexts.set(conversationKey, new Map());
  knownTexts.get(conversationKey).set(entryOf(encrypted, senderId), text);
};

const knownText = (conversationKey, encrypted, senderId) =>
  conversationKey && encrypted?.ciphertext
    ? knownTexts.get(conversationKey)?.get(entryOf(encrypted, senderId))
    : undefined;

// Decrypts { ciphertext, iv } sent by senderId.
// Returns { text } when done, { failed: true } if it can't be decrypted
// (tampered, wrong key), and {} while waiting.
export const useDecryptedText = (conversationKey, encrypted, senderId) => {
  const [result, setResult] = useState({ source: null });
  const known = knownText(conversationKey, encrypted, senderId);

  useEffect(() => {
    if (!conversationKey || !encrypted?.ciphertext || known !== undefined) return;
    let ignore = false;
    decryptMessage(conversationKey, encrypted, senderId)
      .then((text) => {
        rememberText(conversationKey, encrypted, senderId, text);
        if (!ignore) setResult({ source: encrypted, text });
      })
      .catch(() => {
        if (!ignore) setResult({ source: encrypted, failed: true });
      });
    return () => {
      ignore = true;
    };
  }, [conversationKey, encrypted, senderId, known]);

  if (known !== undefined) return { text: known };
  return result.source === encrypted ? result : {};
};
