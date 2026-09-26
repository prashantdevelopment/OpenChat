import { describe, it, expect } from "vitest";
import { describeMessage, parseAttachmentContent } from "../src/lib/messageContent.js";
import { formatDuration, formatFileSize } from "../src/lib/attachments.js";

const content = (file = {}, extra = {}) =>
  JSON.stringify({ caption: "Goa!", file: { key: "a2V5", iv: "aXY=", mime: "image/jpeg", width: 800, height: 600, ...file }, ...extra });

describe("parseAttachmentContent", () => {
  it("reads the caption and the file details", () => {
    expect(parseAttachmentContent(content({ name: "IMG.jpg", size: 1234, duration: 0 }))).toEqual({
      caption: "Goa!",
      file: { key: "a2V5", iv: "aXY=", mime: "image/jpeg", name: "IMG.jpg", size: 1234, width: 800, height: 600, duration: 0 },
    });
  });

  it("returns null for anything that is not an attachment message", () => {
    expect(parseAttachmentContent("just text")).toBeNull();
    expect(parseAttachmentContent("{}")).toBeNull();
    expect(parseAttachmentContent(JSON.stringify({ file: { key: 1, iv: "x" } }))).toBeNull();
    expect(parseAttachmentContent("null")).toBeNull();
  });

  it("copes with missing or odd details", () => {
    const parsed = parseAttachmentContent(JSON.stringify({ file: { key: "k", iv: "i", name: 5, size: "x" } }));
    expect(parsed.caption).toBe("");
    expect(parsed.file).toMatchObject({ name: "", size: 0, width: 0, duration: 0, mime: "" });
  });
});

describe("describeMessage", () => {
  it("text stays text; photos and videos show the caption, files the name", () => {
    expect(describeMessage("text", "namaste")).toBe("namaste");
    expect(describeMessage("image", content())).toBe("Photo: Goa!");
    expect(describeMessage("image", content({}, { caption: "" }))).toBe("Photo");
    expect(describeMessage("video", content({ mime: "video/mp4" }))).toBe("Video: Goa!");
    expect(describeMessage("file", content({ name: "report.pdf" }))).toBe("File: report.pdf");
    expect(describeMessage("file", content({}, { caption: "" }))).toBe("File");
    expect(describeMessage("image", "broken")).toBe("Photo");
    expect(describeMessage("audio", content({ mime: "audio/webm", duration: 12.4 }))).toBe("Voice message (0:12)");
    expect(describeMessage("audio", "broken")).toBe("Voice message");
  });
});

describe("size and duration labels", () => {
  it("formats file sizes and video lengths", () => {
    expect(formatFileSize(300)).toBe("1 KB");
    expect(formatFileSize(850 * 1024)).toBe("850 KB");
    expect(formatFileSize(1.4 * 1024 * 1024)).toBe("1.4 MB");
    expect(formatDuration(42)).toBe("0:42");
    expect(formatDuration(725.4)).toBe("12:05");
  });
});
