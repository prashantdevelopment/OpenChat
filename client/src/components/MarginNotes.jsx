import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useDecryptedText } from "../crypto/hooks.js";
import { computeSafetyNumber } from "../crypto/safetyNumber.js";
import { parseAttachmentContent } from "../lib/messageContent.js";
import { loadDecrypted } from "../lib/encryptedFiles.js";
import { INDIAN_STATES } from "../../../shared/indian-states.js";
import Avatar from "./Avatar.jsx";

const stateName = (code) => INDIAN_STATES.find((state) => state.code === code)?.name;
const SHOWN_PHOTOS = 6;

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

// The right-hand column next to an open chat, like notes in a magazine's
// margin: who the other person is, the safety number to compare, and the
// photos shared lately. Only on wide screens (it is extra, not needed).
const MarginNotes = ({ peer, myPublicKey, conversationKey, photos }) => {
  const [safety, setSafety] = useState({ keys: null, number: null });
  const keys = `${myPublicKey}|${peer?.publicKey}`;

  useEffect(() => {
    if (!myPublicKey || !peer?.publicKey) return;
    let ignore = false;
    computeSafetyNumber(myPublicKey, peer.publicKey).then((number) => !ignore && setSafety({ keys, number }));
    return () => {
      ignore = true;
    };
  }, [myPublicKey, peer?.publicKey, keys]);

  if (!peer) return null;
  const number = safety.keys === keys ? safety.number : null;
  const place = stateName(peer.state);
  const shown = photos.slice(-SHOWN_PHOTOS).reverse();

  return (
    <aside aria-label={`About ${peer.username}`} className="flex min-h-0 flex-col gap-6 overflow-y-auto border-l border-border px-7 py-6">
      <h2 className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Margin notes</h2>
      <div className="flex flex-col gap-2">
        <Avatar name={peer.username} avatarId={peer.avatar} className="size-18 bg-brand text-3xl text-brand-foreground italic" />
        {peer.bio ? <p className="mt-2 font-heading text-[22px] leading-snug">“{peer.bio}”</p> : null}
        <p className="text-sm text-muted-foreground">{place ? `${place} · ` : ""}on OpenChat</p>
        <Link to={`/u/${peer.username}`} className="mt-1 self-start text-sm text-foreground underline-offset-4">
          View profile
        </Link>
      </div>
      {number ? (
        <div className="border-t border-border pt-5">
          <p className="flex items-baseline justify-between text-sm">
            <span className="font-medium">Safety number</span>
            <span className="text-xs text-muted-foreground" title={`Compare it with ${peer.username} to be sure nobody is in the middle`}>
              Compare
            </span>
          </p>
          <p className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-[13px] tracking-wider">
            {number.split(" ").map((group, i) => (
              <span key={i}>{group}</span>
            ))}
          </p>
        </div>
      ) : null}
      <div className="border-t border-border pt-5">
        <p className="flex justify-between text-sm">
          <span className="font-medium">Shared</span>
          <span className="font-mono text-muted-foreground">{photos.length}</span>
        </p>
        {shown.length ? (
          <ul aria-label="Shared photos" className="mt-3 grid grid-cols-3 gap-2">
            {shown.map((message) => (
              <SharedPhoto key={message._id} message={message} conversationKey={conversationKey} />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground italic">Photos you share will show here.</p>
        )}
      </div>
    </aside>
  );
};

export default MarginNotes;
