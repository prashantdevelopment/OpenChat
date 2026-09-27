// Key change detection ("trust on first use"). The server hands out everyone's
// public key; a malicious server could hand out its own instead and read what
// follows (the safety number exists to catch that). OpenChat keys never change
// (a password change keeps the same key), so this device remembers the first
// key it sees for each person, and a different key later is a warning sign:
// the chat and calls stop until the user has checked the safety number and
// chosen to trust the new key.
//
// Its own IndexedDB database (not keyStore's), so logging out, which clears
// the private key, keeps these: they are public keys, and forgetting them
// would make the next login trust whatever the server says.

const DB_NAME = "openchat-pins";
const STORE = "pins";

const openDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const withStore = async (mode, action) => {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
};

// Per account on this device: my id + their id.
const pinId = (myUserId, peerId) => `${myUserId}:${peerId}`;

// "new" (first time: remembered now), "same" or "changed". If IndexedDB is
// unavailable (some private windows) nothing can be remembered: "new".
export const checkPeerKey = async (myUserId, peerId, publicKey) => {
  try {
    const pinned = await withStore("readonly", (store) => store.get(pinId(myUserId, peerId)));
    if (pinned === undefined) {
      await trustPeerKey(myUserId, peerId, publicKey);
      return "new";
    }
    return pinned === publicKey ? "same" : "changed";
  } catch {
    return "new";
  }
};

// The user checked the safety number and trusts this key from now on.
export const trustPeerKey = (myUserId, peerId, publicKey) =>
  withStore("readwrite", (store) => store.put(publicKey, pinId(myUserId, peerId)));
