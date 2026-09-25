// Keeps the unlocked private key in IndexedDB so a page refresh doesn't ask for
// the password again. IndexedDB can store a CryptoKey object as-is, and a
// non-extractable key stays non-extractable there: the page can use it, but
// its bytes can never be read out. (localStorage can only hold strings, which
// would mean storing the raw key.)
//
// Only one key is kept: saving clears any previous one, and logout clears it,
// so on a shared computer the next person never finds someone else's key.

const DB_NAME = "openchat";
const STORE = "keys";

const openDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

// Runs one transaction and resolves with the result of `action`'s request.
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

export const saveKey = (userId, key) =>
  withStore("readwrite", (store) => {
    store.clear();
    return store.put(key, userId);
  });

export const loadKey = async (userId) => (await withStore("readonly", (store) => store.get(userId))) ?? null;

export const clearKeys = () => withStore("readwrite", (store) => store.clear());
