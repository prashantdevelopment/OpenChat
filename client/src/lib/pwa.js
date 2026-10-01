import { useSyncExternalStore } from "react";

// Installing OpenChat as an app (PWA): the service worker, and the browser's
// install prompt kept for the "Install" buttons (landing page, Settings). Imported once in main.jsx, early,
// because the browser offers the prompt (beforeinstallprompt) only once.

// Production only: in development the service worker would get in the way of
// Vite's live reload.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Not supported here (e.g. a private window): the site works without it.
    });
  });
}

let installPrompt = null;
let installed = false;
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); // no automatic mini-bar; our Install buttons offer it instead
  installPrompt = event;
  notify();
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installed = true;
  notify();
});

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Opened from the home screen / app list (not in a browser tab).
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
// iPhone and iPad never offer a prompt: installing is Share → Add to Home Screen.
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// "standalone" | "installed" | "prompt" | "ios" | "unavailable"
const getInstallState = () => {
  if (isStandalone()) return "standalone";
  if (installed) return "installed";
  if (installPrompt) return "prompt";
  if (isIOS()) return "ios";
  return "unavailable";
};

export const useInstallState = () => useSyncExternalStore(subscribe, getInstallState);

// What each state tells the user (no prompt: how to install by hand).
export const INSTALL_TEXT = {
  standalone: "You're using the installed app.",
  installed: "Installed. Open OpenChat from your home screen or app list.",
  ios: "In Safari, tap Share, then Add to Home Screen.",
  unavailable: "Open OpenChat in Chrome, Edge or Samsung Internet and choose Install app (or Add to Home screen) from the browser's menu.",
};

// Shows the browser's install dialog; the prompt can be used only once.
export const promptInstall = async () => {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null;
  await prompt.prompt();
  await prompt.userChoice; // "appinstalled" follows if they accepted
  notify();
};
