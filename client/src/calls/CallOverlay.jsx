import { useEffect, useRef, useState } from "react";
import { m } from "motion/react";
import { Minimize2Icon, MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon, PictureInPicture2Icon, SwitchCameraIcon, VideoIcon, VideoOffIcon } from "lucide-react";
import { useCall } from "./CallContext.js";
import Avatar from "../components/Avatar.jsx";
import VoiceOrb from "./VoiceOrb.jsx";
import { formatDuration } from "../lib/attachments.js";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { displayName } from "../lib/people.js";

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
    lost: "The connection was lost",
    "key-changed": `${name}'s security key has changed. Open your chat with them to check it.`,
  })[reason] ?? "Call ended";

// Seconds since the call connected, updated every second.
const CallTimer = ({ since }) => {
  // The real time from the start: after "Reconnecting…" the timer is drawn
  // again and must not show 0:00 for a second.
  const [now, setNow] = useState(() => Date.now());
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
    ended: endMessage(call.endReason, displayName(call.peer)),
  }[call.status];
  return (
    <p role="status" className={className}>
      {call.status === "connected" && call.reconnecting ? (
        "Reconnecting…"
      ) : call.status === "connected" ? (
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
export const StreamVideo = ({ stream, className, videoRef }) => {
  const ownRef = useRef(null);
  const ref = videoRef ?? ownRef;
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [ref, stream]);
  return <video ref={ref} autoPlay playsInline muted className={className} />;
};

// Picture-in-picture: the other person's video in a small window that floats
// over other apps and tabs (Android Chrome, iPhone Safari, desktop browsers).
const canFloat = () => typeof document !== "undefined" && document.pictureInPictureEnabled === true;
const floatVideo = async (video) => {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video?.requestPictureInPicture();
  } catch (error) {
    console.error("Picture-in-picture didn't open:", error);
  }
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
      <Button size="icon-xl" className="size-12 rounded-full border-0 bg-destructive text-white shadow-none hover:bg-destructive/90 sm:size-12" aria-label="End call" onClick={endCall}>
        <PhoneOffIcon aria-hidden="true" strokeWidth={1.5} />
      </Button>
    </div>
  );
};

// "Voice call" / "Video call" in mono small caps, above the name.
const Kicker = ({ children, className }) => (
  <p className={cn("font-mono text-[11px] tracking-[0.16em] uppercase", className)}>{children}</p>
);

// Minimised video call: a small tile in the corner while you use the rest of
// the app (other chats, settings). Tap it to open the call again.
const MiniVideoCall = ({ call, onOpen }) => {
  const { endCall } = useCall();
  const name = displayName(call.peer);
  const showRemote = call.remoteStream && !call.peerCameraOff;
  return (
    <m.section
      {...PANEL_MOTION}
      aria-label={`Video call with ${name}`}
      className="fixed right-4 bottom-24 z-40 w-32 overflow-hidden rounded-2xl bg-stage text-stage-foreground shadow-2xl sm:right-6 sm:bottom-6 sm:w-44"
    >
      <button type="button" data-slot="call-tile" onClick={onOpen} className="block w-full cursor-pointer text-left" aria-label={`Open the video call with ${name}`}>
        <div className="aspect-[3/4] bg-black">
          {showRemote ? (
            <StreamVideo stream={call.remoteStream} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Avatar name={name} avatarId={call.peer.avatar} className="size-14 bg-brand text-2xl text-brand-foreground" />
            </div>
          )}
        </div>
        <span className="block truncate px-2 pt-1.5 font-heading text-sm">{name}</span>
      </button>
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <CallStatus call={call} className="min-w-0 truncate text-[11px] text-stage-foreground/75" />
        <Button size="icon-lg" className="size-9 shrink-0 rounded-full border-0 bg-destructive text-white shadow-none hover:bg-destructive/90 sm:size-9" aria-label="End call" onClick={endCall}>
          <PhoneOffIcon aria-hidden="true" strokeWidth={1.5} />
        </Button>
      </div>
    </m.section>
  );
};

