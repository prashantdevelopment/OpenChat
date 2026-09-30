import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import { mediaFileName, saveFile } from "../lib/encryptedFiles.js";
import { Button } from "@/components/ui/button";

// A photo or video of a chat, full screen: a bar on top with Back (also Esc),
// who sent it (`from`) and Download, the caption at the bottom. Videos play
// here with their controls. `url` is the decrypted file (a local blob:
// address); `label` describes it for screen readers.
const MediaViewer = ({ open, onOpenChange, kind, url, file, from, label, caption }) => {
  const noun = kind === "video" ? "video" : "photo";
  const barButton = "size-[44px] sm:size-[44px] rounded-full text-white hover:bg-white/15 hover:text-white";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <DialogPrimitive.Popup
          data-slot="media-viewer"
          className="fixed inset-0 z-50 flex flex-col text-white outline-none transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"
        >
          <div className="flex shrink-0 items-center gap-2 bg-linear-to-b from-black/70 to-transparent px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
            <DialogPrimitive.Close render={<Button variant="ghost" size="icon-xl" className={barButton} aria-label="Back" />}>
              <ArrowLeftIcon aria-hidden="true" strokeWidth={1.5} />
            </DialogPrimitive.Close>
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-base font-medium">{from}</DialogPrimitive.Title>
            <Button variant="ghost" size="icon-xl" className={barButton} aria-label={`Download ${noun}`} disabled={!url} onClick={() => saveFile(url, mediaFileName(kind, file))}>
              <DownloadIcon aria-hidden="true" strokeWidth={1.5} />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {kind === "video" ? (
              <video src={url} controls autoPlay playsInline aria-label={label} className="max-h-full max-w-full" />
            ) : (
              <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
            )}
          </div>
          {caption ? (
            <p dir="auto" className="shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-[0.9375rem] whitespace-pre-wrap wrap-anywhere text-white/90">
              {caption}
            </p>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default MediaViewer;
