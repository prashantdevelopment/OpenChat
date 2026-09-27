import { useEffect, useRef, useState } from "react";
import { m } from "motion/react";
import { MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon, SwitchCameraIcon, VideoIcon, VideoOffIcon } from "lucide-react";
import { useCall } from "./CallContext.js";
import Avatar from "../components/Avatar.jsx";
import VoiceOrb from "./VoiceOrb.jsx";
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
    "no-answer": "No answer",
    missed: `Missed call from ${name}`,
    microphone: "Microphone access is blocked. Allow it in your browser's site settings.",
    camera: "Camera or microphone access is blocked. Allow them in your browser's site settings.",
    failed: "The call couldn't connect",
    "key-changed": `${name}'s security key has changed. Open your chat with them to check it.`,
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

// "Calling...", "Connected, 0:12", "bobby_test declined the call", ...
// Announced to screen readers when it changes.
const CallStatus = ({ call, className }) => {
  const video = call.media === "video";
  const text = {
    calling: call.ringing ? "Ringing..." : "Calling...",
    ringing: video ? "Incoming video call" : "Incoming voice call",
    connecting: "Connecting...",
    ended: endMessage(call.endReason, call.peer.username),
  }[call.status];
  return (
    <p role="status" className={className}>
      {call.status === "connected" ? (
        <>
          <span className="sr-only">Connected, </span>
          <span className="font-mono text-[13px] tracking-wide not-italic tabular-nums">
            <CallTimer since={call.connectedAt} />
          </span>
        </>
      ) : (
        text
      )}
    </p>
  );
};

// A <video> showing a MediaStream (srcObject can't be set as an attribute).
// Muted: the voice plays through the provider's <audio> element.
const StreamVideo = ({ stream, className }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={className} />;
};

// Rises in and sinks away (the call panel appearing and closing).
const PANEL_MOTION = {
  initial: { opacity: 0, y: 16, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 16, scale: 0.98 },
  transition: { duration: 0.2, ease: "easeOut" },
};
// The video call fills a phone's screen: it only fades (a full-screen panel
// that grows or slides looks odd, and would sit off its edges meanwhile).
const FADE_MOTION = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: PANEL_MOTION.transition };

// Round, thin-lined 48px buttons (the Button's own sm: size is overridden);
// a pressed toggle (muted, camera off) is filled
// with ink, and ending the call is the one red button.
const Controls = ({ call, dark }) => {
  const { endCall, toggleMute, toggleCamera, switchCamera } = useCall();
  const round = cn(
    "size-12 rounded-full shadow-none sm:size-12",
    dark
      ? "border-stage-foreground/30 bg-stage-foreground/10 text-stage-foreground hover:bg-stage-foreground/20 aria-pressed:bg-stage-foreground aria-pressed:text-stage"
      : "border-foreground/25 bg-transparent hover:bg-accent aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background",
  );
  return (
    <div className="flex justify-center gap-4">
      {call.status !== "calling" ? (
        <Button variant="outline" size="icon-xl" className={round} aria-label="Mute microphone" aria-pressed={call.muted} onClick={toggleMute}>
          {call.muted ? <MicOffIcon aria-hidden="true" strokeWidth={1.5} /> : <MicIcon aria-hidden="true" strokeWidth={1.5} />}
        </Button>
      ) : null}
      {call.media === "video" ? (
        <Button variant="outline" size="icon-xl" className={round} aria-label="Turn camera off" aria-pressed={call.cameraOff} onClick={toggleCamera}>
          {call.cameraOff ? <VideoOffIcon aria-hidden="true" strokeWidth={1.5} /> : <VideoIcon aria-hidden="true" strokeWidth={1.5} />}
        </Button>
      ) : null}
      {call.media === "video" && call.canSwitchCamera ? (
        <Button variant="outline" size="icon-xl" className={round} aria-label="Switch camera" onClick={switchCamera}>
          <SwitchCameraIcon aria-hidden="true" strokeWidth={1.5} />
        </Button>
      ) : null}
      <Button size="icon-xl" className="size-12 rounded-full border-0 bg-brand text-brand-foreground shadow-none hover:bg-brand/90 sm:size-12" aria-label="End call" onClick={endCall}>
        <PhoneOffIcon aria-hidden="true" strokeWidth={1.5} />
      </Button>
    </div>
  );
};

// "Voice call" / "Video call" in mono small caps, above the name.
const Kicker = ({ children, className }) => (
  <p className={cn("font-mono text-[11px] tracking-[0.16em] uppercase", className)}>{children}</p>
);

