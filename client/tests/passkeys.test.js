import { describe, it, expect, beforeAll } from "vitest";
import { createKeyBundle, unlockPrivateKey } from "../src/crypto/keys.js";
import { lockWithSecret, openWithSecret } from "../src/crypto/passkeys.js";

// The passkey copy of the private key (step 79), without a device: the PRF
// secret is what a passkey would give. Runs in Node (same Web Crypto).
const TIMEOUT = 30_000;
const PASSWORD = "Secret@123";
const secret = () => crypto.getRandomValues(new Uint8Array(32));
const fromBase64 = (text) => Buffer.from(text, "base64");

// The ECDH secret a key makes with another public key: the same key gives the same bytes.
const sharedWith = async (privateKey, publicKeyBase64) => {
  const publicKey = await crypto.subtle.importKey("spki", fromBase64(publicKeyBase64), { name: "ECDH", namedCurve: "P-256" }, false, []);
  return Buffer.from(await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256)).toString("hex");
};

describe("passkey copy of the private key", () => {
  let mine, other, prf, copy;
  beforeAll(async () => {
    [mine, other] = await Promise.all([createKeyBundle(PASSWORD), createKeyBundle("Other@456")]);
    prf = secret();
    copy = await lockWithSecret(mine.encryptedPrivateKey, PASSWORD, prf, "user-1");
  }, TIMEOUT);

  it("opens with the passkey's secret, and is the same key the password opens", async () => {
    const fromPasskey = await openWithSecret(copy, prf, "user-1");
    const fromPassword = await unlockPrivateKey(mine.encryptedPrivateKey, PASSWORD);
    expect(await sharedWith(fromPasskey, other.publicKey)).toBe(await sharedWith(fromPassword, other.publicKey));
  }, TIMEOUT);

  it("opened, it can't be read out (non-extractable), like the password-unlocked key", async () => {
    const key = await openWithSecret(copy, prf, "user-1");
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", key)).rejects.toThrow();
  });

  it("is useless without that passkey: another secret doesn't open it", async () => {
    await expect(openWithSecret(copy, secret(), "user-1")).rejects.toMatchObject({ reason: "mismatch" });
  });

  it("is bound to its account: the right secret for another user id doesn't open it", async () => {
    await expect(openWithSecret(copy, prf, "user-2")).rejects.toMatchObject({ reason: "mismatch" });
  });

  it("holds no part of the key in the clear, and a fresh IV every time", async () => {
    const again = await lockWithSecret(mine.encryptedPrivateKey, PASSWORD, prf, "user-1");
    expect(again.iv).not.toBe(copy.iv);
    expect(again.data).not.toBe(copy.data);
    expect(copy.data).not.toContain(mine.encryptedPrivateKey.data.slice(0, 16));
  }, TIMEOUT);

  it("can only be made with the right password", async () => {
    await expect(lockWithSecret(mine.encryptedPrivateKey, "wrong-password", prf, "user-1")).rejects.toThrow();
  }, TIMEOUT);
});
