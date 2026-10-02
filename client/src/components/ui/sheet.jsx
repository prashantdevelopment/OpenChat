import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// A side sheet on Base UI's Dialog (focus trap, Esc, focus back to the opener,
// the page behind made inert): slides in from the right on wider screens and
// fills the screen on phones. Used for contact info (and later group info).

export const Sheet = DialogPrimitive.Root;

export function SheetPopup({ className, children, title, ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/32 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none max-sm:hidden" />
      <DialogPrimitive.Popup
        data-slot="sheet-popup"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-background text-foreground outline-none sm:w-[400px] sm:border-l sm:border-border sm:shadow-[-24px_0_60px_-30px_rgb(10_30_25/0.45)]",
          "transition-[translate,opacity] duration-250 ease-out data-ending-style:translate-x-8 data-ending-style:opacity-0 data-starting-style:translate-x-8 data-starting-style:opacity-0 motion-reduce:transition-none",
          className,
        )}
        {...props}
      >
        <header className="flex h-15 shrink-0 items-center gap-2 border-b border-border px-2 md:h-17 md:px-4">
          <DialogPrimitive.Close render={<Button variant="ghost" size="icon-lg" className="rounded-full" aria-label="Close" />}>
            <XIcon aria-hidden="true" strokeWidth={1.4} />
          </DialogPrimitive.Close>
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">{title}</p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export function SheetTitle({ className, ...props }) {
  return <DialogPrimitive.Title className={cn("font-heading text-[1.75rem] leading-tight", className)} {...props} />;
}
