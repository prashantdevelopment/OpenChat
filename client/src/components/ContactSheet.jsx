import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useDecryptedText } from "../crypto/hooks.js";
import { computeSafetyNumber } from "../crypto/safetyNumber.js";
import { parseAttachmentContent } from "../lib/messageContent.js";
import { loadDecrypted } from "../lib/encryptedFiles.js";
import { INDIAN_STATES } from "../../../shared/indian-states.js";
import Avatar from "./Avatar.jsx";
import PersonActions from "./PersonActions.jsx";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { displayName, handle } from "../lib/people.js";

const stateName = (code) => INDIAN_STATES.find((state) => state.code === code)?.name;
const SHOWN_PHOTOS = 9;

// A shared photo as a tiny print. Decrypted in the browser like in the chat.
const SharedPhoto = ({ message, conversationKey }) => {
  const { text } = useDecryptedText(conversationKey, message, message.sender);
  const fileId = message.attachment?.fileId;
  const [url, setUrl] = useState(null);

  useEffect(() => {
    const attachment = text === undefined ? null : parseAttachmentContent(text);
    if (!fileId || !attachment) return;
    let ignore = false;
    loadDecrypted(fileId, attachment.file, "image")
      .then((objectUrl) => !ignore && setUrl(objectUrl))
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [fileId, text]);

  return (
    <li className="bg-print p-[3px] shadow-[0_12px_24px_-14px_rgb(60_40_20/0.45)]">
      <div className="aspect-square bg-muted">{url ? <img src={url} alt="" className="size-full object-cover" /> : null}</div>
    </li>
  );
};

const Section = ({ title, aside, children }) => (
  <section className="border-t border-border px-6 py-5">
    <h3 className="flex items-baseline justify-between text-sm font-medium">
      {title}
      {aside ? <span className="font-mono text-xs font-normal text-muted-foreground">{aside}</span> : null}
    </h3>
    {children}
  </section>
);

// Contact info for the open chat (tap the name in the header): who they are,
// the photos shared in this chat, the safety number to compare, and block /
// report. A side sheet on wider screens, the whole screen on phones.
const ContactSheet = ({ open, onOpenChange, peer, myPublicKey, conversationId, conversationKey, photos, blocked, onBlockedChange }) => {
  const [safety, setSafety] = useState({ keys: null, number: null });
  const keys = `${myPublicKey}|${peer?.publicKey}`;

  useEffect(() => {
    if (!open || !myPublicKey || !peer?.publicKey) return;
    let ignore = false;
    computeSafetyNumber(myPublicKey, peer.publicKey).then((number) => !ignore && setSafety({ keys, number }));
    return () => {
      ignore = true;
    };
  }, [open, myPublicKey, peer?.publicKey, keys]);

  if (!peer) return null;
  const name = displayName(peer);
  const number = safety.keys === keys ? safety.number : null;
  const place = stateName(peer.state);
  const shown = photos.filter((message) => message.attachment?.fileId).slice(-SHOWN_PHOTOS).reverse();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup title="Contact info">
        <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
          <Avatar name={name} avatarId={peer.avatar} className="size-24 bg-brand text-5xl text-brand-foreground italic" />
          <SheetTitle className="mt-5 max-w-full wrap-break-word">{name}</SheetTitle>
          <p className="mt-1 text-sm text-muted-foreground">{handle(peer)}</p>
          <p className="mt-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">{place ? `${place} · ` : ""}on OpenChat</p>
          {peer.bio ? <p className="mt-4 font-heading text-[1.25rem] leading-snug">“{peer.bio}”</p> : null}
          <Link to={`/u/${peer.username}`} className="mt-4 text-sm text-foreground underline-offset-4">
            View full profile
          </Link>
        </div>

        <Section title="Shared photos" aside={photos.length}>
          {shown.length ? (
            <ul aria-label="Shared photos" className="mt-3 grid grid-cols-3 gap-2">
              {shown.map((message) => (
                <SharedPhoto key={message._id} message={message} conversationKey={conversationKey} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground italic">Photos you share will show here.</p>
          )}
        </Section>

        {peer.publicKey ? (
          <Section title="Safety number">
            <p className="mt-1 text-sm text-muted-foreground">
              Your chat is end-to-end encrypted. Compare this number with {name} in person or on a call; it must be the same on both screens.
            </p>
            <p aria-label="Safety number digits" className="mt-3 grid grid-cols-4 gap-x-3 gap-y-1.5 font-mono text-sm tracking-wider">
              {number ? number.split(" ").map((group, i) => <span key={i}>{group}</span>) : <span className="col-span-4">Calculating...</span>}
            </p>
          </Section>
        ) : null}

        <Section title="Block or report">
          <p className="mt-1 mb-4 text-sm text-muted-foreground">They won&apos;t be told. Reports are anonymous.</p>
          <PersonActions user={peer} blocked={blocked} conversationId={conversationId} onBlockedChange={onBlockedChange} />
        </Section>
      </SheetPopup>
    </Sheet>
  );
};

export default ContactSheet;
