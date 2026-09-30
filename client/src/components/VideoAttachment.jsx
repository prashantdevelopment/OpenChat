import { useState } from "react";
import { PlayIcon, VideoOffIcon } from "lucide-react";
import { getReadyUrl, loadDecrypted } from "../lib/encryptedFiles.js";
import { formatDuration, formatFileSize } from "../lib/attachments.js";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import MediaViewer from "./MediaViewer.jsx";

// Up to 288px wide and 320px tall, keeping the video's shape (16:9 if unknown).
const displaySize = ({ width, height }) => {
  if (!width || !height) return { width: 288, height: 162 };
  const scale = Math.min(288 / width, 320 / height, 1);
  return { width: Math.max(Math.round(width * scale), 120), height: Math.max(Math.round(height * scale), 90) };
};

// A video message. Downloaded only when the user presses play (videos are
// big), then decrypted and played full screen (with Back and Download); the
// message then shows its first frame. previewUrl: my own video while it is sent.
const VideoAttachment = ({ fileId, file, previewUrl, from, label, caption, children }) => {
  const [state, setState] = useState({ status: "idle", url: null, progress: 0 });
  const [viewing, setViewing] = useState(false);
  const size = displaySize(file);
  // My own video (or one played before) is already here.
  const url = previewUrl ?? state.url ?? getReadyUrl(fileId);
  const details = [file.duration ? formatDuration(file.duration) : null, file.size ? formatFileSize(file.size) : null]
    .filter(Boolean)
    .join(" · ");

  const play = () => {
    setState({ status: "loading", url: null, progress: 0 });
    loadDecrypted(fileId, file, "video", (progress) => setState((s) => ({ ...s, progress })))
      .then((loaded) => {
        setState({ status: "ready", url: loaded, progress: 1 });
        setViewing(true);
      })
      .catch(() => setState({ status: "failed", url: null, progress: 0 }));
  };

  return (
    <div
      className="relative max-w-full overflow-hidden rounded-xl bg-neutral-900 text-white"
      style={{ width: size.width, aspectRatio: `${size.width} / ${size.height}` }}
    >
      {url ? (
        <>
          <video src={url} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} className="size-full object-cover" />
          <button
            type="button"
            onClick={() => setViewing(true)}
            aria-label={`Play video${details ? `, ${details}` : ""}`}
            className="absolute inset-0 flex cursor-pointer items-center justify-center border-0 bg-black/10 p-0 text-white hover:bg-black/20"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-black/45">
              <PlayIcon aria-hidden="true" className="size-6 fill-current" />
            </span>
          </button>
        </>
      ) : state.status === "loading" ? (
        <div className="flex size-full flex-col items-center justify-center gap-2 text-sm">
          <Spinner className="size-6" aria-hidden="true" role={undefined} aria-label={undefined} />
          <span role="progressbar" aria-label="Downloading video" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress * 100)}>
            {Math.round(state.progress * 100)}%
          </span>
        </div>
      ) : state.status === "failed" ? (
        <div role="alert" className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-sm">
          <VideoOffIcon aria-hidden="true" className="size-6" />
          Couldn&apos;t load video
          <Button variant="outline" size="xs" className="text-foreground" onClick={play}>
            Try again
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={play}
          aria-label={`Play video${details ? `, ${details}` : ""}`}
          className="flex size-full cursor-pointer flex-col items-center justify-center gap-2 border-0 bg-transparent p-0 text-white hover:bg-white/5"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-white/20">
            <PlayIcon aria-hidden="true" className="size-6 fill-current" />
          </span>
          {details ? <span className="text-xs">{details}</span> : null}
        </button>
      )}
      {children}
      {url ? <MediaViewer open={viewing} onOpenChange={setViewing} kind="video" url={url} file={file} from={from} label={label} caption={caption} /> : null}
    </div>
  );
};

export default VideoAttachment;
