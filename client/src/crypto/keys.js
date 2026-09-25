// End-to-end encryption keys. Every Web Crypto call for OpenChat lives in
// src/crypto/, nowhere else.
//
// Each user has an ECDH P-256 key pair:
// - the public key is stored on the server as-is (anyone may see it);
// - the private key is locked ("wrapped") with AES-GCM using a key derived
//   from the user's password (PBKDF2). The server stores only that locked
//   blob, so it can never read the private key.

// OWASP's current recommendation for PBKDF2-HMAC-SHA256. It makes each password
// guess slow for anyone who steals the locked blob.
export const PBKDF2_ITERATIONS = 600_000;

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

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

// Creates a new key pair for registration. Returns what the server stores.
export const createKeyBundle = async (password) => {
  // extractable: true only so the private key can be wrapped right now; the
  // unlocked key used later is imported as non-extractable.
  const keyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(password, salt, PBKDF2_ITERATIONS);

  const lockedPrivateKey = await crypto.subtle.wrapKey("pkcs8", keyPair.privateKey, wrappingKey, { name: "AES-GCM", iv });
  const publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);

  return {
    publicKey: toBase64(publicKey),
    encryptedPrivateKey: {
      data: toBase64(lockedPrivateKey),
      iv: toBase64(iv),
      salt: toBase64(salt),
      iterations: PBKDF2_ITERATIONS,
    },
  };
};

// Unlocks the private key with the password. The result is non-extractable:
// JavaScript can use it but can never read its bytes, even via an XSS bug.
// Throws if the password is wrong (AES-GCM detects the mismatch).
export const unlockPrivateKey = async (encryptedPrivateKey, password) => {
  const { data, iv, salt, iterations } = encryptedPrivateKey;
  const wrappingKey = await deriveWrappingKey(password, fromBase64(salt), iterations);
  return crypto.subtle.unwrapKey(
    "pkcs8",
    fromBase64(data),
    wrappingKey,
    { name: "AES-GCM", iv: fromBase64(iv) },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"],
  );
};
