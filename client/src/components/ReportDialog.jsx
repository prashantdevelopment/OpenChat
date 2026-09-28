import { useId, useState } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import { MAX_REPORT_DETAILS, REPORT_REASONS, reportUser } from "../lib/blocks.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { toastManager } from "@/components/ui/toast";
import { displayName } from "../lib/people.js";

// Report someone: a reason, the reporter's own words (we can't read their
// messages, they are end-to-end encrypted), and "Also block" (on by default).
// Controlled: the parent opens it. canBlock: not blocked yet (else no switch).
// onBlocked runs if they were blocked too.
const ReportDialog = ({ user, conversationId, open, onOpenChange, canBlock, beforeBlock, onBlocked }) => {
  const detailsId = useId();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!reason) {
      setError("Choose a reason.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      // A call with them ends first (a block stops call signals).
      const block = canBlock && alsoBlock;
      if (block) await beforeBlock?.();
      const { blocked } = await reportUser({ userId: user._id, reason, details, conversationId, alsoBlock: block });
      toastManager.add({ type: "success", title: blocked ? `Reported and blocked ${displayName(user)}` : `Reported ${displayName(user)}`, description: "Thank you. We'll look into it." });
      onOpenChange(false);
      setReason("");
      setDetails("");
      if (blocked) onBlocked?.();
    } catch (err) {
      setError(err.response?.data?.message ?? "Couldn't send the report. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        {/* contents: the popup lays out header, panel and footer itself. */}
        <form onSubmit={submit} noValidate className="contents">
          <DialogHeader>
            <DialogTitle className="font-heading text-3xl font-normal">Report {displayName(user)}</DialogTitle>
            <DialogDescription>
              Your messages are end-to-end encrypted, so we can&apos;t read them. Tell us what happened. {displayName(user)} won&apos;t be told who reported them.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-6">
            <fieldset>
              <legend className="mb-2 font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Reason</legend>
              <div className="divide-y divide-border border-y border-border">
                {REPORT_REASONS.map(({ value, label }) => (
                  <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 py-2">
                    <input
                      type="radio"
                      name="report-reason"
                      value={value}
                      checked={reason === value}
                      onChange={() => {
                        setReason(value);
                        setError(null);
                      }}
                      className="size-4.5 accent-brand"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor={detailsId} className="block font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                What happened? (optional)
              </label>
              <textarea
                id={detailsId}
                value={details}
                maxLength={MAX_REPORT_DETAILS}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
                className="field h-auto resize-none"
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {details.length} of {MAX_REPORT_DETAILS}
              </p>
            </div>
            {canBlock ? (
              <label className="flex cursor-pointer items-start justify-between gap-6">
                <span>
                  <span className="block font-medium">Also block {displayName(user)}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">You won&apos;t be able to message or call each other.</span>
                </span>
                <input type="checkbox" role="switch" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} className="switch mt-0.5" />
              </label>
            ) : null}
            {error ? (
              <p role="alert" className="border border-destructive-foreground/40 px-3 py-2 text-sm text-destructive-foreground">
                {error}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="h-11 rounded-full px-5 sm:h-11" />}>Cancel</DialogClose>
            <Button type="submit" loading={sending} className="h-11 gap-3 rounded-full pr-1 pl-5 sm:h-11">
              Send report
              <span aria-hidden="true" className="grid size-8.5 place-items-center rounded-full bg-brand text-brand-foreground">
                <ArrowUpRightIcon strokeWidth={1.7} />
              </span>
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
};

export default ReportDialog;
