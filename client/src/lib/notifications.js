// Browser notifications for new messages, while OpenChat is open in a tab
// that isn't being looked at. (Closed app = no notification: that needs Web
// Push and a service worker.) The choice is per device, so it lives in
// localStorage, like the theme.
const STORAGE_KEY = "openchat-notifications";
const DEFAULTS = { enabled: false, preview: true };

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

// Notify only if the user turned it on, the browser allows it, and they
// aren't already looking at OpenChat.
export const shouldNotify = ({ enabled, permission, isPageActive }) =>
  enabled && permission === "granted" && !isPageActive;

// "(3) OpenChat" while there are unread messages.
export const titleWithUnread = (unread, base = "OpenChat") =>
  unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
