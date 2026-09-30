import { useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { API_URL } from "../api/api.js";
import Avatar from "./Avatar.jsx";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A profile photo you can open full size (like Instagram): tap it, or press
// and hold it, and it opens large; ✕, Esc, a tap outside the photo or a swipe
// down closes it. The large copy (1080px) is loaded only then; older photos
// without one show their small copy. Without a photo it is just the initial.
const SWIPE_CLOSE_PX = 90;

const ViewableAvatar = ({ name, avatarId, className }) => {
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState(0);
  const start = useRef(null);

  if (!avatarId) return <Avatar name={name} avatarId={avatarId} className={className} />;

  const onPointerDown = (event) => {
    start.current = event.clientY;
  };
  const onPointerMove = (event) => {
    if (start.current !== null) setDragY(Math.max(0, event.clientY - start.current));
  };
  const onPointerUp = () => {
    if (dragY > SWIPE_CLOSE_PX) setOpen(false);
    start.current = null;
    setDragY(0);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        data-slot="photo-trigger"
        aria-label={`View ${name}'s photo`}
        // Press and hold opens it too (instead of the phone's image menu).
        onContextMenu={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
        className="cursor-zoom-in rounded-full transition-transform duration-150 hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:transition-none"
      >
        <Avatar name={name} avatarId={avatarId} className={className} />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/85 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <DialogPrimitive.Popup
          data-slot="photo-viewer"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 outline-none transition-[opacity,scale] duration-200 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none"
          // A tap outside the photo closes it.
          onClick={(event) => event.target === event.currentTarget && setOpen(false)}
        >
          <DialogPrimitive.Title className="sr-only">{`${name}'s photo`}</DialogPrimitive.Title>
          <DialogPrimitive.Close
            render={<Button variant="ghost" size="icon-xl" className="absolute top-3 right-3 size-12 rounded-full text-white hover:bg-white/15 sm:size-12" aria-label="Close" />}
          >
            <XIcon aria-hidden="true" strokeWidth={1.5} />
          </DialogPrimitive.Close>
          <figure
            className={cn("flex max-h-full max-w-full flex-col items-center gap-3 touch-none select-none", dragY === 0 && "transition-transform duration-150")}
            style={{ transform: dragY ? `translateY(${dragY}px)` : undefined, opacity: dragY ? Math.max(0.4, 1 - dragY / 400) : undefined }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img
              src={`${API_URL}/api/avatars/${avatarId}/large`}
              alt={`${name}'s photo`}
              draggable={false}
              className="aspect-square max-h-[min(80dvh,1080px)] w-[min(92vw,80dvh,1080px)] rounded-2xl bg-black/40 object-cover shadow-2xl"
            />
            <figcaption className="font-heading text-xl text-white">{name}</figcaption>
          </figure>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default ViewableAvatar;
