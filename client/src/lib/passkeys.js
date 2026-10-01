import api from "../api/api.js";

// This account's passkey copies of the locked private key (crypto/passkeys.js).
export const fetchPasskeys = async () => (await api.get("/users/me/passkeys")).data.passkeys;
export const savePasskey = async (copy) => (await api.post("/users/me/passkeys", copy)).data.passkey;
export const deletePasskey = (passkeyId) => api.delete(`/users/me/passkeys/${passkeyId}`);

// What to tell the user when a passkey couldn't be used (PasskeyError.reason).
export const passkeyProblem = (reason, passwordName = "password") =>
  ({
    unsupported: `This browser or device can't unlock with a passkey yet. Keep using your ${passwordName} here.`,
    cancelled: "No passkey was used. Try again when you're ready.",
    exists: "This device can already unlock your messages.",
    mismatch: `That passkey can't unlock this account. Use your ${passwordName}.`,
  })[reason] ?? `Something went wrong with the passkey. Use your ${passwordName}.`;