// The small picture in a video call: tap it to swap who is large; drag it
// anywhere (finger or mouse) inside the call, below the top bar. A tap is a
// press that moved less than a few pixels. Keyboard: Enter/Space swaps, the
// arrow keys move it. Its place is kept by the call (swap, minimise, turning
// the phone), and it stays inside when the screen size changes.
const TAP_SLOP_PX = 6;
const EDGE_PX = 8;
const SmallPicture = ({ area, topBar, place, onPlace, onSwap, label, children }) => {
  const tile = useRef(null);
  const moved = useRef(false);

  const inside = (x, y) => {
    const box = area.current?.getBoundingClientRect();
    const own = tile.current?.getBoundingClientRect();
    if (!box || !own) return { x, y };
    const top = (topBar.current?.offsetHeight ?? 0) + EDGE_PX;
    return {
      x: Math.min(Math.max(EDGE_PX, x), box.width - own.width - EDGE_PX),
      y: Math.min(Math.max(top, y), box.height - own.height - EDGE_PX),
    };
  };

  // The screen changed size (phone turned, window resized): back inside. One
  // observer for the call; it reads the latest place (never an old one).
  useEffect(() => {
    if (!area.current) return;
    const observer = new ResizeObserver(() => onPlace((now) => now && inside(now.x, now.y)));
    observer.observe(area.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inside() only reads refs
  }, [area, onPlace]);

  // The pointer is followed on the whole window while dragging: the picture
  // jumps out of its corner on the first move, and must not lose the drag.
  const onPointerDown = (event) => {
    const box = area.current.getBoundingClientRect();
    const own = tile.current.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, left: own.left - box.left, top: own.top - box.top };
    moved.current = false;
    const onMove = (move) => {
      const dx = move.clientX - start.x;
      const dy = move.clientY - start.y;
      if (!moved.current && Math.hypot(dx, dy) < TAP_SLOP_PX) return;
      moved.current = true;
      onPlace(inside(start.left + dx, start.top + dy));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  const onKeyDown = (event) => {
    const step = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[event.key];
    if (!step) return;
    event.preventDefault();
    const box = area.current.getBoundingClientRect();
    const own = tile.current.getBoundingClientRect();
    onPlace(inside(own.left - box.left + step[0], own.top - box.top + step[1]));
  };

  return (
    <button
      ref={tile}
      type="button"
      data-slot="call-small-picture"
      aria-label={`${label}. Swap views`}
      title="Tap to swap, drag to move"
      onClick={() => {
        if (!moved.current) onSwap();
        moved.current = false;
      }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      style={place ? { left: place.x, top: place.y } : undefined}
      className={cn(
        "absolute w-[34vw] max-w-40 cursor-grab touch-none bg-print p-1 pb-0 text-print-foreground shadow-lg select-none active:cursor-grabbing sm:w-44 sm:max-w-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stage-foreground",
        !place && "right-3 bottom-3 rotate-2",
      )}
    >
      {children}
    </button>
  );
};

// Video call: the other person large, me small (mirrored, like a mirror);
// tap the small picture to swap, drag it anywhere. Full screen on phones, a
// large panel on bigger screens.
const VideoCall = ({ call }) => {
  const name = displayName(call.peer);
  const showRemote = call.remoteStream && !call.peerCameraOff;
  const [minimised, setMinimised] = useState(false);
  const [swapped, setSwapped] = useState(false); // me large, them small
  const [place, setPlace] = useState(null); // where the small picture was dragged
  const remoteVideo = useRef(null);
  const area = useRef(null);
  const topBar = useRef(null);

  // Leaving the app during a video call: browsers that support it float the
  // other person's video by themselves (Media Session "enterpictureinpicture").
  useEffect(() => {
    if (!("mediaSession" in navigator) || !showRemote || minimised) return;
    try {
      navigator.mediaSession.setActionHandler("enterpictureinpicture", () => floatVideo(remoteVideo.current));
    } catch {
      return; // not supported here
    }
    return () => {
      try {
        navigator.mediaSession.setActionHandler("enterpictureinpicture", null);
      } catch {
        // not supported here
      }
    };
  }, [showRemote, minimised]);

  if (minimised) return <MiniVideoCall call={call} onOpen={() => setMinimised(false)} />;
  const topButton = "size-11 shrink-0 rounded-full border-stage-foreground/30 bg-stage/60 text-stage-foreground shadow-none hover:bg-stage-foreground/20 sm:size-10";

  // Them, large or small (picture-in-picture always floats them).
  const them = (large) =>
    showRemote ? (
      <StreamVideo stream={call.remoteStream} videoRef={remoteVideo} className={cn("size-full object-cover", large && "bg-black")} />
    ) : (
      <div className="flex size-full flex-col items-center justify-center gap-3">
        <Avatar name={name} avatarId={call.peer.avatar} className={large ? "size-24 bg-brand text-4xl text-brand-foreground" : "size-12 bg-brand text-xl text-brand-foreground"} />
        {call.peerCameraOff && large ? <p className="font-heading text-lg text-stage-foreground/80 italic">Camera off</p> : null}
      </div>
    );
  // Me, large or small.
  const me = (large) =>
    call.cameraOff ? (
      <p className={cn("flex size-full items-center justify-center px-1 text-center text-stage-foreground/80", large ? "font-heading text-lg italic" : "text-xs")}>Your camera is off</p>
    ) : (
      <StreamVideo stream={call.localStream} className={cn("size-full -scale-x-100 object-cover", large && "bg-black")} />
    );

  return (
    <m.section
      {...FADE_MOTION}
      aria-label={`Video call with ${name}`}
      className="fixed inset-0 z-40 flex flex-col bg-stage text-stage-foreground sm:inset-auto sm:right-6 sm:bottom-6 sm:h-120 sm:max-h-[calc(100dvh-3rem)] sm:w-160 sm:max-w-[calc(100vw-3rem)] sm:overflow-hidden sm:rounded-2xl sm:shadow-2xl"
    >
      <div ref={area} className="relative min-h-0 flex-1 overflow-hidden">
        <div data-slot="call-large-picture" data-shows={swapped ? "me" : "them"} className="size-full">
          {swapped ? me(true) : them(true)}
        </div>
        <div ref={topBar} className="absolute inset-x-0 top-0 flex items-start gap-2 bg-linear-to-b from-stage/85 to-transparent p-4 pb-10">
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
          {showRemote && canFloat() ? (
            <Button variant="outline" size="icon-lg" className={topButton} aria-label="Picture in picture" onClick={() => floatVideo(remoteVideo.current)}>
              <PictureInPicture2Icon aria-hidden="true" strokeWidth={1.5} />
            </Button>
          ) : null}
          <Button variant="outline" size="icon-lg" className={topButton} aria-label="Minimise call" onClick={() => setMinimised(true)}>
            <Minimize2Icon aria-hidden="true" strokeWidth={1.5} />
          </Button>
        </div>
        {/* The small picture, as a print pinned in the corner: me, or them after a swap. */}
        {call.localStream ? (
          <SmallPicture
            area={area}
            topBar={topBar}
            place={place}
            onPlace={setPlace}
            onSwap={() => setSwapped((now) => !now)}
            label={swapped ? `${name}'s video` : "Your video"}
          >
            <span className="block aspect-[3/4] overflow-hidden bg-stage sm:aspect-video">{swapped ? them(false) : me(false)}</span>
            <span className="block truncate py-0.5 text-center font-mono text-[10px] tracking-[0.14em] uppercase">{swapped ? name : "You"}</span>
          </SmallPicture>
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
  const name = displayName(call.peer);
  const { status } = call;

  if (call.media === "video" && ["calling", "connecting", "connected"].includes(status)) {
    return <VideoCall call={call} />;
  }

  const kind = call.media === "video" ? "Video" : "Voice";
  return (
    <m.section
      {...PANEL_MOTION}
      aria-label={`${kind} call with ${name}`}
      className="fixed inset-x-4 bottom-24 z-40 rounded-2xl border border-foreground/15 bg-popover p-5 text-popover-foreground shadow-[0_24px_60px_-20px_rgb(10_30_25/0.35)] sm:right-6 sm:left-auto sm:w-84"
    >
      <Kicker className="text-muted-foreground">{kind} call</Kicker>
      {/* Voice call in progress: the orb moves with the other person's voice. */}
      {call.media === "audio" && (status === "connecting" || status === "connected") ? (
        <div className="-mb-1 flex justify-center">
          <VoiceOrb stream={call.remoteStream} />
        </div>
      ) : null}
      <div className="mt-3 flex items-center gap-3.5 border-t border-border pt-4">
        <Avatar name={name} avatarId={call.peer.avatar} className="size-13 bg-brand text-2xl text-brand-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-2xl leading-tight">{name}</p>
          <CallStatus call={call} className={cn("font-heading italic", status === "ended" ? "text-muted-foreground" : "text-foreground")} />
        </div>
      </div>

      {status === "ringing" ? (
        <div className="mt-5 flex gap-3">
          <Button
            variant="outline"
            className="h-12.5 flex-1 rounded-full border-foreground/25 bg-transparent text-[0.9375rem] shadow-none hover:bg-accent sm:h-12.5 sm:text-[0.9375rem]"
            onClick={declineCall}
          >
            Decline
          </Button>
          {/* A jade pill with the phone in its own circle, like Send. */}
          <Button className="h-12.5 flex-1 justify-between rounded-full pr-1.5 pl-5.5 text-[0.9375rem] sm:h-12.5 sm:text-[0.9375rem]" onClick={acceptCall}>
            Accept
            <span aria-hidden="true" className="grid size-9.5 place-items-center rounded-full bg-primary-foreground text-primary">
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
