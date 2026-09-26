import api from "../api/api.js";
import { decryptFile } from "../crypto/files.js";
import { IMAGE_TYPES } from "./images.js";

// fileId -> Promise<object URL>: each photo is downloaded and decrypted once
// per session. My own photos are put here right after upload.
const imageUrls = new Map();

export const rememberImage = (fileId, url) => imageUrls.set(fileId, Promise.resolve(url));

// The type comes from the sender (inside the encrypted message), so only
// image types are trusted: a blob typed text/html (or SVG) opened in a new
// tab would run as a page of this site.
const safeType = (mime) => (IMAGE_TYPES.includes(mime) ? mime : "application/octet-stream");

export const loadImage = (fileId, file) => {
  if (!imageUrls.has(fileId)) {
    const url = api
      .get(`/uploads/${fileId}`, { responseType: "arraybuffer" })
      .then((res) => decryptFile(res.data, file))
      .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: safeType(file.mime) })));
    url.catch(() => imageUrls.delete(fileId)); // so "Try again" downloads again
    imageUrls.set(fileId, url);
  }
  return imageUrls.get(fileId);
};
