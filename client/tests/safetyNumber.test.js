import { describe, it, expect, beforeAll } from "vitest";
import { createKeyBundle } from "../src/crypto/keys.js";
import { computeSafetyNumber } from "../src/crypto/safetyNumber.js";

let alice, bob, mallory;

beforeAll(async () => {
  [alice, bob, mallory] = await Promise.all([createKeyBundle("a pw"), createKeyBundle("b pw"), createKeyBundle("m pw")]);
}, 30_000);

describe("computeSafetyNumber", () => {
  it("is 12 groups of 5 digits", async () => {
    expect(await computeSafetyNumber(alice.publicKey, bob.publicKey)).toMatch(/^\d{5}( \d{5}){11}$/);
  });

  it("is the same on both sides (key order doesn't matter)", async () => {
    expect(await computeSafetyNumber(alice.publicKey, bob.publicKey)).toBe(await computeSafetyNumber(bob.publicKey, alice.publicKey));
  });

  it("changes if the server swaps in someone else's key (man-in-the-middle)", async () => {
    const real = await computeSafetyNumber(alice.publicKey, bob.publicKey);
    // Alice was given mallory's key instead of bob's; bob was given mallory's instead of alice's.
    const seenByAlice = await computeSafetyNumber(alice.publicKey, mallory.publicKey);
    const seenByBob = await computeSafetyNumber(mallory.publicKey, bob.publicKey);
    expect(seenByAlice).not.toBe(real);
    expect(seenByBob).not.toBe(real);
    expect(seenByAlice).not.toBe(seenByBob);
  });
});
