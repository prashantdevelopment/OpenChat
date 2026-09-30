import { useState } from "react";
import api from "../api/api.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { toastManager } from "@/components/ui/toast";
import { isMutedNow, mutedUntilText } from "../lib/mute.js";

const OPTIONS = [
  { value: "8h", label: "8 hours" },
  { value: "1w", label: "1 week" },
  { value: "always", label: "Always" },
];

// Mute a chat or group's notifications (no pushes, alerts or chimes; unread
// counts still show), or unmute it. Only for me: nobody else is told.
// onChanged(mutedUntil): the new value (null when unmuted).
const MuteDialog = ({ open, onOpenChange, conversationId, name, mutedUntil, onChanged }) => {
  const [choice, setChoice] = useState("8h");
  const [saving, setSaving] = useState(false);
  const muted = isMutedNow(mutedUntil);

  const save = async (duration) => {
    setSaving(true);
    try {
      const { data } = await api.put(`/conversations/${conversationId}/mute`, { duration });
      onChanged(data.mutedUntil);
      toastManager.add({ title: data.mutedUntil ? `${name} muted` : `${name} unmuted` });
      onOpenChange(false);
    } catch (error) {
      toastManager.add({ type: "error", title: "Couldn't change notifications", description: error.response?.data?.message ?? "Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="font-heading text-3xl font-normal">{muted ? `Unmute ${name}?` : `Mute ${name}`}</DialogTitle>
          <DialogDescription>
            {muted
              ? `${mutedUntilText(mutedUntil)}. Unmute to get notifications again.`
              : "No notifications or sounds for it. Unread messages still show, and nobody is told."}
          </DialogDescription>
        </DialogHeader>
        {muted ? null : (
          <DialogPanel>
            <fieldset>
              <legend className="mb-2 font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">For how long</legend>
              <div className="divide-y divide-border border-y border-border">
                {OPTIONS.map(({ value, label }) => (
                  <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 py-2">
                    <input type="radio" name="mute-for" value={value} checked={choice === value} onChange={() => setChoice(value)} className="size-4.5 accent-brand" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </DialogPanel>
        )}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" className="min-h-[44px] rounded-full px-5" />}>Cancel</DialogClose>
          <Button type="button" className="min-h-[44px] rounded-full px-5" loading={saving} onClick={() => save(muted ? null : choice)}>
            {muted ? "Unmute" : "Mute"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

export default MuteDialog;
