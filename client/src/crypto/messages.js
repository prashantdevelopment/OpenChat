// End-to-end encryption of messages.
//
// 1. Conversation key: ECDH(my private key, their public key) gives both
//    people the same shared secret without ever sending it. HKDF turns that
//    secret into an AES-256-GCM key, bound to this conversation's id.
// 2. Each message: AES-GCM with a fresh random 12-byte IV (an IV must never
//    repeat with the same key). The sender's id is authenticated data: if the
//    server changed who a message is "from", decryption fails.
// The server only ever sees { ciphertext, iv }.
import { fromBase64, toBase64 } from "./base64.js";

// A version tag, so the derivation can change later without mixing up keys.
const KEY_INFO_PREFIX = "openchat/message-key/v1/";

// Keep in sync with the server: at most 2000 characters of text.
export const MAX_MESSAGE_LENGTH = 2000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const deriveConversationKey = async (myPrivateKey, theirPublicKeyBase64, conversationId) => {
  const theirPublicKey = await crypto.subtle.importKey(
    "spki",
    fromBase64(theirPublicKeyBase64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = await crypto.subtle.deriveBits({ name: "ECDH", public: theirPublicKey }, myPrivateKey, 256);
  const secretKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: textEncoder.encode(KEY_INFO_PREFIX + conversationId),
    },
    secretKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

export const encryptMessage = async (conversationKey, text, senderId) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: textEncoder.encode(senderId) },
    conversationKey,
    textEncoder.encode(text),
  );
  return { ciphertext: toBase64(ciphertext), iv: toBase64(iv) };
};

// Throws if the key is wrong, or the ciphertext, IV or sender was changed.
export const decryptMessage = async (conversationKey, { ciphertext, iv }, senderId) => {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv), additionalData: textEncoder.encode(senderId) },
    conversationKey,
    fromBase64(ciphertext),
  );
  return textDecoder.decode(plaintext);
};
