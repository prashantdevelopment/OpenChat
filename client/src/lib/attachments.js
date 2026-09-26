import { IMAGE_TYPES, prepareImage } from "./images.js";

// Videos the browser can play: MP4, WebM and MOV (QuickTime, from iPhones).
// Other video formats are still sent, as files.
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
// Voice messages (see hooks/useVoiceRecorder.js).
export const AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg"];

// "audio/webm;codecs=opus" -> "audio/webm"
export const baseType = (mime) => String(mime).split(";")[0].trim().toLowerCase();

// Every file is encrypted and uploaded in one piece of at most 10 MB (the
// most Cloudinary's plan takes); AES-GCM adds 16 bytes.
export const MAX_FILE_BYTES = 10 * 1024 * 1024 - 16;
const MAX_NAME_LENGTH = 200;

const tooLarge = () => new Error("This file is larger than 10 MB.");

// Width, height and duration of a video, read by a hidden <video> element.
const readVideoDetails = (blob) =>
  new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    const done = (details) => {
      URL.revokeObjectURL(url);
      resolve(details);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      done({ width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : 0 });
    video.onerror = () => done({ width: 0, height: 0, duration: 0 }); // still sendable
    video.src = url;
  });

// What a chosen file will be sent as, ready to encrypt:
// { kind: "image" | "video" | "file", blob, mime, name, width, height, duration }.
// Throws an Error with a message for the user.
export const prepareAttachment = async (file) => {
  const name = file.name.slice(0, MAX_NAME_LENGTH);
  if (IMAGE_TYPES.includes(file.type)) {
    const photo = await prepareImage(file);
    if (photo.blob.size > MAX_FILE_BYTES) throw tooLarge();
    return { kind: "image", name, duration: 0, ...photo };
  }
  if (file.size > MAX_FILE_BYTES) throw tooLarge();
  if (file.size === 0) throw new Error("This file is empty.");
  if (VIDEO_TYPES.includes(file.type)) {
    return { kind: "video", blob: file, mime: file.type, name, ...(await readVideoDetails(file)) };
  }
  return { kind: "file", blob: file, mime: file.type || "application/octet-stream", name, width: 0, height: 0, duration: 0 };
};

// "850 KB" / "1.4 MB"
export const formatFileSize = (bytes) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// "0:42", "12:05"
export const formatDuration = (seconds) => {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
