import { useRef, useState } from "react";
import { m } from "motion/react";
import { AlertCircleIcon, CheckCheckIcon, CheckIcon, PhoneIcon, PhoneMissedIcon, RotateCwIcon, VideoIcon } from "lucide-react";
import { useDecryptedText } from "../crypto/hooks.js";
import { formatFullDateTime, formatTimeOfDay } from "../lib/time.js";
import { DELETABLE_TYPES, receiptStatus, whyNotDeletable } from "../lib/receipts.js";
import { describeCall, parseAttachmentContent, parseCallContent } from "../lib/messageContent.js";
import EncryptedImage from "./EncryptedImage.jsx";
import VideoAttachment from "./VideoAttachment.jsx";
import FileAttachment from "./FileAttachment.jsx";
import VoiceNote from "./VoiceNote.jsx";
import MessageActions from "./MessageActions.jsx";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// One message. It arrives encrypted and is decrypted here, in the browser.
// Mine: right, ink. Theirs: left, a darker paper. Photos and videos are shown
// on their own (no bubble), with the sender's caption, if any, under them;
// tapped, they open full screen. Within a group (see lib/timeline.js)
// bubbles sit close together and only the last one shows the time.
// A message still on its way (see ConversationView) has `status` "sending" or
// "failed" and its plain `text`; it shows that status instead of a time.
// Photos, videos and files: the decrypted text is JSON with the caption and
// the file's key (see lib/messageContent.js); one still being sent has
// `attachmentContent`, `previewUrl` and upload `progress` (0 to 1).
// Ticks on my messages: one = on the server, two = reached their app, two in
// blue = read. The word is there too (tooltip and screen readers).
const RECEIPTS = {
  sent: { Icon: CheckIcon, label: "Sent", className: "text-muted-foreground" },
  delivered: { Icon: CheckCheckIcon, label: "Delivered", className: "text-muted-foreground" },
  read: { Icon: CheckCheckIcon, label: "Read", className: "text-primary" },
};

// A long press (touch) opens a message's menu after this long, unless the
// finger moves (scrolling).
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

