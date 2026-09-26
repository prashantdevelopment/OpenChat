import { formatDuration } from "./attachments.js";

// What a message holds once decrypted. Text messages: the text itself.
// Photo, video, voice and file messages: JSON with the caption and the file's key
// and details ({ caption, file: { key, iv, mime, name, size, width, height, duration } }).
export const parseAttachmentContent = (text) => {
  try {
    const content = JSON.parse(text);
    const { file } = content ?? {};
    if (typeof file?.key !== "string" || typeof file?.iv !== "string") return null;
    return {
      caption: typeof content.caption === "string" ? content.caption : "",
      file: {
        key: file.key,
        iv: file.iv,
        mime: typeof file.mime === "string" ? file.mime : "",
        name: typeof file.name === "string" ? file.name : "",
        size: Number(file.size) || 0,
        width: Number(file.width) || 0,
        height: Number(file.height) || 0,
        duration: Number(file.duration) || 0,
      },
    };
  } catch {
    return null;
  }
};

// Call records (messageType "call", saved by the caller when a call ends):
// { media: "audio" | "video", outcome, duration } where outcome is
// "completed", "missed" (no answer), "cancelled", "declined", "busy" or "failed".
const OUTCOMES = ["completed", "missed", "cancelled", "declined", "busy", "failed"];
export const parseCallContent = (text) => {
  try {
    const { media, outcome, duration } = JSON.parse(text) ?? {};
    if (!OUTCOMES.includes(outcome)) return null;
    return { media: media === "video" ? "video" : "audio", outcome, duration: Number(duration) || 0 };
  } catch {
    return null;
  }
};

// How a call record reads for me: as the caller ("Outgoing voice call · 2:31",
// "... · No answer") or as the person called ("Missed video call", in red).
export const describeCall = ({ media, outcome, duration }, isMine) => {
  const kind = media === "video" ? "video call" : "voice call";
  if (isMine) {
    const detail = { completed: formatDuration(duration), missed: "No answer", cancelled: "Cancelled", declined: "Declined", busy: "Busy", failed: "Failed" }[outcome];
    return { text: `Outgoing ${kind} · ${detail}`, missed: false };
  }
  if (outcome === "completed") return { text: `Incoming ${kind} · ${formatDuration(duration)}`, missed: false };
  if (outcome === "declined") return { text: `Declined ${kind}`, missed: false };
  if (outcome === "failed") return { text: `Incoming ${kind} · Failed`, missed: false };
  return { text: `Missed ${kind}`, missed: true }; // no answer, cancelled or busy: I missed it
};

const LABELS = { image: "Photo", video: "Video", audio: "Voice message", file: "File" };

// One line for the chat list and notifications: "Photo", "Video: caption",
// "Voice message (0:12)", "File: report.pdf", "Missed voice call".
// isMine: whether I sent it (call records read differently for each side).
export const describeMessage = (messageType, text, { isMine = false } = {}) => {
  if (messageType === "call") {
    const call = parseCallContent(text);
    return call ? describeCall(call, isMine).text : "Call";
  }
  const label = LABELS[messageType];
  if (!label) return text;
  const content = parseAttachmentContent(text);
  if (messageType === "audio") return content?.file.duration ? `${label} (${formatDuration(content.file.duration)})` : label;
  const detail = messageType === "file" ? content?.file.name || content?.caption : content?.caption;
  return detail ? `${label}: ${detail}` : label;
};