// Video call: the other person large, me small in the corner (mirrored, like
// a mirror). Full screen on phones, a large panel on bigger screens.
const VideoCall = ({ call }) => {
  const name = call.peer.username;
  const showRemote = call.remoteStream && !call.peerCameraOff;
  return (
    <m.section
      {...FADE_MOTION}
      aria-label={`Video call with ${name}`}
      className="fixed inset-0 z-40 flex flex-col bg-stage text-stage-foreground sm:inset-auto sm:right-6 sm:bottom-6 sm:h-120 sm:w-160 sm:overflow-hidden sm:rounded-2xl sm:shadow-2xl"
    >
      <div className="relative min-h-0 flex-1">
        {showRemote ? (
          <StreamVideo stream={call.remoteStream} className="size-full bg-black object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3">
            <Avatar name={name} avatarId={call.peer.avatar} className="size-24 bg-brand text-4xl text-brand-foreground italic" />
            {call.peerCameraOff ? <p className="font-heading text-lg text-stage-foreground/80 italic">Camera off</p> : null}
          </div>
        )}
        <div className="absolute inset-x-0 top-0 flex items-start gap-2 bg-linear-to-b from-stage/85 to-transparent p-4 pb-10">
          <div className="min-w-0 flex-1">
            <Kicker className="text-stage-foreground/70">Video call</Kicker>
            <p className="mt-0.5 truncate font-heading text-2xl">{name}</p>
            <CallStatus call={call} className="font-heading text-stage-foreground/80 italic" />
          </div>
          {call.peerMuted ? (
            <span className="flex items-center gap-1.5 rounded-full border border-stage-foreground/30 bg-stage/60 px-2.5 py-1 font-mono text-[11px] tracking-[0.12em] uppercase">
              <MicOffIcon aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
              Muted
            </span>
          ) : null}
        </div>
        {/* My own picture, as a small print pinned in the corner. */}
        {call.localStream ? (
          <figure className="absolute right-3 bottom-3 w-[34vw] max-w-40 rotate-2 bg-print p-1 pb-0 text-print-foreground shadow-lg sm:w-44 sm:max-w-none">
            <div className="aspect-[3/4] overflow-hidden bg-stage sm:aspect-video">
              {call.cameraOff ? (
                <p className="flex size-full items-center justify-center px-1 text-center text-xs text-stage-foreground/80">Your camera is off</p>
              ) : (
                <StreamVideo stream={call.localStream} className="size-full -scale-x-100 object-cover" />
              )}
            </div>
            <figcaption className="py-0.5 text-center font-mono text-[10px] tracking-[0.14em] uppercase">You</figcaption>
          </figure>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-stage-foreground/10 p-4">
        <Controls call={call} dark />
      </div>
    </m.section>
  );
};

// The call card, floating above whatever page is open (a call survives
// moving between chats and settings). `call` comes as a prop: while the card
// animates away after the call, it keeps showing the call that just ended.
const CallOverlay = ({ call }) => {
  const { acceptCall, declineCall } = useCall();
  const name = call.peer.username;
  const { status } = call;

  if (call.media === "video" && ["calling", "connecting", "connected"].includes(status)) {
    return <VideoCall call={call} />;
  }

  const kind = call.media === "video" ? "Video" : "Voice";
  return (
    <m.section
      {...PANEL_MOTION}
      aria-label={`${kind} call with ${name}`}
      className="fixed inset-x-4 bottom-24 z-40 rounded-2xl border border-foreground/15 bg-popover p-5 text-popover-foreground shadow-[0_24px_60px_-20px_rgb(27_23_20/0.35)] sm:right-6 sm:left-auto sm:w-84"
    >
      <Kicker className="text-muted-foreground">{kind} call</Kicker>
      {/* Voice call in progress: the orb moves with the other person's voice. */}
      {call.media === "audio" && (status === "connecting" || status === "connected") ? (
        <div className="-mb-1 flex justify-center">
          <VoiceOrb stream={call.remoteStream} />
        </div>
      ) : null}
      <div className="mt-3 flex items-center gap-3.5 border-t border-border pt-4">
        <Avatar name={name} avatarId={call.peer.avatar} className="size-13 bg-brand text-2xl text-brand-foreground italic" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-2xl leading-tight">{name}</p>
          <CallStatus call={call} className={cn("font-heading italic", status === "ended" ? "text-muted-foreground" : "text-foreground")} />
        </div>
      </div>

      {status === "ringing" ? (
        <div className="mt-5 flex gap-3">
          <Button
            variant="outline"
            className="h-12.5 flex-1 rounded-full border-foreground/25 bg-transparent text-[15px] shadow-none hover:bg-accent sm:h-12.5 sm:text-[15px]"
            onClick={declineCall}
          >
            Decline
          </Button>
          {/* An ink pill with the phone in its own red circle, like Send. */}
          <Button className="h-12.5 flex-1 justify-between rounded-full pr-1.5 pl-5.5 text-[15px] sm:h-12.5 sm:text-[15px]" onClick={acceptCall}>
            Accept
            <span aria-hidden="true" className="grid size-9.5 place-items-center rounded-full bg-brand text-brand-foreground">
              {call.media === "video" ? <VideoIcon strokeWidth={1.5} /> : <PhoneIcon strokeWidth={1.5} />}
            </span>
          </Button>
        </div>
      ) : status === "ended" ? null : (
        <div className="mt-5">
          <Controls call={call} />
        </div>
      )}
    </m.section>
  );
};

export default CallOverlay;
