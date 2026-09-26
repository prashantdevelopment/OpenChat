import { fromBase64, toBase64 } from "./base64.js";

// Files (photos) are encrypted with a fresh random AES-256-GCM key each. The
// key travels inside the message, which is itself end-to-end encrypted, so
// only the two participants can ever open the file. The server stores the
// encrypted bytes and never sees a key.
export const encryptFile = async (bytes) => {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return { ciphertext, key: toBase64(rawKey), iv: toBase64(iv) };
};

// Throws if the bytes were changed (AES-GCM checks them) or the key is wrong.
export const decryptFile = async (ciphertext, { key, iv }) => {
  const aesKey = await crypto.subtle.importKey("raw", fromBase64(key), "AES-GCM", false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, aesKey, ciphertext);
};
