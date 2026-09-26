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

const LABELS = { image: "Photo", video: "Video", audio: "Voice message", file: "File" };

// One line for the chat list and notifications: "Photo", "Video: caption",
// "Voice message (0:12)", "File: report.pdf".
export const describeMessage = (messageType, text) => {
  const label = LABELS[messageType];
  if (!label) return text;
  const content = parseAttachmentContent(text);
  if (messageType === "audio") return content?.file.duration ? `${label} (${formatDuration(content.file.duration)})` : label;
  const detail = messageType === "file" ? content?.file.name || content?.caption : content?.caption;
  return detail ? `${label}: ${detail}` : label;
};
