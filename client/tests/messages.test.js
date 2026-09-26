import { describe, it, expect, beforeAll } from "vitest";
import { createKeyBundle, unlockPrivateKey } from "../src/crypto/keys.js";
import { deriveConversationKey, encryptMessage, decryptMessage } from "../src/crypto/messages.js";

const TIMEOUT = 30_000;
const ALICE_ID = "64b000000000000000000001";
const BOB_ID = "64b000000000000000000002";
const CONVERSATION_ID = "64b0000000000000000000aa";

let alice, bob, aliceKey, bobKey;

beforeAll(async () => {
  const [aliceBundle, bobBundle] = await Promise.all([createKeyBundle("alice pw"), createKeyBundle("bob pw")]);
  const [alicePrivate, bobPrivate] = await Promise.all([
    unlockPrivateKey(aliceBundle.encryptedPrivateKey, "alice pw"),
    unlockPrivateKey(bobBundle.encryptedPrivateKey, "bob pw"),
  ]);
  alice = { privateKey: alicePrivate, publicKey: aliceBundle.publicKey };
  bob = { privateKey: bobPrivate, publicKey: bobBundle.publicKey };
  // Each side derives the conversation key on its own, from its private key
  // and the other person's public key.
  aliceKey = await deriveConversationKey(alice.privateKey, bob.publicKey, CONVERSATION_ID);
  bobKey = await deriveConversationKey(bob.privateKey, alice.publicKey, CONVERSATION_ID);
}, TIMEOUT);

describe("message encryption", () => {
  it("alice encrypts, bob decrypts (both derived the key independently)", async () => {
    const encrypted = await encryptMessage(aliceKey, "hello bob", ALICE_ID);
    expect(await decryptMessage(bobKey, encrypted, ALICE_ID)).toBe("hello bob");
  });

  it("the conversation key cannot be exported (it never leaves the browser)", async () => {
    expect(aliceKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", aliceKey)).rejects.toThrow();
  });

  it("sends only ciphertext and a 12-byte IV, never the text", async () => {
    const encrypted = await encryptMessage(aliceKey, "secret plan", ALICE_ID);
    expect(Object.keys(encrypted).sort()).toEqual(["ciphertext", "iv"]);
    expect(Buffer.from(encrypted.iv, "base64")).toHaveLength(12);
    expect(JSON.stringify(encrypted)).not.toContain("secret plan");
    // AES-GCM output = text bytes + 16-byte authentication tag
    expect(Buffer.from(encrypted.ciphertext, "base64")).toHaveLength("secret plan".length + 16);
  });

  it("uses a fresh IV every time: the same text never looks the same twice", async () => {
    const [first, second] = await Promise.all([
      encryptMessage(aliceKey, "same text", ALICE_ID),
      encryptMessage(aliceKey, "same text", ALICE_ID),
    ]);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it.each([
    ["Hindi", "नमस्ते, कैसे हो?"],
    ["emoji", "chalo 🚀🔥 party 🎉"],
    ["the maximum length", "a".repeat(2000)],
  ])("round-trips %s", async (_name, text) => {
    const encrypted = await encryptMessage(aliceKey, text, ALICE_ID);
    expect(await decryptMessage(bobKey, encrypted, ALICE_ID)).toBe(text);
  });

  it("fails if the server claims someone else sent it", async () => {
    const encrypted = await encryptMessage(aliceKey, "from alice", ALICE_ID);
    await expect(decryptMessage(bobKey, encrypted, BOB_ID)).rejects.toThrow();
  });

  it("fails if the ciphertext was changed", async () => {
    const encrypted = await encryptMessage(aliceKey, "do not touch", ALICE_ID);
    const bytes = Buffer.from(encrypted.ciphertext, "base64");
    bytes[0] ^= 1;
    await expect(decryptMessage(bobKey, { ...encrypted, ciphertext: bytes.toString("base64") }, ALICE_ID)).rejects.toThrow();
  });

  it("a message moved into another conversation cannot be read there", async () => {
    const encrypted = await encryptMessage(aliceKey, "only for this chat", ALICE_ID);
    const otherConversationKey = await deriveConversationKey(bob.privateKey, alice.publicKey, "64b0000000000000000000bb");
    await expect(decryptMessage(otherConversationKey, encrypted, ALICE_ID)).rejects.toThrow();
  });

  it("an outsider with their own keys cannot read it", async () => {
    const eveBundle = await createKeyBundle("eve pw");
    const evePrivate = await unlockPrivateKey(eveBundle.encryptedPrivateKey, "eve pw");
    const eveKey = await deriveConversationKey(evePrivate, alice.publicKey, CONVERSATION_ID);
    const encrypted = await encryptMessage(aliceKey, "not for eve", ALICE_ID);
    await expect(decryptMessage(eveKey, encrypted, ALICE_ID)).rejects.toThrow();
  }, TIMEOUT);
});
