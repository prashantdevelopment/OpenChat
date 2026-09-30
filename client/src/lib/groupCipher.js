import { useEffect, useState } from "react";
import socket from "../socket/socket.js";
import { useAuth } from "../auth/AuthContext.js";
import { decryptGroupMessage, encryptGroupMessage } from "../crypto/groupKeys.js";
import { loadGroupKeys, rotateGroupKey } from "./groupKeys.js";

// A group's cipher: what the chat uses instead of a 1:1 conversation key.
//   encrypt(text) -> { ciphertext, iv, epoch }  (with the latest key; if the
//                    group needs a new one first, it is made here)
//   decrypt(message, senderId) -> text          (with the key of the message's epoch)
//   refresh(reason)                             (the server said "rotate" or "epoch")
// One object per login and group, so texts decrypted once stay known
// (crypto/hooks.js remembers them per cipher).
const ciphers = new WeakMap(); // privateKey -> Map(groupId -> cipher)

const createCipher = (me, privateKey, groupId) => {
  let state = null; // { keys, currentEpoch, needsNewKey }
  let loading = null;
  const load = () => {
    loading ??= loadGroupKeys(me, privateKey, groupId)
      .then((next) => {
        state = next;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  };

  const cipher = {
    groupId,
    ready: () => (state ? Promise.resolve() : load()),
    reload: load,
    async refresh(reason) {
      if (reason === "rotate") await rotateGroupKey(me, privateKey, groupId);
      await load();
    },
    async encrypt(text) {
      await cipher.ready();
      if (state.needsNewKey) await cipher.refresh("rotate");
      const epoch = state.currentEpoch;
      const key = state.keys.get(epoch);
      if (!key) throw new Error("This device can't open the group's key");
      return { ...(await encryptGroupMessage(key, text, { groupId, epoch, senderId: me._id })), epoch };
    },
    async decrypt(message, senderId) {
      await cipher.ready();
      // A newer epoch than we have: someone just made it.
      if (!state.keys.has(message.epoch)) await load();
      const key = state.keys.get(message.epoch);
      if (!key) throw new Error("No key for this message");
      return decryptGroupMessage(key, message, { groupId, epoch: message.epoch, senderId });
    },
  };
  return cipher;
};

export const getGroupCipher = (me, privateKey, groupId) => {
  if (!ciphers.has(privateKey)) ciphers.set(privateKey, new Map());
  const groups = ciphers.get(privateKey);
  if (!groups.has(groupId)) groups.set(groupId, createCipher(me, privateKey, groupId));
  return groups.get(groupId);
};

// The cipher for a group once its keys are loaded (null before, or if this
// device can't load them). Loads again when the group gets a new key.
export const useGroupCipher = (groupId) => {
  const { currentUser, privateKey } = useAuth();
  const [ready, setReady] = useState(null); // the groupId whose cipher is ready

  useEffect(() => {
    if (!groupId || !privateKey) return;
    let ignore = false;
    const cipher = getGroupCipher(currentUser, privateKey, groupId);
    cipher
      .ready()
      .then(() => !ignore && setReady(groupId))
      .catch((error) => console.error("Could not load the group's keys:", error));
    const handleKeyChanged = ({ groupId: changed }) => {
      if (changed === groupId) cipher.reload().catch((error) => console.error("Could not load the group's keys:", error));
    };
    socket.on("groupKeyChanged", handleKeyChanged);
    return () => {
      ignore = true;
      socket.off("groupKeyChanged", handleKeyChanged);
    };
  }, [groupId, privateKey, currentUser]);

  return ready === groupId && privateKey ? getGroupCipher(currentUser, privateKey, groupId) : null;
};
