import { describe, it, expect } from "vitest";
import { decryptFile, encryptFile } from "../src/crypto/files.js";

const bytes = new TextEncoder().encode("pretend these are the bytes of a photo");

describe("file encryption", () => {
  it("round-trips, and the ciphertext doesn't contain the file", async () => {
    const { ciphertext, key, iv } = await encryptFile(bytes);
    expect(new TextDecoder().decode(ciphertext)).not.toContain("photo");
    expect(new Uint8Array(await decryptFile(ciphertext, { key, iv }))).toEqual(bytes);
  });

  it("gives every file its own key and IV", async () => {
    const [a, b] = await Promise.all([encryptFile(bytes), encryptFile(bytes)]);
    expect(a.key).not.toBe(b.key);
    expect(a.iv).not.toBe(b.iv);
  });

  it("refuses a changed file or the wrong key", async () => {
    const { ciphertext, key, iv } = await encryptFile(bytes);
    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 1;
    await expect(decryptFile(tampered, { key, iv })).rejects.toThrow();
    const other = await encryptFile(bytes);
    await expect(decryptFile(ciphertext, { key: other.key, iv })).rejects.toThrow();
  });
});
