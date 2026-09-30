import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeftIcon, BellIcon, BellOffIcon, EllipsisVerticalIcon, PhoneIcon, ShieldCheckIcon, UserRoundIcon, VideoIcon } from "lucide-react";
import Avatar from "./Avatar.jsx";
import SafetyNumber from "./SafetyNumber.jsx";
import ContactSheet from "./ContactSheet.jsx";
import MuteDialog from "./MuteDialog.jsx";
import { isMutedNow } from "../lib/mute.js";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { usePeerTyping } from "../socket/useTyping.js";
import { formatLastSeen } from "../lib/time.js";
import { displayName, handle } from "../lib/people.js";

// The open chat's top bar, one slim row like WhatsApp or Instagram: back (on
// phones), the person's photo and name with one small line under it
// (@username · online / last seen, or "writing…"), voice call, video call
// and a menu (contact info, safety number). Tapping the name opens the
// contact info sheet.
// mutedUntil / onMuteChange: this chat's notifications (MuteDialog).
const ChatHeader = ({ peer, currentUser, conversationId, conversationKey, photos, blocked, onBlockedChange, headingLevel: Heading = "h2", callDisabled, onCall, mutedUntil, onMuteChange }) => {
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const muted = isMutedNow(mutedUntil);
  const [contactOpen, setContactOpen] = useState(false);
  const isTyping = usePeerTyping(conversationId, currentUser._id);
  const name = displayName(peer);

  const status = isTyping ? (
    <span data-typing className="text-brand italic">
      writing…
    </span>
  ) : peer?.online ? (
    <span className="text-success">online</span>
  ) : peer?.lastSeen ? (
    formatLastSeen(peer.lastSeen)
  ) : null;

  return (
    <header className="flex h-15 shrink-0 items-center gap-1 border-b border-border px-2 md:h-17 md:gap-2 md:px-5">
      <Button render={<Link to="/chat" />} variant="ghost" size="icon-lg" className="rounded-full md:hidden" aria-label="Back to conversations">
        <ArrowLeftIcon aria-hidden="true" strokeWidth={1.4} />
      </Button>

      {peer ? (
        // The name is a button inside the heading; its ::after stretches over
        // the photo and the status line, so the whole block opens the sheet.
        <div className="relative flex min-h-[44px] min-w-0 flex-1 items-center gap-3 py-1 pr-2">
          <Avatar name={name} avatarId={peer.avatar} className="size-9.5 bg-brand text-lg text-brand-foreground italic md:size-10.5" />
          <span className="min-w-0">
            <Heading className="font-heading text-[1.1875rem] leading-tight md:text-[1.375rem]">
              <button
                type="button"
                data-slot="contact-trigger"
                aria-haspopup="dialog"
                onClick={() => setContactOpen(true)}
                className="block w-full cursor-pointer truncate text-left after:absolute after:inset-0 after:rounded-lg"
              >
                {name}
              </button>
            </Heading>
            <p data-status className="truncate text-xs leading-snug text-muted-foreground">
              {handle(peer)}
              {status ? <span aria-hidden="true"> · </span> : null}
              {status}
            </p>
          </span>
        </div>
      ) : (
        <Heading className="min-w-0 flex-1 truncate px-2 font-heading text-[1.1875rem] md:text-[1.375rem]">Conversation</Heading>
      )}

      <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label={`Voice call ${name}`.trim()} disabled={callDisabled} onClick={() => onCall("audio")}>
        <PhoneIcon aria-hidden="true" strokeWidth={1.4} />
      </Button>
      <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label={`Video call ${name}`.trim()} disabled={callDisabled} onClick={() => onCall("video")}>
        <VideoIcon aria-hidden="true" strokeWidth={1.4} />
      </Button>
      {peer ? (
        <Menu>
          <MenuTrigger render={<Button variant="ghost" size="icon-lg" className="rounded-full" aria-label="More options" />}>
            <EllipsisVerticalIcon aria-hidden="true" strokeWidth={1.4} />
          </MenuTrigger>
          <MenuPopup>
            <MenuItem onClick={() => setContactOpen(true)}>
              <UserRoundIcon aria-hidden="true" strokeWidth={1.5} />
              Contact info
            </MenuItem>
            <MenuItem onClick={() => setMuteOpen(true)}>
              {muted ? <BellIcon aria-hidden="true" strokeWidth={1.5} /> : <BellOffIcon aria-hidden="true" strokeWidth={1.5} />}
              {muted ? "Unmute notifications" : "Mute notifications"}
            </MenuItem>
            {peer.publicKey ? (
              <MenuItem onClick={() => setSafetyOpen(true)}>
                <ShieldCheckIcon aria-hidden="true" strokeWidth={1.5} />
                Safety number
              </MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
      ) : null}
      <ContactSheet
        open={contactOpen}
        onOpenChange={setContactOpen}
        peer={peer}
        myPublicKey={currentUser.publicKey}
        conversationId={conversationId}
        conversationKey={conversationKey}
        photos={photos}
        blocked={blocked}
        onBlockedChange={onBlockedChange}
      />
      {peer ? (
        <MuteDialog open={muteOpen} onOpenChange={setMuteOpen} conversationId={conversationId} name={name} mutedUntil={mutedUntil} onChanged={onMuteChange} />
      ) : null}
      <SafetyNumber myPublicKey={currentUser.publicKey} peerPublicKey={peer?.publicKey} peerName={name} open={safetyOpen} onOpenChange={setSafetyOpen} />
    </header>
  );
};

export default ChatHeader;
