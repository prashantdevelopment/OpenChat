// End-to-end encryption keys. Every Web Crypto call for OpenChat lives in
// src/crypto/, nowhere else.
//
// Each user has an ECDH P-256 key pair:
// - the public key is stored on the server as-is (anyone may see it);
// - the private key is locked ("wrapped") with AES-GCM using a key derived
//   from the user's password (PBKDF2). The server stores only that locked
//   blob, so it can never read the private key.

import { fromBase64, toBase64 } from "./base64.js";

// OWASP's current recommendation for PBKDF2-HMAC-SHA256. It makes each password
// guess slow for anyone who steals the locked blob.
export const PBKDF2_ITERATIONS = 600_000;

// What an unlocked private key may be used for: ECDH shared secrets, which
// messages.js turns into per-conversation keys with HKDF.
export const PRIVATE_KEY_USAGES = ["deriveBits"];

// Turns the password into an AES key that can only lock/unlock other keys.
// NFC normalization: the same password typed on different keyboards (e.g.
// Hindi text) must always give the same key.
const deriveWrappingKey = async (password, salt, iterations) => {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
};

// Locks an (extractable) private key with a password: fresh salt and IV
// every time. Returns the encryptedPrivateKey object the server stores.
const lockPrivateKey = async (privateKey, password) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(password, salt, PBKDF2_ITERATIONS);
  const locked = await crypto.subtle.wrapKey("pkcs8", privateKey, wrappingKey, { name: "AES-GCM", iv });
  return { data: toBase64(locked), iv: toBase64(iv), salt: toBase64(salt), iterations: PBKDF2_ITERATIONS };
};

// Opens a locked private key. Throws if the password is wrong (AES-GCM
// detects the mismatch).
const openPrivateKey = async (encryptedPrivateKey, password, extractable) => {
  const { data, iv, salt, iterations } = encryptedPrivateKey;
  const wrappingKey = await deriveWrappingKey(password, fromBase64(salt), iterations);
  return crypto.subtle.unwrapKey(
    "pkcs8",
    fromBase64(data),
    wrappingKey,
    { name: "AES-GCM", iv: fromBase64(iv) },
    { name: "ECDH", namedCurve: "P-256" },
    extractable,
    PRIVATE_KEY_USAGES,
  );
};

// Creates a new key pair for registration. Returns what the server stores.
export const createKeyBundle = async (password) => {
  // extractable: true only so the private key can be locked right now; the
  // unlocked key used later is non-extractable.
  const keyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, PRIVATE_KEY_USAGES);
  const publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);

  return {
    publicKey: toBase64(publicKey),
    encryptedPrivateKey: await lockPrivateKey(keyPair.privateKey, password),
  };
};

// Unlocks the private key with the password. The result is non-extractable:
// JavaScript can use it but can never read its bytes, even via an XSS bug.
export const unlockPrivateKey = (encryptedPrivateKey, password) =>
  openPrivateKey(encryptedPrivateKey, password, false);

// Password change: the same private key, locked again with the new password,
// so everything encrypted before stays readable. The key is extractable only
// inside this function, just long enough to lock it again.
export const rewrapPrivateKey = async (encryptedPrivateKey, currentPassword, newPassword) => {
  const privateKey = await openPrivateKey(encryptedPrivateKey, currentPassword, true);
  return lockPrivateKey(privateKey, newPassword);
};

// A second locked copy of the private key, with another AES key (a passkey's,
// see passkeys.js): opened with the password, locked again right away. As
// above, the key is extractable only inside this function.
export const lockCopyWithKey = async (encryptedPrivateKey, password, wrappingKey) => {
  const privateKey = await openPrivateKey(encryptedPrivateKey, password, true);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const locked = await crypto.subtle.wrapKey("pkcs8", privateKey, wrappingKey, { name: "AES-GCM", iv });
  return { data: toBase64(locked), iv: toBase64(iv) };
};

// Opens such a copy (non-extractable, like unlockPrivateKey). Throws if the
// wrapping key is not the one it was locked with.
export const openCopyWithKey = (copy, wrappingKey) =>
  crypto.subtle.unwrapKey(
    "pkcs8",
    fromBase64(copy.data),
    wrappingKey,
    { name: "AES-GCM", iv: fromBase64(copy.iv) },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    PRIVATE_KEY_USAGES,
  );
