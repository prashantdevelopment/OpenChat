import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { Maximize2Icon, MicIcon, MicOffIcon, Minimize2Icon, PhoneIcon, PhoneOffIcon, UsersRoundIcon, VideoIcon, VideoOffIcon } from "lucide-react";
import { useAuth } from "../auth/AuthContext.js";
import { useGroupCall } from "./GroupCallContext.js";
import { StreamVideo } from "./CallOverlay.jsx";
import Avatar from "../components/Avatar.jsx";
import { Button } from "@/components/ui/button";
import { displayName } from "../lib/people.js";
import { cn } from "@/lib/utils";

const MOTION = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 16 }, transition: { duration: 0.2, ease: "easeOut" } };

const endMessage = (reason) =>
  ({
    "you-left": "You left the call",
    full: "This call is full (six people at most)",
    microphone: "Microphone access is blocked. Allow it in your browser's site settings.",
    camera: "Camera or microphone access is blocked. Allow them in your browser's site settings.",
    elsewhere: "You joined this call on another device",
    lost: "The connection was lost",
  })[reason] ?? "The call couldn't connect";

const stateText = (peer) =>
  peer.keyChanged ? "Security key changed: not connected" : peer.state === "reconnecting" ? "Reconnecting…" : peer.state === "connected" ? null : "Connecting…";

// Their voice (video elements stay muted, so each voice plays once).
const PeerAudio = ({ stream }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream ?? null;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
};

// One person in the call: their video, or their initial when there is none.
const Tile = ({ name, stream, video, mirrored, muted, note }) => (
  <figure className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-xl bg-black/35">
    {video && stream ? (
      <StreamVideo stream={stream} className={cn("size-full object-cover", mirrored && "-scale-x-100")} />
    ) : (
      <Avatar name={name} className="size-16 bg-brand text-3xl text-brand-foreground italic sm:size-20" />
    )}
    <figcaption className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 truncate text-sm">
      <span className="truncate rounded-full bg-stage/70 px-2.5 py-0.5">{name}</span>
      {muted ? (
        <span className="grid size-6 place-items-center rounded-full bg-stage/70" title="Muted">
          <MicOffIcon aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
          <span className="sr-only">muted</span>
        </span>
      ) : null}
    </figcaption>
    {note ? <p className="absolute inset-x-2 top-2 truncate text-center font-heading text-sm text-stage-foreground/80 italic">{note}</p> : null}
  </figure>
);

const Controls = ({ call, onLeave }) => {
  const { toggleMute, toggleCamera } = useGroupCall();
  const round =
    "size-12 rounded-full border-stage-foreground/30 bg-stage-foreground/10 text-stage-foreground shadow-none hover:bg-stage-foreground/20 aria-pressed:bg-stage-foreground aria-pressed:text-stage sm:size-12";
  return (
    <div className="flex justify-center gap-4">
      <Button variant="outline" size="icon-xl" className={round} aria-label="Mute microphone" aria-pressed={call.muted} onClick={toggleMute}>
        {call.muted ? <MicOffIcon aria-hidden="true" strokeWidth={1.5} /> : <MicIcon aria-hidden="true" strokeWidth={1.5} />}
      </Button>
      {call.media === "video" ? (
        <Button variant="outline" size="icon-xl" className={round} aria-label="Turn camera off" aria-pressed={call.cameraOff} onClick={toggleCamera}>
          {call.cameraOff ? <VideoOffIcon aria-hidden="true" strokeWidth={1.5} /> : <VideoIcon aria-hidden="true" strokeWidth={1.5} />}
        </Button>
      ) : null}
      <Button size="icon-xl" className="size-12 rounded-full border-0 bg-brand text-brand-foreground shadow-none hover:bg-brand/90 sm:size-12" aria-label="Leave call" onClick={onLeave}>
        <PhoneOffIcon aria-hidden="true" strokeWidth={1.5} />
      </Button>
    </div>
  );
};

