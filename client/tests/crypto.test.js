import { describe, it, expect, beforeAll } from "vitest";
import { createKeyBundle, unlockPrivateKey, rewrapPrivateKey, PBKDF2_ITERATIONS } from "../src/crypto/keys.js";

// Runs in Node, which has the same Web Crypto API as the browser.
// PBKDF2 with 600k iterations is deliberately slow, so allow some time.
const TIMEOUT = 30_000;
const fromBase64 = (text) => Buffer.from(text, "base64");

// Both sides of ECDH should get the same shared secret (as hex, to compare).
const sharedKeyBytes = async (myPrivateKey, theirPublicKeyBase64) => {
  const theirPublicKey = await crypto.subtle.importKey(
    "spki", fromBase64(theirPublicKeyBase64), { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: theirPublicKey }, myPrivateKey, 256);
  return Buffer.from(secret).toString("hex");
};

describe("createKeyBundle / unlockPrivateKey", () => {
  let alice, bob;
  beforeAll(async () => {
    [alice, bob] = await Promise.all([createKeyBundle("alice passphrase"), createKeyBundle("bob passphrase")]);
  }, TIMEOUT);

  it("produces a P-256 public key and a locked private key with its parameters", () => {
    expect(fromBase64(alice.publicKey)).toHaveLength(91); // SPKI encoding of a P-256 key
    expect(fromBase64(alice.encryptedPrivateKey.iv)).toHaveLength(12);
    expect(fromBase64(alice.encryptedPrivateKey.salt)).toHaveLength(16);
    expect(alice.encryptedPrivateKey.iterations).toBe(PBKDF2_ITERATIONS);
    expect(fromBase64(alice.encryptedPrivateKey.data).length).toBeGreaterThan(100);
  });

  it("never reuses a salt or IV and never contains the password", () => {
    expect(alice.encryptedPrivateKey.salt).not.toBe(bob.encryptedPrivateKey.salt);
    expect(alice.encryptedPrivateKey.iv).not.toBe(bob.encryptedPrivateKey.iv);
    expect(JSON.stringify(alice)).not.toContain("alice passphrase");
  });

  it("unlocks with the right password into a usable, non-extractable ECDH key", async () => {
    const privateKey = await unlockPrivateKey(alice.encryptedPrivateKey, "alice passphrase");
    expect(privateKey.algorithm).toMatchObject({ name: "ECDH", namedCurve: "P-256" });
    expect(privateKey.extractable).toBe(false);
    expect(privateKey.usages).toEqual(["deriveBits"]);
    await expect(crypto.subtle.exportKey("pkcs8", privateKey)).rejects.toThrow();
  }, TIMEOUT);

  it("refuses a wrong password", async () => {
    await expect(unlockPrivateKey(alice.encryptedPrivateKey, "wrong passphrase")).rejects.toThrow();
  }, TIMEOUT);

  it("refuses a tampered blob (AES-GCM integrity check)", async () => {
    const bytes = fromBase64(alice.encryptedPrivateKey.data);
    bytes[10] ^= 1;
    const tampered = { ...alice.encryptedPrivateKey, data: bytes.toString("base64") };
    await expect(unlockPrivateKey(tampered, "alice passphrase")).rejects.toThrow();
  }, TIMEOUT);

  it("gives alice and bob the same shared key through ECDH (the basis of step 17)", async () => {
    const [alicePrivate, bobPrivate] = await Promise.all([
      unlockPrivateKey(alice.encryptedPrivateKey, "alice passphrase"),
      unlockPrivateKey(bob.encryptedPrivateKey, "bob passphrase"),
    ]);
    const aliceSide = await sharedKeyBytes(alicePrivate, bob.publicKey);
    const bobSide = await sharedKeyBytes(bobPrivate, alice.publicKey);
    expect(aliceSide).toBe(bobSide);
    expect(aliceSide).toHaveLength(64); // 256-bit key
  }, TIMEOUT);

  it("rewrap (password change): opens with the new password only, and it is still the same key", async () => {
    const relocked = await rewrapPrivateKey(alice.encryptedPrivateKey, "alice passphrase", "alice NEW passphrase");
    expect(relocked.salt).not.toBe(alice.encryptedPrivateKey.salt);
    expect(relocked.iv).not.toBe(alice.encryptedPrivateKey.iv);
    await expect(unlockPrivateKey(relocked, "alice passphrase")).rejects.toThrow();

    // Same key pair: the shared key with bob is unchanged, so old messages stay readable.
    const [before, after] = await Promise.all([
      unlockPrivateKey(alice.encryptedPrivateKey, "alice passphrase"),
      unlockPrivateKey(relocked, "alice NEW passphrase"),
    ]);
    expect(await sharedKeyBytes(after, bob.publicKey)).toBe(await sharedKeyBytes(before, bob.publicKey));
  }, TIMEOUT);

  it("rewrap refuses a wrong current password", async () => {
    await expect(rewrapPrivateKey(alice.encryptedPrivateKey, "wrong", "anything new")).rejects.toThrow();
  }, TIMEOUT);

  it("accepts the same non-English password typed in a different Unicode form", async () => {
    const composed = "मेरा पासवर्ड café".normalize("NFC");
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed);
    const bundle = await createKeyBundle(composed);
    await expect(unlockPrivateKey(bundle.encryptedPrivateKey, decomposed)).resolves.toBeDefined();
  }, TIMEOUT);
});
