import { describe, it, expect, beforeAll } from "vitest";
import { createKeyBundle, unlockPrivateKey } from "../src/crypto/keys.js";
import { createGroupKey, decryptGroupMessage, encryptGroupMessage, lockGroupKey, unlockGroupKey } from "../src/crypto/groupKeys.js";

const TIMEOUT = 60_000;
const GROUP_ID = "64b0000000000000000000aa";
const OTHER_GROUP_ID = "64b0000000000000000000bb";

// alice made the group; bob and carol are members; dave was removed; eve is an outsider.
const people = {};
const person = async (name, n) => {
  const bundle = await createKeyBundle(`${name} pw`);
  people[name] = { _id: `64b00000000000000000000${n}`, publicKey: bundle.publicKey, privateKey: await unlockPrivateKey(bundle.encryptedPrivateKey, `${name} pw`) };
};
// Unlock my copy the way the app does: my private key, the locker's public key.
const unlock = (me, lockedBy, copy, groupId = GROUP_ID, epoch = 1) => unlockGroupKey(me.privateKey, me._id, lockedBy.publicKey, copy, groupId, epoch);

const meta = (senderId, epoch = 1, groupId = GROUP_ID) => ({ groupId, epoch, senderId });

let epoch1, copies1;

beforeAll(async () => {
  await Promise.all([person("alice", 1), person("bob", 2), person("carol", 3), person("dave", 4), person("eve", 5)]);
  const { alice, bob, carol, dave } = people;
  epoch1 = await createGroupKey();
  copies1 = Object.fromEntries(
    await Promise.all([alice, bob, carol, dave].map(async (p) => [p._id, await lockGroupKey(epoch1, alice.privateKey, p, GROUP_ID, 1)])),
  );
}, TIMEOUT);

describe("locked copies of the group key", () => {
  it("each member opens their own copy (alice locked them) and gets the same key", async () => {
    const { alice, bob, carol } = people;
    const text = await encryptGroupMessage(epoch1, "namaste group", { groupId: GROUP_ID, epoch: 1, senderId: alice._id });
    for (const me of [alice, bob, carol]) {
      const key = await unlock(me, alice, copies1[me._id]);
      expect(await decryptGroupMessage(key, text, { groupId: GROUP_ID, epoch: 1, senderId: alice._id })).toBe("namaste group");
    }
  });

  it("a copy is only {userId, ciphertext, iv}: 48 bytes (key + tag) and a 12-byte IV, not the key", async () => {
    const copy = copies1[people.bob._id];
    expect(Object.keys(copy).sort()).toEqual(["ciphertext", "iv", "userId"]);
    expect(Buffer.from(copy.ciphertext, "base64")).toHaveLength(48);
    expect(Buffer.from(copy.iv, "base64")).toHaveLength(12);
    const raw = Buffer.from(await crypto.subtle.exportKey("raw", epoch1)).toString("base64");
    expect(copy.ciphertext).not.toContain(raw);
  });

  it("an outsider can't open anyone's copy, not even with the locker's public key", async () => {
    const { alice, bob, eve } = people;
    await expect(unlockGroupKey(eve.privateKey, eve._id, alice.publicKey, copies1[bob._id], GROUP_ID, 1)).rejects.toThrow();
    await expect(unlockGroupKey(eve.privateKey, bob._id, alice.publicKey, copies1[bob._id], GROUP_ID, 1)).rejects.toThrow();
  });

  it("a copy passed off as someone else's, another group's or another epoch's doesn't open", async () => {
    const { alice, bob, carol } = people;
    await expect(unlock(carol, alice, copies1[bob._id])).rejects.toThrow(); // bob's copy given to carol
    await expect(unlock(bob, alice, copies1[bob._id], OTHER_GROUP_ID)).rejects.toThrow();
    await expect(unlock(bob, alice, copies1[bob._id], GROUP_ID, 2)).rejects.toThrow();
    await expect(unlock(bob, carol, copies1[bob._id])).rejects.toThrow(); // "locked by carol": wrong key
    // bob's copy handed to alice as if bob had locked it for her: the same ECDH
    // secret, but the copy names bob as its recipient
    await expect(unlock(alice, bob, copies1[bob._id])).rejects.toThrow();
  });

  it("a changed copy doesn't open", async () => {
    const { alice, bob } = people;
    const copy = copies1[bob._id];
    const bytes = Buffer.from(copy.ciphertext, "base64");
    bytes[5] ^= 1;
    await expect(unlock(bob, alice, { ...copy, ciphertext: bytes.toString("base64") })).rejects.toThrow();
  });
});

describe("group messages", () => {

  it("only the text's ciphertext and a fresh IV travel", async () => {
    const a = await encryptGroupMessage(epoch1, "same text", meta(people.alice._id));
    const b = await encryptGroupMessage(epoch1, "same text", meta(people.alice._id));
    expect(Object.keys(a).sort()).toEqual(["ciphertext", "iv"]);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("a changed sender, group, epoch or text fails to decrypt", async () => {
    const { alice, bob } = people;
    const message = await encryptGroupMessage(epoch1, "meet at 6", meta(alice._id));
    await expect(decryptGroupMessage(epoch1, message, meta(bob._id))).rejects.toThrow();
    await expect(decryptGroupMessage(epoch1, message, meta(alice._id, 1, OTHER_GROUP_ID))).rejects.toThrow();
    await expect(decryptGroupMessage(epoch1, message, meta(alice._id, 2))).rejects.toThrow();
    const bytes = Buffer.from(message.ciphertext, "base64");
    bytes[0] ^= 1;
    await expect(decryptGroupMessage(epoch1, { ...message, ciphertext: bytes.toString("base64") }, meta(alice._id))).rejects.toThrow();
  });
});

describe("dave is removed: a new epoch", () => {
  it("members open the new key; dave (with the old one) and eve can't read what follows", async () => {
    const { alice, bob, carol, dave, eve } = people;
    // bob makes epoch 2 for the members left, dave not among them
    const epoch2 = await createGroupKey();
    const copies2 = Object.fromEntries(
      await Promise.all([alice, bob, carol].map(async (p) => [p._id, await lockGroupKey(epoch2, bob.privateKey, p, GROUP_ID, 2)])),
    );
    const message = await encryptGroupMessage(epoch2, "after dave left", meta(carol._id, 2));
    for (const me of [alice, bob, carol]) {
      const key = await unlock(me, bob, copies2[me._id], GROUP_ID, 2);
      expect(await decryptGroupMessage(key, message, meta(carol._id, 2))).toBe("after dave left");
    }
    // dave still has epoch 1: useless for epoch 2, however it's labelled
    const davesOld = await unlock(dave, alice, copies1[dave._id]);
    await expect(decryptGroupMessage(davesOld, message, meta(carol._id, 2))).rejects.toThrow();
    await expect(decryptGroupMessage(davesOld, message, meta(carol._id, 1))).rejects.toThrow();
    // and no copy of epoch 2 opens for him or eve
    for (const outsider of [dave, eve]) {
      for (const copy of Object.values(copies2)) {
        await expect(unlockGroupKey(outsider.privateKey, outsider._id, bob.publicKey, copy, GROUP_ID, 2)).rejects.toThrow();
      }
    }
  }, TIMEOUT);
});
