import { useState } from "react";
import { BanIcon, FlagIcon } from "lucide-react";
import { useCall } from "../calls/CallContext.js";
import { blockUser, unblockUser } from "../lib/blocks.js";
import ReportDialog from "./ReportDialog.jsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { toastManager } from "@/components/ui/toast";

// Block / Unblock and Report for one person (their profile page). Blocking
// asks first and says what it does; unblocking doesn't need to.
// onBlockedChange(blocked) after either changes.
const PersonActions = ({ user, blocked, conversationId, onBlockedChange }) => {
  const { call, endCall } = useCall();
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);

  // A call with them is peer to peer: end it before the block stops its signals.
  const endCallWithThem = async () => {
    if (call && call.peer._id === user._id && call.status !== "ended") await endCall();
  };

  const setBlocked = async (block) => {
    setBusy(true);
    try {
      if (block) {
        await endCallWithThem();
        await blockUser(user._id);
      } else {
        await unblockUser(user._id);
      }
      setConfirming(false);
      toastManager.add({ type: "success", title: block ? `Blocked ${user.username}` : `Unblocked ${user.username}` });
      onBlockedChange?.(block);
    } catch (error) {
      toastManager.add({ type: "error", title: block ? "Couldn't block" : "Couldn't unblock", description: error.response?.data?.message ?? "Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  const OUTLINE = "h-11 rounded-full border-foreground/25 bg-transparent px-5 shadow-none hover:bg-accent sm:h-11";
  return (
    <div className="flex flex-wrap gap-3">
      {blocked ? (
        <Button variant="outline" className={OUTLINE} loading={busy} onClick={() => setBlocked(false)}>
          Unblock {user.username}
        </Button>
      ) : (
        <Button variant="outline" className={OUTLINE} onClick={() => setConfirming(true)}>
          <BanIcon aria-hidden="true" strokeWidth={1.5} />
          Block
        </Button>
      )}
      <Button variant="outline" className={OUTLINE} onClick={() => setReporting(true)}>
        <FlagIcon aria-hidden="true" strokeWidth={1.5} />
        Report
      </Button>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle className="font-heading text-3xl font-normal">Block {user.username}?</DialogTitle>
            <DialogDescription>They won&apos;t be told.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <ul className="list-disc space-y-2 pl-5 text-sm">
              <li>Neither of you can message or call the other.</li>
              <li>You won&apos;t find each other in search or Discover, and they can&apos;t open your profile.</li>
              <li>You stop seeing each other online, typing or reading.</li>
              <li>Your old messages stay. You can unblock them any time.</li>
            </ul>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="h-11 rounded-full px-5 sm:h-11" />}>Cancel</DialogClose>
            <Button loading={busy} onClick={() => setBlocked(true)} className="h-11 rounded-full border-0 bg-brand px-6 text-brand-foreground hover:bg-brand/90 sm:h-11">
              Block
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <ReportDialog
        user={user}
        conversationId={conversationId}
        open={reporting}
        onOpenChange={setReporting}
        canBlock={!blocked}
        beforeBlock={endCallWithThem}
        onBlocked={() => onBlockedChange?.(true)}
      />
    </div>
  );
};

export default PersonActions;
