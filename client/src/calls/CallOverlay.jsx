import { useEffect, useState } from "react";
import { MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon } from "lucide-react";
import { useCall } from "./CallContext.js";
import Avatar from "../components/Avatar.jsx";
import { formatDuration } from "../lib/attachments.js";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Why a call ended, in words (the key is the reason from CallProvider).
const endMessage = (reason, name) =>
  ({
    "you-ended": "Call ended",
    ended: "Call ended",
    "you-declined": "Call declined",
    declined: `${name} declined the call`,
    cancelled: `${name} cancelled the call`,
    busy: `${name} is on another call`,
    microphone: "Microphone access is blocked. Allow it in your browser's site settings.",
    failed: "The call couldn't connect",
  })[reason] ?? "Call ended";

// Seconds since the call connected, updated every second.
const CallTimer = ({ since }) => {
  const [now, setNow] = useState(since); // 0:00 at first, then every second
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return formatDuration((now - since) / 1000);
};

// The call card, floating above whatever page is open (a call survives
// moving between chats and settings).
const CallOverlay = () => {
  const { call, acceptCall, declineCall, endCall, toggleMute } = useCall();
  const name = call.peer.username;
  const { status } = call;

  const statusText = {
    calling: "Calling...",
    ringing: "Incoming voice call",
    connecting: "Connecting...",
    connected: null, // the timer
    ended: endMessage(call.endReason, name),
  }[status];

  return (
    <section
      aria-label={`Voice call with ${name}`}
      className="fixed inset-x-4 bottom-24 z-40 rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl sm:right-6 sm:left-auto sm:w-80"
    >
      <div className="flex items-center gap-3">
        <Avatar name={name} avatarId={call.peer.avatar} className="size-12 text-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading font-semibold">{name}</p>
          {/* Announced when it changes: ringing, connected, ended. */}
          <p role="status" className={cn("text-sm", status === "ended" ? "text-muted-foreground" : "text-foreground")}>
            {status === "connected" ? (
              <>
                <span className="sr-only">Connected, </span>
                <span className="tabular-nums">
                  <CallTimer since={call.connectedAt} />
                </span>
              </>
            ) : (
              statusText
            )}
          </p>
        </div>
      </div>

      {status === "ringing" ? (
        <div className="mt-4 flex gap-3">
          <Button variant="destructive" className="flex-1" onClick={declineCall}>
            <PhoneOffIcon aria-hidden="true" />
            Decline
          </Button>
          <Button className="flex-1 border-success bg-success text-white hover:bg-success/90 dark:text-background" onClick={acceptCall}>
            <PhoneIcon aria-hidden="true" />
            Accept
          </Button>
        </div>
      ) : status === "ended" ? null : (
        <div className="mt-4 flex justify-center gap-4">
          {status !== "calling" ? (
            <Button
              variant="outline"
              size="icon-xl"
              className="rounded-full"
              aria-label="Mute microphone"
              aria-pressed={call.muted}
              onClick={toggleMute}
            >
              {call.muted ? <MicOffIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
            </Button>
          ) : null}
          <Button variant="destructive" size="icon-xl" className="rounded-full" aria-label="End call" onClick={endCall}>
            <PhoneOffIcon aria-hidden="true" />
          </Button>
        </div>
      )}
    </section>
  );
};

export default CallOverlay;
