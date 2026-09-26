import api from "../api/api.js";
import { decryptFile } from "../crypto/files.js";
import { IMAGE_TYPES } from "./images.js";
import { AUDIO_TYPES, VIDEO_TYPES, baseType } from "./attachments.js";

// fileId -> Promise<object URL>: each attachment is downloaded and decrypted
// once per session. My own files are put here right after upload.
const fileUrls = new Map();
// The same, for files that are already decrypted: shown straight away (my own
// files, or ones opened before), without pressing Play again.
const readyUrls = new Map();

export const rememberFile = (fileId, url) => {
  fileUrls.set(fileId, Promise.resolve(url));
  readyUrls.set(fileId, url);
};

export const getReadyUrl = (fileId) => readyUrls.get(fileId) ?? null;

// The type comes from the sender (inside the encrypted message), so it is
// only trusted for what the browser plays or shows inline: an image, video or
// audio type.
// Anything else, and every "file", is plain bytes (application/octet-stream):
// a blob typed text/html or SVG, opened in a tab, would run as a page of this
// site.
const safeType = (kind, mime) => {
  const type = baseType(mime);
  if (kind === "image" && IMAGE_TYPES.includes(type)) return type;
  if (kind === "video" && VIDEO_TYPES.includes(type)) return type;
  if (kind === "audio" && AUDIO_TYPES.includes(type)) return type;
  return "application/octet-stream";
};

// Downloads and decrypts one attachment; resolves to an object URL.
// onProgress(0..1) reports the download of the first request for this file.
export const loadDecrypted = (fileId, file, kind, onProgress) => {
  if (!fileUrls.has(fileId)) {
    const url = api
      .get(`/uploads/${fileId}`, {
        responseType: "arraybuffer",
        onDownloadProgress: (e) => e.total && onProgress?.(e.loaded / e.total),
      })
      .then((res) => decryptFile(res.data, file))
      .then((bytes) => {
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: safeType(kind, file.mime) }));
        readyUrls.set(fileId, objectUrl);
        return objectUrl;
      });
    url.catch(() => fileUrls.delete(fileId)); // so "Try again" downloads again
    fileUrls.set(fileId, url);
  }
  return fileUrls.get(fileId);
};
