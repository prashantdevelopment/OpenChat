import { useState } from "react";
import { EllipsisIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

const WHY_NOT = {
  seen: "Already seen",
  tooLate: "Only within 15 minutes of sending",
};

// The menu of one of my messages: "Delete for everyone", with a short confirm.
// Opened from the ⋯ button next to the message (on hover or keyboard focus),
// or, by the message itself, with a right-click or a long press (`open`).
// reason: why it can't be deleted now ("seen" | "tooLate"), or null.
// onDelete: deletes it (the message goes at once; see ConversationView).
const MessageActions = ({ open, onOpenChange, reason, onDelete, side }) => {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Menu open={open} onOpenChange={onOpenChange}>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Message options"
              className={cn(
                // Beside the message, outside it; shown on hover and keyboard focus
                // (on touch screens the message opens it with a long press).
                "absolute top-1/2 -translate-y-1/2 rounded-full text-muted-foreground opacity-0 transition-opacity duration-150",
                "group-hover/message:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:pointer-events-none motion-reduce:transition-none",
                side === "left" ? "right-full mr-1" : "left-full ml-1",
              )}
            />
          }
        >
          <EllipsisIcon aria-hidden="true" strokeWidth={1.5} />
        </MenuTrigger>
        <MenuPopup align={side === "left" ? "end" : "start"}>
          <MenuItem disabled={Boolean(reason)} onClick={() => setConfirming(true)} className="data-disabled:cursor-not-allowed data-disabled:opacity-60">
            <Trash2Icon aria-hidden="true" strokeWidth={1.5} />
            <span className="flex flex-col py-1.5">
              Delete for everyone
              {reason ? <span className="text-xs text-muted-foreground">{WHY_NOT[reason]}</span> : null}
            </span>
          </MenuItem>
        </MenuPopup>
      </Menu>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle className="font-heading text-3xl font-normal">Delete for everyone?</DialogTitle>
            <DialogDescription>It disappears from this chat for everyone in it. This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="min-h-[44px] rounded-full px-5" />}>Cancel</DialogClose>
            <Button
              type="button"
              variant="destructive"
              className="min-h-[44px] rounded-full px-5"
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
};

export default MessageActions;
