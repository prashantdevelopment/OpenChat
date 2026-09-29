import api from "../api/api.js";

// Notifications while OpenChat is closed (Web Push). The browser subscribes
// at its push service with the server's public key; the server keeps the
// subscription for this login session (server: push.service.js) and the
// service worker (public/sw.js) shows what arrives.

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// iPhone/iPad: Safari only delivers push to OpenChat added to the Home Screen.
export const needsHomeScreen = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.matchMedia?.("(display-mode: standalone)").matches && !navigator.standalone;

export const getPushConfig = async () => (await api.get("/push/config")).data;

// The service worker (production registers it at load; development only when
// push is used, so it doesn't get in the way of Vite's live reload).
const registration = async () => {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
};

// This browser's current subscription, or null.
export const currentSubscription = async () => {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
};

// Asks for permission (only now, after the user chose this), subscribes and
// tells the server. Returns the permission ("granted", "denied", "default").
export const subscribeToPush = async (publicKey) => {
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const reg = await registration();
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }));
  await api.post("/push/subscriptions", subscription.toJSON());
  return permission;
};

// Turns it off for this browser: the server forgets it and the browser drops it.
export const unsubscribeFromPush = async () => {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api.delete("/push/subscriptions", { data: { endpoint: subscription.endpoint } }).catch(() => {});
  await subscription.unsubscribe().catch(() => {});
};

export const sendTestPush = async () => (await api.post("/push/test")).data.sent;
