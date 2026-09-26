// What a message holds once decrypted. Text messages: the text itself.
// Image messages: JSON with the caption and the photo's key and details
// ({ caption, file: { key, iv, mime, width, height } }).
export const parseImageContent = (text) => {
  try {
    const content = JSON.parse(text);
    const { file } = content ?? {};
    if (typeof file?.key !== "string" || typeof file?.iv !== "string") return null;
    return {
      caption: typeof content.caption === "string" ? content.caption : "",
      file: { key: file.key, iv: file.iv, mime: file.mime, width: Number(file.width) || 0, height: Number(file.height) || 0 },
    };
  } catch {
    return null;
  }
};

// One line for the chat list and notifications: "Photo" or "Photo: caption".
export const describeMessage = (messageType, text) => {
  if (messageType !== "image") return text;
  const caption = parseImageContent(text)?.caption;
  return caption ? `Photo: ${caption}` : "Photo";
};
