// End-to-end encryption for groups (step 68).
//
// 1. Group key: a random AES-256-GCM key per "epoch", made in a member's
//    browser. A new epoch starts whenever someone leaves or is removed, so
//    they can't read what comes after.
// 2. Each person gets their own locked copy: AES-GCM with a key that only the
//    one who locked it and the recipient can derive: ECDH(private key, the
//    other's public key) → HKDF, bound to the group and the epoch (like the
//    1:1 conversation keys in messages.js, with a different label). The
//    authenticated data names group, epoch and recipient, so the server can't
//    pass a copy off as another one. The server stores only locked copies.
// 3. Messages: AES-GCM with the group key and a fresh IV; group, epoch and
//    sender are authenticated data: changing any of them makes decryption fail.
//
// The group key stays extractable in memory only so it can be locked again for
// people invited later (Web Crypto can't wrap a non-extractable key).
import { fromBase64, toBase64 } from "./base64.js";

const WRAP_INFO_PREFIX = "openchat/group-key/v1/";
const MESSAGE_LABEL = "openchat/group-message/v1";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const importPublicKey = (publicKeyBase64) =>
  crypto.subtle.importKey("spki", fromBase64(publicKeyBase64), { name: "ECDH", namedCurve: "P-256" }, false, []);

// The key that locks/unlocks one person's copy of one epoch. Both sides derive
// the same one: my private key with their public key, or the other way round.
const deriveLockingKey = async (myPrivateKey, theirPublicKeyBase64, groupId, epoch) => {
  const sharedSecret = await crypto.subtle.deriveBits({ name: "ECDH", public: await importPublicKey(theirPublicKeyBase64) }, myPrivateKey, 256);
  const secretKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: textEncoder.encode(`${WRAP_INFO_PREFIX}${groupId}/${epoch}`) },
    secretKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
};

const copyLabel = (groupId, epoch, recipientId) => textEncoder.encode(`${WRAP_INFO_PREFIX}${groupId}/${epoch}/${recipientId}`);

export const createGroupKey = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);

// A copy of the group key for one person: { userId, ciphertext, iv }.
export const lockGroupKey = async (groupKey, myPrivateKey, recipient, groupId, epoch) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const lockingKey = await deriveLockingKey(myPrivateKey, recipient.publicKey, groupId, epoch);
  const locked = await crypto.subtle.wrapKey("raw", groupKey, lockingKey, { name: "AES-GCM", iv, additionalData: copyLabel(groupId, epoch, recipient._id) });
  return { userId: recipient._id, ciphertext: toBase64(locked), iv: toBase64(iv) };
};

// My copy, locked by `wrapperPublicKey`'s owner. Throws if it was changed, is
// someone else's copy, or belongs to another group or epoch.
export const unlockGroupKey = async (myPrivateKey, myId, wrapperPublicKey, { ciphertext, iv }, groupId, epoch) => {
  const lockingKey = await deriveLockingKey(myPrivateKey, wrapperPublicKey, groupId, epoch);
  return crypto.subtle.unwrapKey(
    "raw",
    fromBase64(ciphertext),
    lockingKey,
    { name: "AES-GCM", iv: fromBase64(iv), additionalData: copyLabel(groupId, epoch, myId) },
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
};

const messageLabel = (groupId, epoch, senderId) => textEncoder.encode(`${MESSAGE_LABEL}/${groupId}/${epoch}/${senderId}`);

export const encryptGroupMessage = async (groupKey, text, { groupId, epoch, senderId }) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: messageLabel(groupId, epoch, senderId) }, groupKey, textEncoder.encode(text));
  return { ciphertext: toBase64(ciphertext), iv: toBase64(iv) };
};

// Throws if the key is wrong, or the ciphertext, IV, group, epoch or sender was changed.
export const decryptGroupMessage = async (groupKey, { ciphertext, iv }, { groupId, epoch, senderId }) => {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv), additionalData: messageLabel(groupId, epoch, senderId) },
    groupKey,
    fromBase64(ciphertext),
  );
  return textDecoder.decode(plaintext);
};
