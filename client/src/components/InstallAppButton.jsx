import { useState } from "react";
import { ArrowDownIcon, DownloadIcon, ShareIcon, SquarePlusIcon } from "lucide-react";
import { INSTALL_TEXT, promptInstall, useInstallState } from "../lib/pwa.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// "Install the app" on the landing page (step 82), so nobody has to look for
// it. Where the browser offers its install prompt (Chrome, Edge, Android) it
// opens that; on iPhone/iPad, and where there is no prompt (yet), it shows
// how to install by hand. Hidden once installed or opened as the app.
// variant: "header" (small, in the top bar) or "hero" (next to the main buttons).
const InstallAppButton = ({ variant = "hero", className }) => {
  const state = useInstallState();
  const [helpOpen, setHelpOpen] = useState(false);
  if (state === "standalone" || state === "installed") return null;

  const install = () => (state === "prompt" ? promptInstall() : setHelpOpen(true));

  return (
    <>
      {variant === "header" ? (
        <Button variant="outline" onClick={install} className={cn("rounded-full border-foreground/25 px-3.5", className)}>
          <DownloadIcon aria-hidden="true" strokeWidth={1.5} />
          Install app
        </Button>
      ) : (
        // An outline pill with the arrow in its own circle, beside the main buttons.
        <Button
          variant="outline"
          onClick={install}
          className={cn("h-12.5 min-h-[44px] gap-3 rounded-full border-foreground pr-1.5 pl-6 text-[0.9375rem] sm:h-12.5 sm:text-[0.9375rem]", className)}
        >
          Install the app
          <span aria-hidden="true" className="grid size-9.5 place-items-center rounded-full bg-foreground text-background">
            <ArrowDownIcon strokeWidth={1.7} />
          </span>
        </Button>
      )}

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle className="font-heading text-3xl font-normal">Install OpenChat</DialogTitle>
            <DialogDescription>It opens like an app, in its own window, from your home screen. Nothing to download from a store.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {state === "ios" ? (
              <ol className="space-y-3">
                <li className="flex items-center gap-3">
                  <ShareIcon aria-hidden="true" strokeWidth={1.5} className="size-5 shrink-0 text-brand" />
                  <span>
                    In Safari, tap <strong className="font-semibold">Share</strong> (the square with an arrow).
                  </span>
                </li>
                <li className="flex items-center gap-3">
                  <SquarePlusIcon aria-hidden="true" strokeWidth={1.5} className="size-5 shrink-0 text-brand" />
                  <span>
                    Choose <strong className="font-semibold">Add to Home Screen</strong>, then Add.
                  </span>
                </li>
              </ol>
            ) : (
              <p>{INSTALL_TEXT.unavailable}</p>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" className="min-h-[44px] rounded-full px-5" />}>Got it</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
};

export default InstallAppButton;