// The group call I'm in, the ring of one starting, or why mine ended.
// Full screen on phones, a large panel on bigger screens; minimised it is a
// small bar in the corner while the rest of the app is used.
const GroupCallOverlay = () => {
  const { currentUser } = useAuth();
  const { call, ring, joinGroupCall, leaveCall, dismissRing } = useGroupCall();
  const [minimised, setMinimised] = useState(false);
  if (!call && minimised) setMinimised(false);

  const peers = Object.entries(call?.peers ?? {});
  const video = call?.media === "video";
  const kind = video ? "Group video call" : "Group voice call";
  const count = peers.length + 1;

  return (
    <>
      {/* Voices of everyone connected, also while minimised. */}
      {peers.map(([userId, peer]) => (peer.stream ? <PeerAudio key={userId} stream={peer.stream} /> : null))}
      {/* One at a time: the panel goes before the small bar comes (never two Leave buttons). */}
      <AnimatePresence mode="wait">
        {ring && !call ? (
          <m.section
            key="ring"
            {...MOTION}
            aria-label={`${ring.media === "video" ? "Group video" : "Group voice"} call in ${ring.groupName}`}
            className="fixed inset-x-4 bottom-24 z-40 rounded-2xl border border-foreground/15 bg-popover p-5 text-popover-foreground shadow-[0_24px_60px_-20px_rgb(27_23_20/0.35)] sm:right-6 sm:left-auto sm:w-84"
          >
            <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">{ring.media === "video" ? "Group video call" : "Group voice call"}</p>
            <p className="mt-1 truncate font-heading text-2xl">{ring.groupName}</p>
            <p role="status" className="font-heading text-muted-foreground italic">
              {displayName(ring.from)} is calling
            </p>
            <div className="mt-4 flex gap-3">
              <Button variant="outline" className="min-h-[44px] flex-1 rounded-full" onClick={dismissRing}>
                Not now
              </Button>
              <Button className="min-h-[44px] flex-1 rounded-full" onClick={() => joinGroupCall({ groupId: ring.groupId, media: ring.media })}>
                <PhoneIcon aria-hidden="true" strokeWidth={1.5} />
                Join
              </Button>
            </div>
          </m.section>
        ) : null}

        {call?.status === "ended" ? (
          <m.section key="ended" {...MOTION} aria-label="Group call" className="fixed inset-x-4 bottom-24 z-40 rounded-2xl border border-foreground/15 bg-popover p-5 text-popover-foreground shadow-lg sm:right-6 sm:left-auto sm:w-84">
            <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">{call.groupName || "Group call"}</p>
            <p role="status" className="mt-1 font-heading text-lg">
              {endMessage(call.endReason)}
            </p>
          </m.section>
        ) : call && minimised ? (
          <m.section key="mini" {...MOTION} aria-label={`${kind} in ${call.groupName}`} className="fixed right-4 bottom-24 z-40 flex items-center gap-2 rounded-full bg-stage py-1.5 pr-1.5 pl-4 text-stage-foreground shadow-2xl sm:right-6 sm:bottom-6">
            <UsersRoundIcon aria-hidden="true" className="size-4" strokeWidth={1.5} />
            <span className="max-w-40 truncate text-sm">
              {call.groupName} · {count}
            </span>
            <Button variant="outline" size="icon-lg" className="size-11 rounded-full border-stage-foreground/30 bg-transparent text-stage-foreground shadow-none sm:size-9" aria-label="Open the call" onClick={() => setMinimised(false)}>
              <Maximize2Icon aria-hidden="true" strokeWidth={1.5} />
            </Button>
            <Button size="icon-lg" className="size-11 rounded-full border-0 bg-brand text-brand-foreground shadow-none sm:size-9" aria-label="Leave call" onClick={leaveCall}>
              <PhoneOffIcon aria-hidden="true" strokeWidth={1.5} />
            </Button>
          </m.section>
        ) : call ? (
          <m.section
            key="call"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-label={`${kind} in ${call.groupName || "the group"}`}
            className="fixed inset-0 z-40 flex flex-col bg-stage text-stage-foreground sm:inset-auto sm:right-6 sm:bottom-6 sm:h-140 sm:max-h-[calc(100dvh-3rem)] sm:w-200 sm:max-w-[calc(100vw-3rem)] sm:overflow-hidden sm:rounded-2xl sm:shadow-2xl"
          >
            <header className="flex shrink-0 items-start gap-2 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[11px] tracking-[0.16em] text-stage-foreground/70 uppercase">{kind}</p>
                <p className="truncate font-heading text-2xl">{call.groupName || "…"}</p>
                <p role="status" className="font-heading text-stage-foreground/80 italic">
                  {call.status === "joining" ? "Joining…" : peers.length === 0 ? "Waiting for others to join…" : `${count} in the call`}
                </p>
              </div>
              <Button
                variant="outline"
                size="icon-lg"
                className="size-11 shrink-0 rounded-full border-stage-foreground/30 bg-stage/60 text-stage-foreground shadow-none hover:bg-stage-foreground/20 sm:size-10"
                aria-label="Minimise call"
                onClick={() => setMinimised(true)}
              >
                <Minimize2Icon aria-hidden="true" strokeWidth={1.5} />
              </Button>
            </header>
            <div className={cn("grid min-h-0 flex-1 gap-2 px-2 sm:px-4", count <= 1 ? "grid-cols-1" : count <= 4 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
              <Tile name={`${displayName(currentUser)} (you)`} stream={call.localStream} video={video && !call.cameraOff} mirrored muted={call.muted} />
              {peers.map(([userId, peer]) => (
                <Tile key={userId} name={peer.name ?? "Someone"} stream={peer.stream} video={video && !peer.cameraOff} muted={peer.muted} note={stateText(peer)} />
              ))}
            </div>
            <div className="shrink-0 p-4">
              <Controls call={call} onLeave={leaveCall} />
            </div>
          </m.section>
        ) : null}
      </AnimatePresence>
    </>
  );
};

export default GroupCallOverlay;
