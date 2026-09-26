import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { decryptMessage, deriveConversationKey } from "./messages.js";

// Conversation keys are derived once per session and conversation, then shared
// by the sidebar preview and the open chat. Keyed by the private key object,
// so logging in again (a new private key) starts with an empty cache.
const keyCache = new WeakMap(); // privateKey -> Map(conversationId -> Promise<CryptoKey>)

const getConversationKey = (privateKey, peerPublicKey, conversationId) => {
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

// Decrypts { ciphertext, iv } sent by senderId.
// Returns { text } when done, { failed: true } if it can't be decrypted
// (tampered, wrong key), and {} while waiting.
export const useDecryptedText = (conversationKey, encrypted, senderId) => {
  const [result, setResult] = useState({ source: null });

  useEffect(() => {
    if (!conversationKey || !encrypted?.ciphertext) return;
    let ignore = false;
    decryptMessage(conversationKey, encrypted, senderId)
      .then((text) => {
        if (!ignore) setResult({ source: encrypted, text });
      })
      .catch(() => {
        if (!ignore) setResult({ source: encrypted, failed: true });
      });
    return () => {
      ignore = true;
    };
  }, [conversationKey, encrypted, senderId]);

  return result.source === encrypted ? result : {};
};
