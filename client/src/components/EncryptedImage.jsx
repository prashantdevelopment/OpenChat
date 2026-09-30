import { useEffect, useState } from "react";
import { ImageOffIcon } from "lucide-react";
import { loadDecrypted } from "../lib/encryptedFiles.js";
import MediaViewer from "./MediaViewer.jsx";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Display size: up to 288px wide and 320px tall, keeping the photo's shape.
// Known before the photo loads, so nothing jumps when it appears.
const displaySize = ({ width, height }) => {
  if (!width || !height) return { width: 288, height: 216 };
  const scale = Math.min(288 / width, 320 / height, 1);
  return { width: Math.max(Math.round(width * scale), 96), height: Math.max(Math.round(height * scale), 64) };
};

// A photo from an image message: tap it to see it full screen (with Back and
// Download). previewUrl: my own photo while it is still being sent (no
// download needed).
const EncryptedImage = ({ fileId, file, alt, from, caption, previewUrl, children, className }) => {
  const [result, setResult] = useState({ fileId: null, url: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  const [viewing, setViewing] = useState(false);

  useEffect(() => {
    if (previewUrl || !fileId) return;
    let ignore = false;
    loadDecrypted(fileId, file, "image")
      .then((url) => !ignore && setResult({ fileId, url, failed: false }))
      .catch(() => !ignore && setResult({ fileId, url: null, failed: true }));
    return () => {
      ignore = true;
    };
  }, [fileId, file, previewUrl, attempt]);

  const url = previewUrl ?? (result.fileId === fileId ? result.url : null);
  const failed = !previewUrl && result.fileId === fileId && result.failed;
  const size = displaySize(file);

  return (
    <div className={cn("relative max-w-full overflow-hidden rounded-xl bg-muted", className)} style={{ width: size.width, aspectRatio: `${size.width} / ${size.height}` }}>
      {url ? (
        <button type="button" onClick={() => setViewing(true)} aria-label={`${alt}. View full screen`} className="block size-full cursor-zoom-in border-0 bg-transparent p-0">
          <img src={url} alt={alt} width={size.width} height={size.height} className="size-full object-cover" />
        </button>
      ) : failed ? (
        <div role="alert" className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-sm text-muted-foreground">
          <ImageOffIcon aria-hidden="true" className="size-6" />
          Couldn&apos;t load photo
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              setResult({ fileId: null, url: null, failed: false });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Spinner className="size-5" aria-label="Loading photo" />
        </div>
      )}
      {children}
      {url ? <MediaViewer open={viewing} onOpenChange={setViewing} kind="image" url={url} file={file} from={from} label={alt} caption={caption} /> : null}
    </div>
  );
};

export default EncryptedImage;
