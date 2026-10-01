// "Unlock with fingerprint or face" (step 79), with a passkey (WebAuthn) and
// its PRF extension: the device's secure hardware turns a salt into a secret
// that only this passkey gives, and only after the fingerprint, face or PIN.
// That secret (through HKDF) locks a second copy of the private key; the
// server stores the copy but never sees the secret, so it can't open it.
//
// The passkey isn't checked by the server: the user is logged in already, and
// the copy is useless without the device. The challenge is therefore random
// and never sent anywhere.

import { fromBase64, toBase64, toBase64Url } from "./base64.js";
import { lockCopyWithKey, openCopyWithKey } from "./keys.js";

// Why a passkey couldn't be used: "unsupported" (this browser or device has no
// PRF), "cancelled" (closed, timed out, or no matching passkey here),
// "mismatch" (the passkey doesn't open this copy).
export class PasskeyError extends Error {
  constructor(reason, cause) {
    super(reason);
    this.reason = reason;
    this.cause = cause;
  }
}

const TIMEOUT_MS = 60_000;
const random = (bytes) => crypto.getRandomValues(new Uint8Array(bytes));

// Bound to the user: a copy (and secret) of one account can't open another's.
const wrappingKeyFrom = async (secret, userId) => {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode(`openchat/passkey-unlock/v1/${userId}`) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
};

// Can this browser make passkeys at all? (Whether the device has PRF is only
// known once one is made.)
export const canUsePasskeys = () => typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && Boolean(navigator.credentials?.create);

// Tells the device's password manager that OpenChat no longer knows this
// passkey, so it can remove it (newer browsers; elsewhere nothing happens and
// the user can remove it in the device's settings).
export const forgetPasskey = (credentialId) =>
  window.PublicKeyCredential?.signalUnknownCredential?.({ rpId: location.hostname, credentialId: toBase64Url(fromBase64(credentialId)) }).catch(() => {});

// The browser's own errors, as a PasskeyError.
const asPasskeyError = (error) => {
  if (error instanceof PasskeyError) return error;
  if (error?.name === "NotAllowedError" || error?.name === "AbortError") return new PasskeyError("cancelled", error);
  if (error?.name === "InvalidStateError") return new PasskeyError("exists", error);
  if (error?.name === "NotSupportedError" || error?.name === "SecurityError") return new PasskeyError("unsupported", error);
  return new PasskeyError("failed", error);
};

// The secret of one of these passkeys (the user picks one and confirms with
// their fingerprint, face or PIN). copies: [{ credentialId, salt, ... }].
// Returns { copy, secret }: which copy, and its passkey's secret.
const secretFrom = async (copies) => {
  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        timeout: TIMEOUT_MS,
        userVerification: "required",
        allowCredentials: copies.map((copy) => ({ type: "public-key", id: fromBase64(copy.credentialId) })),
        extensions: { prf: { evalByCredential: Object.fromEntries(copies.map((copy) => [toBase64Url(fromBase64(copy.credentialId)), { first: fromBase64(copy.salt) }])) } },
      },
    });
  } catch (error) {
    throw asPasskeyError(error);
  }
  const copy = copies.find((candidate) => candidate.credentialId === toBase64(assertion.rawId));
  const secret = assertion.getClientExtensionResults().prf?.results?.first;
  if (!copy || !secret) throw new PasskeyError("unsupported");
  return { copy, secret };
};

// Settings, "Add this device": a new passkey here, and the private key locked
// with its secret. Needs the password (to open the key once). existing: this
// account's copies (a device that has one isn't asked to make a second).
// Returns what the server stores: { credentialId, salt, data, iv }.
export const createPasskeyCopy = async ({ user, encryptedPrivateKey, password, existing = [] }) => {
  const salt = random(32);
  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        rp: { name: "OpenChat" },
        user: { id: new TextEncoder().encode(user._id), name: user.username, displayName: user.name || user.username },
        challenge: random(32),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        timeout: TIMEOUT_MS,
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        excludeCredentials: existing.map((copy) => ({ type: "public-key", id: fromBase64(copy.credentialId) })),
        extensions: { prf: { eval: { first: salt } } },
      },
    });
  } catch (error) {
    throw asPasskeyError(error);
  }
  const credentialId = toBase64(credential.rawId);
  const prf = credential.getClientExtensionResults().prf;
  if (!prf?.enabled) {
    // Made, but it can't unlock anything: ask the device to drop it again.
    forgetPasskey(credentialId);
    throw new PasskeyError("unsupported");
  }
  // Some devices give the secret while making the passkey; the others when it is used.
  const secret = prf.results?.first ?? (await secretFrom([{ credentialId, salt: toBase64(salt) }])).secret;
  return { credentialId, salt: toBase64(salt), ...(await lockWithSecret(encryptedPrivateKey, password, secret, user._id)) };
};

// The unlock screen: the private key from one of this account's passkey copies
// (non-extractable). Throws a PasskeyError.
export const unlockWithPasskey = async (copies, userId) => {
  const { copy, secret } = await secretFrom(copies);
  return openWithSecret(copy, secret, userId);
};

// The private key locked / opened with a passkey's secret.
export const lockWithSecret = async (encryptedPrivateKey, password, secret, userId) =>
  lockCopyWithKey(encryptedPrivateKey, password, await wrappingKeyFrom(secret, userId));
export const openWithSecret = async (copy, secret, userId) => {
  try {
    return await openCopyWithKey(copy, await wrappingKeyFrom(secret, userId));
  } catch (error) {
    throw new PasskeyError("mismatch", error);
  }
};
