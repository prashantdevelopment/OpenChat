import { useState } from "react";
import { DownloadIcon, FileIcon } from "lucide-react";
import { loadDecrypted } from "../lib/encryptedFiles.js";
import { formatFileSize } from "../lib/attachments.js";
import { Button } from "@/components/ui/button";

// Saves a (decrypted) blob URL under the file's name.
const saveAs = (url, name) => {
  const link = document.createElement("a");
  link.href = url;
  link.download = name || "file";
  link.click();
};

// A file message: name, size and a Download button. The file is downloaded,
// decrypted and saved only when asked; it is never opened in the page (it is
// always saved as plain bytes, see lib/encryptedFiles.js).
// previewUrl: my own file while it is being sent.
const FileAttachment = ({ fileId, file, previewUrl, children }) => {
  const [state, setState] = useState({ status: "idle", progress: 0 });
  const name = file.name || "File";
  const extension = name.includes(".") ? name.split(".").pop().toUpperCase().slice(0, 6) : null;

  const download = () => {
    if (previewUrl) {
      saveAs(previewUrl, name);
      return;
    }
    setState({ status: "loading", progress: 0 });
    loadDecrypted(fileId, file, "file", (progress) => setState({ status: "loading", progress }))
      .then((url) => {
        saveAs(url, name);
        setState({ status: "idle", progress: 0 });
      })
      .catch(() => setState({ status: "failed", progress: 0 }));
  };

  return (
    <div className="relative flex w-72 max-w-full items-center gap-3 rounded-xl bg-background/90 p-3 text-foreground">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <FileIcon aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" title={name}>
          {name}
        </span>
        <span className="block text-xs text-muted-foreground">
          {[extension, file.size ? formatFileSize(file.size) : null].filter(Boolean).join(" · ")}
          {state.status === "loading" ? ` · ${Math.round(state.progress * 100)}%` : null}
        </span>
        {state.status === "failed" ? (
          <span role="alert" className="block text-xs text-destructive-foreground">
            Download failed. Try again.
          </span>
        ) : null}
      </span>
      <Button variant="outline" size="icon" aria-label={`Download ${name}`} loading={state.status === "loading"} onClick={download}>
        <DownloadIcon aria-hidden="true" />
      </Button>
      {children}
    </div>
  );
};

export default FileAttachment;
