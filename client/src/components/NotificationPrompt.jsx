import { useEffect, useState } from "react";
import { BellRingIcon } from "lucide-react";
import { rememberAskedForNotifications, shouldAskForNotifications } from "../lib/notifications.js";
import { turnOnNotifications } from "../lib/push.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { toastManager } from "@/components/ui/toast";

// The first time someone is in the app (after signing up or logging in) on a
// device whose browser hasn't been asked yet: "Turn on notifications?" (step
// 83), so they don't have to find it in Settings. The browser's own question
// comes only after "Turn on". "Not now" (or closing it) asks again in a week.
const SHOW_AFTER_MS = 1000; // once the chat list is on screen

const NotificationPrompt = () => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!shouldAskForNotifications()) return;
    const timer = setTimeout(() => setOpen(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  const close = (next) => {
    if (next) return;
    rememberAskedForNotifications();
    setOpen(false);
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      const permission = await turnOnNotifications();
      if (permission === "granted") toastManager.add({ type: "success", title: "Notifications are on", description: "Change them anytime in Settings → Notifications." });
      else if (permission === "denied") toastManager.add({ title: "Notifications are blocked", description: "To get them, allow notifications for this site in your browser's settings." });
    } finally {
      setBusy(false);
      close(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogPopup>
        <DialogHeader>
          <BellRingIcon aria-hidden="true" strokeWidth={1.4} className="mb-2 size-8 text-brand" />
          <DialogTitle className="font-heading text-3xl font-normal">Turn on notifications?</DialogTitle>
          <DialogDescription>
            Know when a message or a call comes in, even when OpenChat is in the background or closed. Your browser will ask you to allow
            it. You can change this anytime in Settings.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" className="min-h-[44px] rounded-full px-5" />}>Not now</DialogClose>
          <Button type="button" className="min-h-[44px] rounded-full px-5" loading={busy} onClick={turnOn}>
            Turn on
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

export default NotificationPrompt;
