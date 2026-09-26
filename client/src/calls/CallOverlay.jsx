import { useEffect, useRef, useState } from "react";
import { MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon, SwitchCameraIcon, VideoIcon, VideoOffIcon } from "lucide-react";
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
    "no-answer": "No answer",
    missed: `Missed call from ${name}`,
    microphone: "Microphone access is blocked. Allow it in your browser's site settings.",
    camera: "Camera or microphone access is blocked. Allow them in your browser's site settings.",
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
          <span className="tabular-nums">
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

const Controls = ({ dark }) => {
  const { call, endCall, toggleMute, toggleCamera, switchCamera } = useCall();
  const round = cn("rounded-full", dark && "border-white/30 bg-white/10 text-white hover:bg-white/20");
  return (
    <div className="flex justify-center gap-4">
      {call.status !== "calling" ? (
        <Button variant="outline" size="icon-xl" className={round} aria-label="Mute microphone" aria-pressed={call.muted} onClick={toggleMute}>
          {call.muted ? <MicOffIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
        </Button>
      ) : null}
      {call.media === "video" ? (
        <Button variant="outline" size="icon-xl" className={round} aria-label="Turn camera off" aria-pressed={call.cameraOff} onClick={toggleCamera}>
          {call.cameraOff ? <VideoOffIcon aria-hidden="true" /> : <VideoIcon aria-hidden="true" />}
        </Button>
      ) : null}
      {call.media === "video" && call.canSwitchCamera ? (
        <Button variant="outline" size="icon-xl" className={round} aria-label="Switch camera" onClick={switchCamera}>
          <SwitchCameraIcon aria-hidden="true" />
        </Button>
      ) : null}
      <Button variant="destructive" size="icon-xl" className="rounded-full" aria-label="End call" onClick={endCall}>
        <PhoneOffIcon aria-hidden="true" />
      </Button>
    </div>
  );
};

// Video call: the other person large, me small in the corner (mirrored, like
// a mirror). Full screen on phones, a large panel on bigger screens.
const VideoCall = ({ call }) => {
  const name = call.peer.username;
  const showRemote = call.remoteStream && !call.peerCameraOff;
  return (
    <section
      aria-label={`Video call with ${name}`}
      className="fixed inset-0 z-40 flex flex-col bg-neutral-950 text-white sm:inset-auto sm:right-6 sm:bottom-6 sm:h-120 sm:w-160 sm:overflow-hidden sm:rounded-2xl sm:shadow-2xl"
    >
      <div className="relative min-h-0 flex-1">
        {showRemote ? (
          <StreamVideo stream={call.remoteStream} className="size-full bg-black object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3">
            <Avatar name={name} avatarId={call.peer.avatar} className="size-24 text-3xl" />
            {call.peerCameraOff ? <p className="text-sm text-white/80">Camera off</p> : null}
          </div>
        )}
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-linear-to-b from-black/70 to-transparent p-4">
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading font-semibold">{name}</p>
            <CallStatus call={call} className="text-sm text-white/80" />
          </div>
          {call.peerMuted ? (
            <span className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-xs">
              <MicOffIcon aria-hidden="true" className="size-3.5" />
              Muted
            </span>
          ) : null}
        </div>
        {call.localStream ? (
          <div className="absolute right-3 bottom-3 aspect-video w-28 overflow-hidden rounded-lg border border-white/30 bg-neutral-800 sm:w-40">
            {call.cameraOff ? (
              <p className="flex size-full items-center justify-center text-xs text-white/80">Your camera is off</p>
            ) : (
              <StreamVideo stream={call.localStream} className="size-full -scale-x-100 object-cover" />
            )}
          </div>
        ) : null}
      </div>
      <div className="shrink-0 p-4">
        <Controls dark />
      </div>
    </section>
  );
};

// The call card, floating above whatever page is open (a call survives
// moving between chats and settings).
const CallOverlay = () => {
  const { call, acceptCall, declineCall } = useCall();
  const name = call.peer.username;
  const { status } = call;

  if (call.media === "video" && ["calling", "connecting", "connected"].includes(status)) {
    return <VideoCall call={call} />;
  }

  return (
    <section
      aria-label={`${call.media === "video" ? "Video" : "Voice"} call with ${name}`}
      className="fixed inset-x-4 bottom-24 z-40 rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl sm:right-6 sm:left-auto sm:w-80"
    >
      <div className="flex items-center gap-3">
        <Avatar name={name} avatarId={call.peer.avatar} className="size-12 text-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading font-semibold">{name}</p>
          <CallStatus call={call} className={cn("text-sm", status === "ended" ? "text-muted-foreground" : "text-foreground")} />
        </div>
      </div>

      {status === "ringing" ? (
        <div className="mt-4 flex gap-3">
          <Button variant="destructive" className="flex-1" onClick={declineCall}>
            <PhoneOffIcon aria-hidden="true" />
            Decline
          </Button>
          <Button className="flex-1 border-success bg-success text-white hover:bg-success/90 dark:text-background" onClick={acceptCall}>
            {call.media === "video" ? <VideoIcon aria-hidden="true" /> : <PhoneIcon aria-hidden="true" />}
            Accept
          </Button>
        </div>
      ) : status === "ended" ? null : (
        <div className="mt-4">
          <Controls />
        </div>
      )}
    </section>
  );
};

export default CallOverlay;
