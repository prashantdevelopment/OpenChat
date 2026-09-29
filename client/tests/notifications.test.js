import { beforeEach, describe, it, expect } from "vitest";
import { getNotificationPrefs, setNotificationPrefs, shouldNotify, titleWithUnread } from "../src/lib/notifications.js";

describe("shouldNotify", () => {
  const base = { enabled: true, permission: "granted", isPageActive: false };
  it("notifies only when on, allowed, and the page isn't being looked at", () => {
    expect(shouldNotify(base)).toBe(true);
    expect(shouldNotify({ ...base, enabled: false })).toBe(false);
    expect(shouldNotify({ ...base, permission: "default" })).toBe(false);
    expect(shouldNotify({ ...base, permission: "denied" })).toBe(false);
    expect(shouldNotify({ ...base, isPageActive: true })).toBe(false);
  });
});

describe("titleWithUnread", () => {
  it("adds the unread count to the tab title", () => {
    expect(titleWithUnread(0)).toBe("OpenChat");
    expect(titleWithUnread(3)).toBe("(3) OpenChat");
    expect(titleWithUnread(150)).toBe("(99+) OpenChat");
  });
});

describe("notification preferences", () => {
  // Minimal localStorage for the Node test environment.
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    };
  });

  it("is off by default, with message text shown once turned on", () => {
    expect(getNotificationPrefs()).toEqual({ enabled: false, preview: true, sound: true });
  });

  it("remembers changes and keeps the other setting", () => {
    setNotificationPrefs({ enabled: true });
    setNotificationPrefs({ preview: false });
    expect(getNotificationPrefs()).toEqual({ enabled: true, preview: false, sound: true });
  });

  it("the chime is on by default and can be turned off on its own", () => {
    setNotificationPrefs({ sound: false });
    expect(getNotificationPrefs()).toEqual({ enabled: false, preview: true, sound: false });
  });

  it("falls back to the defaults if storage is broken", () => {
    localStorage.setItem("openchat-notifications", "{not json");
    expect(getNotificationPrefs()).toEqual({ enabled: false, preview: true, sound: true });
  });
});
