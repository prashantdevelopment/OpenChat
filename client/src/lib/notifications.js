// Browser notifications for new messages, while OpenChat is open in a tab
// that isn't being looked at. (Closed app = no notification: that needs Web
// Push and a service worker.) The choice is per device, so it lives in
// localStorage, like the theme.
const STORAGE_KEY = "openchat-notifications";
// enabled / preview: browser notifications while OpenChat is in the
// background. sound: a soft chime with the in-app alert for a new message.
const DEFAULTS = { enabled: false, preview: true, sound: true };

export const getNotificationPrefs = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return DEFAULTS; // blocked storage or broken JSON
  }
};

export const setNotificationPrefs = (prefs) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...getNotificationPrefs(), ...prefs }));
  } catch {
    // Not remembered, nothing else to do.
  }
};

// The first-visit question ("Turn on notifications?", step 83): asked when
// this browser hasn't been asked yet (permission "default"), and again a week
// after "Not now". Per device, like the permission itself. Never once
// notifications are on or blocked.
const ASKED_KEY = "openchat-notifications-asked";
export const ASK_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export const shouldAskForNotifications = (now = Date.now()) => {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "default") return false;
  try {
    const askedAt = Number(localStorage.getItem(ASKED_KEY));
    return !askedAt || now - askedAt > ASK_AGAIN_AFTER_MS;
  } catch {
    return false; // blocked storage: don't ask on every visit
  }
};

export const rememberAskedForNotifications = (now = Date.now()) => {
  try {
    localStorage.setItem(ASKED_KEY, String(now));
  } catch {
    // Not remembered, nothing else to do.
  }
};

// Notify only if the user turned it on, the browser allows it, and they
// aren't already looking at OpenChat.
export const shouldNotify = ({ enabled, permission, isPageActive }) =>
  enabled && permission === "granted" && !isPageActive;

// "(3) OpenChat" while there are unread messages.
export const titleWithUnread = (unread, base = "OpenChat") =>
  unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;

// The total on the installed app's icon (Badging API; nothing where unsupported).
export const setAppBadge = (count) => {
  try {
    if (count > 0) navigator.setAppBadge?.(count)?.catch(() => {});
    else navigator.clearAppBadge?.()?.catch(() => {});
  } catch {
    // Not supported here.
  }
};

// A soft two-note chime for a new message, made with Web Audio (no sound file).
// Browsers only play it after the page was interacted with, which logging in is.
let audio;
export const playChime = () => {
  try {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    audio ??= new Context();
    if (audio.state === "suspended") audio.resume().catch(() => {});
    const start = audio.currentTime;
    for (const [frequency, delay] of [[880, 0], [1318.5, 0.09]]) {
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      tone.type = "sine";
      tone.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, start + delay);
      volume.gain.exponentialRampToValueAtTime(0.06, start + delay + 0.01);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.35);
      tone.connect(volume).connect(audio.destination);
      tone.start(start + delay);
      tone.stop(start + delay + 0.4);
    }
  } catch {
    // No sound; the alert is still shown.
  }
};
