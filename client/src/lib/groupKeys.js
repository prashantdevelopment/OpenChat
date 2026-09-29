import api from "../api/api.js";
import { checkPeerKey } from "../crypto/keyPins.js";
import { createGroupKey, lockGroupKey, unlockGroupKey } from "../crypto/groupKeys.js";
import { displayName } from "./people.js";

// The group key, end to end (crypto/groupKeys.js has the cryptography).
// Trust on first use covers it too: a copy is never locked for, or accepted
// from, a person whose key differs from the one this device saw before.

class KeyChangedError extends Error {
  constructor(person) {
    super(`${displayName(person)}'s security key has changed. Check it in your chat with them first.`);
    this.person = person;
  }
}

const assertPinned = async (me, person) => {
  if (person._id === me._id) return;
  if ((await checkPeerKey(me._id, person._id, person.publicKey)) === "changed") throw new KeyChangedError(person);
};

// A copy of groupKey for each person (the same copy for me as for anyone).
const lockFor = async (groupKey, me, privateKey, people, groupId, epoch) => {
  for (const person of people) await assertPinned(me, person);
  return Promise.all(people.map((person) => lockGroupKey(groupKey, privateKey, person, groupId, epoch)));
};

// Unlocked keys, per login (private key) and group: epoch -> Promise<CryptoKey>.
const unlocked = new WeakMap();
const cacheFor = (privateKey, groupId) => {
  if (!unlocked.has(privateKey)) unlocked.set(privateKey, new Map());
  const groups = unlocked.get(privateKey);
  if (!groups.has(groupId)) groups.set(groupId, new Map());
  return groups.get(groupId);
};

// A random id for a new group, chosen here: the copies are bound to it.
const newGroupId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

// My keys for a group: { currentEpoch, needsNewKey, recipients, keys: Map(epoch -> CryptoKey) }.
// A copy that can't be opened (changed on the way, or locked by someone
// whose key changed) is left out: messages of that epoch can't be read.
export const loadGroupKeys = async (me, privateKey, groupId) => {
  const { data } = await api.get(`/groups/${groupId}/keys`);
  const cache = cacheFor(privateKey, groupId);
  const keys = new Map();
  await Promise.all(
    data.keys.map(async (copy) => {
      if (!cache.has(copy.epoch)) {
        const opening = (async () => {
          await assertPinned(me, copy.wrappedBy);
          return unlockGroupKey(privateKey, me._id, copy.wrappedBy.publicKey, copy, groupId, copy.epoch);
        })();
        cache.set(copy.epoch, opening);
        opening.catch(() => cache.delete(copy.epoch)); // try again next time
      }
      try {
        keys.set(copy.epoch, await cache.get(copy.epoch));
      } catch (error) {
        console.error(`Could not open the group key (epoch ${copy.epoch}):`, error);
      }
    }),
  );
  return { currentEpoch: data.currentEpoch, needsNewKey: data.needsNewKey, recipients: data.recipients, keys };
};

// A new group with its first key, locked for me and everyone invited.
export const createGroupWithKey = async (me, privateKey, name, people) => {
  const groupId = newGroupId();
  const groupKey = await createGroupKey();
  const keys = await lockFor(groupKey, me, privateKey, [me, ...people], groupId, 1);
  const { data } = await api.post("/groups", { groupId, name, userIds: people.map((person) => person._id), keys });
  cacheFor(privateKey, groupId).set(1, Promise.resolve(groupKey));
  return data.group;
};

// The next epoch: a new key for every member and invitee. If someone else was
// quicker, theirs is used (409): nothing to do.
export const rotateGroupKey = async (me, privateKey, groupId) => {
  const { currentEpoch, recipients } = await loadGroupKeys(me, privateKey, groupId);
  const epoch = currentEpoch + 1;
  const groupKey = await createGroupKey();
  const keys = await lockFor(groupKey, me, privateKey, recipients, groupId, epoch);
  try {
    await api.post(`/groups/${groupId}/keys`, { epoch, keys });
    cacheFor(privateKey, groupId).set(epoch, Promise.resolve(groupKey));
  } catch (error) {
    if (error.response?.status !== 409) throw error;
  }
};

// Invite people: each gets a copy of the latest key. If the group needs a new
// key first (someone left) or it just changed, that is done and tried again.
export const inviteWithKey = async (me, privateKey, groupId, people) => {
  for (let attempt = 0; ; attempt++) {
    const state = await loadGroupKeys(me, privateKey, groupId);
    if (state.needsNewKey && attempt < 2) {
      await rotateGroupKey(me, privateKey, groupId);
      continue;
    }
    const groupKey = state.keys.get(state.currentEpoch);
    if (!groupKey) throw new Error("This device can't open the group's key");
    const keys = await lockFor(groupKey, me, privateKey, people, groupId, state.currentEpoch);
    try {
      return (await api.post(`/groups/${groupId}/invites`, { userIds: people.map((person) => person._id), keys, epoch: state.currentEpoch })).data;
    } catch (error) {
      if (attempt >= 2 || error.response?.status !== 409 || !["epoch", "rotate"].includes(error.response.data?.reason)) throw error;
    }
  }
};
