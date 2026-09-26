import { useEffect, useState } from "react";
import { ImageOffIcon } from "lucide-react";
import { loadDecrypted } from "../lib/encryptedFiles.js";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

// Display size: up to 288px wide and 320px tall, keeping the photo's shape.
// Known before the photo loads, so nothing jumps when it appears.
const displaySize = ({ width, height }) => {
  if (!width || !height) return { width: 288, height: 216 };
  const scale = Math.min(288 / width, 320 / height, 1);
  return { width: Math.max(Math.round(width * scale), 96), height: Math.max(Math.round(height * scale), 64) };
};

// A photo from an image message. previewUrl: my own photo while it is still
// being sent (no download needed).
const EncryptedImage = ({ fileId, file, alt, previewUrl, children }) => {
  const [result, setResult] = useState({ fileId: null, url: null, failed: false });
  const [attempt, setAttempt] = useState(0);

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
    <div className="relative max-w-full overflow-hidden rounded-xl bg-muted" style={{ width: size.width, aspectRatio: `${size.width} / ${size.height}` }}>
      {url ? (
        // Opens the full photo in a new tab (a local blob: address).
        <a href={url} target="_blank" rel="noopener noreferrer" title="Open full size" className="block size-full">
          <img src={url} alt={alt} width={size.width} height={size.height} className="size-full object-cover" />
        </a>
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
    </div>
  );
};

export default EncryptedImage;