// showSender: in a group, the first of someone's messages shows their name above it.
// onDelete: "Delete for everyone" for my own sent messages (see MessageActions).
const MessageBubble = ({ message, conversationKey, isOwnMessage, senderName, showSender = false, isFirstInGroup, isLastInGroup, receipts, onRetry, onDelete, animateIn }) => {
  const { text, failed } = useDecryptedText(conversationKey, message, message.sender);
  const [menuOpen, setMenuOpen] = useState(false);
  const press = useRef(null);
  const canAct = Boolean(onDelete) && isOwnMessage && !message.status && Boolean(message.ciphertext) && DELETABLE_TYPES.includes(message.messageType ?? "text");
  // A long press opens the menu; the tap that ends it must not also open a
  // photo or play a video. Only for the message itself: events from its menu,
  // dialog or full-screen photo (portals) reach here too through React.
  const inBubble = (event) => event.currentTarget.contains(event.target);
  const pressHandlers = canAct
    ? {
        onPointerDown: (event) => {
          press.current = null;
          if (event.pointerType !== "touch" || !inBubble(event)) return;
          const start = { x: event.clientX, y: event.clientY };
          press.current = { start, opened: false, timer: setTimeout(() => {
            press.current.opened = true;
            setMenuOpen(true);
          }, LONG_PRESS_MS) };
        },
        onPointerMove: (event) => {
          const { start, timer } = press.current ?? {};
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP_PX) clearTimeout(timer);
        },
        onPointerUp: () => clearTimeout(press.current?.timer),
        // The finger lifts after the menu opened: no tap from it (it would
        // count as a tap outside the menu and close it).
        onTouchEnd: (event) => {
          if (press.current?.opened && inBubble(event)) event.preventDefault();
        },
        onPointerCancel: () => clearTimeout(press.current?.timer),
        onClickCapture: (event) => {
          if (!press.current?.opened || !inBubble(event)) return;
          press.current = null;
          event.preventDefault();
          event.stopPropagation();
        },
        // Right-click (and a long press on Android): the menu, unless text is
        // selected (then the browser's own menu, to copy it).
        onContextMenu: (event) => {
          if (!inBubble(event) || window.getSelection()?.toString()) return;
          event.preventDefault();
          setMenuOpen(true);
        },
      }
    : {};

  const kind = ["image", "video", "audio", "file"].includes(message.messageType) ? message.messageType : null;
  const attachment = !kind
    ? null
    : message.status
      ? message.attachmentContent
      : text !== undefined
        ? parseAttachmentContent(text)
        : null;

  let content = message.status ? message.text : text;
  let isStatus = true; // a note about the message rather than its text
  if (message.status) isStatus = false;
  else if (!message.ciphertext) content = "[Sent before encryption; can't be shown]";
  else if (failed) content = "[This message could not be decrypted]";
  else if (text === undefined) content = "Decrypting...";
  else if (kind && !attachment) content = "[This attachment could not be opened]";
  else isStatus = false;
  if (attachment) content = attachment.caption;
  // A call record: "Outgoing voice call · 2:31", "Missed video call", ...
  const callRecord = message.messageType === "call" && text !== undefined ? parseCallContent(text) : null;
  const callText = callRecord ? describeCall(callRecord, isOwnMessage) : null;
  if (message.messageType === "call" && text !== undefined && !callRecord) content = "[This call record could not be opened]";
  const progress = message.status === "sending" && message.progress < 1 ? message.progress : null;
  const isMedia = (kind === "image" || kind === "video") && Boolean(attachment);

  return (
    // animateIn: a message that just arrived or was just sent rises in (only
    // transform + opacity, so the list's height and scroll never jump).
    <m.div
      initial={animateIn ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("flex flex-col", isOwnMessage ? "items-end" : "items-start", isFirstInGroup ? "mt-3" : "mt-0.5")}
    >
      {showSender ? (
        <span aria-hidden="true" className="mb-1 px-1 text-xs font-medium text-brand">
          {senderName}
        </span>
      ) : null}
      <div
        className={cn(
          // relative: keeps the sr-only label (position: absolute) inside the
          // scrolling log, otherwise it stretches the whole page.
          "relative max-w-[85%] sm:max-w-[58%]",
          // No text selection or phone callout on a long press: it opens the menu.
          canAct && "group/message pointer-coarse:select-none [-webkit-touch-callout:none]",
          isMedia
            ? "flex flex-col"
            : cn(
                "rounded-md leading-relaxed",
                attachment ? "p-1" : "px-4 py-3",
                isOwnMessage ? "bg-bubble-own text-bubble-own-foreground" : "bg-muted text-foreground",
              ),
        )}
        {...pressHandlers}
      >
        {/* Screen readers hear who said it; sighted users see it from the side. */}
        <span className="sr-only">{isOwnMessage ? "You" : senderName}: </span>
        {/* dir="auto": each message picks its own direction (e.g. Urdu is right-to-left).
            wrap-anywhere keeps long links and words inside the bubble. */}
        {attachment ? (
          <Attachment
            kind={kind}
            fileId={message.attachment?.fileId}
            file={attachment.file}
            previewUrl={message.previewUrl}
            label={attachment.caption || `${kind === "video" ? "Video" : "Photo"} from ${isOwnMessage ? "you" : senderName}`}
            caption={attachment.caption}
            from={isOwnMessage ? "You" : senderName}
          >
            {progress !== null ? (
              <div
                role="progressbar"
                aria-label="Uploading photo"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                className="absolute inset-x-2 bottom-2 h-1.5 overflow-hidden rounded-full bg-black/30"
              >
                <div className="h-full bg-white transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
              </div>
            ) : null}
          </Attachment>
        ) : null}
        {isMedia ? (
          content ? (
            <p dir="auto" className={cn("mt-1 px-1 leading-snug whitespace-pre-wrap wrap-anywhere", isOwnMessage && "text-right")}>
              {content}
            </p>
          ) : null
        ) : callText ? (
          <p className={cn("flex items-center gap-2 font-medium", callText.missed && "text-destructive-foreground")}>
            {callText.missed ? (
              <PhoneMissedIcon aria-hidden="true" className="size-4 shrink-0" />
            ) : callRecord.media === "video" ? (
              <VideoIcon aria-hidden="true" className="size-4 shrink-0" />
            ) : (
              <PhoneIcon aria-hidden="true" className="size-4 shrink-0" />
            )}
            {callText.text}
          </p>
        ) : !attachment || content ? (
          <p dir="auto" className={cn("whitespace-pre-wrap wrap-anywhere", attachment && "px-2.5 pt-1.5 pb-1", isStatus && "font-heading italic opacity-80")}>
            {content}
          </p>
        ) : null}
        {canAct ? (
          <MessageActions open={menuOpen} onOpenChange={setMenuOpen} reason={menuOpen ? whyNotDeletable(message, receipts) : null} onDelete={onDelete} side="left" />
        ) : null}
      </div>

      {message.status === "sending" ? (
        <span className="reveal-late mt-1 px-1 font-mono text-[10.5px] text-muted-foreground">Sending...</span>
      ) : message.status === "failed" ? (
        <div className="mt-1 flex items-center gap-2 px-1 text-xs">
          <span className="inline-flex items-center gap-1 text-destructive-foreground">
            <AlertCircleIcon aria-hidden="true" className="size-3.5" />
            Not sent
          </span>
          <Button type="button" variant="outline" size="xs" onClick={onRetry}>
            <RotateCwIcon aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : isLastInGroup && message.createdAt ? (
        <div className={cn("flex items-center gap-1.5 px-1 font-mono text-[10.5px] text-muted-foreground", "mt-1")}>
          <time dateTime={message.createdAt} title={formatFullDateTime(message.createdAt)}>
            {formatTimeOfDay(message.createdAt)}
          </time>
          {isOwnMessage ? <ReceiptTicks status={receiptStatus(message, receipts)} /> : null}
        </div>
      ) : null}
    </m.div>
  );
};

// The file part of a photo, video or file message; `children` (the upload
// progress bar) is drawn on top of it.
const Attachment = ({ kind, fileId, file, previewUrl, from, label, caption, children }) => {
  if (kind === "image") {
    return (
      <EncryptedImage fileId={fileId} file={file} previewUrl={previewUrl} alt={label} from={from} caption={caption}>
        {children}
      </EncryptedImage>
    );
  }
  if (kind === "audio") {
    return (
      <VoiceNote fileId={fileId} file={file} previewUrl={previewUrl}>
        {children}
      </VoiceNote>
    );
  }
  if (kind === "video") {
    return (
      <VideoAttachment fileId={fileId} file={file} previewUrl={previewUrl} from={from} label={label} caption={caption}>
        {children}
      </VideoAttachment>
    );
  }
  return (
    <FileAttachment fileId={fileId} file={file} previewUrl={previewUrl}>
      {children}
    </FileAttachment>
  );
};

const ReceiptTicks = ({ status }) => {
  const { Icon, label, className } = RECEIPTS[status];
  return (
    <span data-receipt={status} title={label} className={cn("inline-flex", className)}>
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  );
};

export default MessageBubble;
