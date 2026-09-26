import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon } from "lucide-react";
import { getReadyUrl, loadDecrypted } from "../lib/encryptedFiles.js";
import { formatDuration } from "../lib/attachments.js";
import { Button } from "@/components/ui/button";

// A voice message: play/pause, a position slider (arrow keys work) and the
// time. Downloaded and decrypted on the first play (voice notes are small).
// previewUrl: my own voice note while it is being sent.
const VoiceNote = ({ fileId, file, previewUrl, children }) => {
  const audioRef = useRef(null);
  const playWhenLoaded = useRef(false);
  const [loadedUrl, setLoadedUrl] = useState(null);
  const [status, setStatus] = useState("idle"); // "idle" | "loading" | "failed"
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const src = previewUrl ?? loadedUrl ?? getReadyUrl(fileId);
  // From the message: WebM recordings don't carry their own length.
  const duration = file.duration || 0;

  // First play: once the decrypted file is in place, start it.
  useEffect(() => {
    if (src && playWhenLoaded.current) {
      playWhenLoaded.current = false;
      audioRef.current?.play().catch(() => {});
    }
  }, [src]);

  const toggle = () => {
    if (!src) {
      setStatus("loading");
      playWhenLoaded.current = true;
      loadDecrypted(fileId, file, "audio")
        .then((url) => {
          setLoadedUrl(url);
          setStatus("idle");
        })
        .catch(() => setStatus("failed"));
      return;
    }
    const audio = audioRef.current;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };

  return (
    <div className="relative flex w-64 max-w-full items-center gap-2 rounded-xl p-1.5">
      <Button
        type="button"
        size="icon-lg"
        variant="outline"
        className="shrink-0 rounded-full text-foreground"
        aria-label={isPlaying ? "Pause voice message" : "Play voice message"}
        loading={status === "loading"}
        onClick={toggle}
      >
        {isPlaying ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
      </Button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(position, duration || 1)}
          disabled={!src}
          aria-label="Position in voice message"
          aria-valuetext={`${formatDuration(position)} of ${formatDuration(duration)}`}
          onChange={(e) => {
            if (audioRef.current) audioRef.current.currentTime = Number(e.target.value);
            setPosition(Number(e.target.value));
          }}
          className="h-1.5 w-full cursor-pointer accent-current disabled:cursor-default"
        />
        <p className="mt-0.5 text-xs tabular-nums opacity-80">
          {status === "failed" ? (
            <span role="alert">Couldn&apos;t load. Press play to try again.</span>
          ) : isPlaying || position > 0 ? (
            `${formatDuration(position)} / ${formatDuration(duration)}`
          ) : (
            formatDuration(duration)
          )}
        </p>
      </div>
      {src ? (
        <audio
          ref={audioRef}
          src={src}
          preload="auto"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setPosition(0);
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        />
      ) : null}
      {children}
    </div>
  );
};

export default VoiceNote;
