import { describe, it, expect } from "vitest";
import { describeMessage, parseImageContent } from "../src/lib/messageContent.js";

const photo = (extra = {}) => JSON.stringify({ caption: "Goa!", file: { key: "a2V5", iv: "aXY=", mime: "image/jpeg", width: 800, height: 600 }, ...extra });

describe("parseImageContent", () => {
  it("reads the caption and the file details", () => {
    expect(parseImageContent(photo())).toEqual({ caption: "Goa!", file: { key: "a2V5", iv: "aXY=", mime: "image/jpeg", width: 800, height: 600 } });
  });

  it("returns null for anything that isn't a photo message", () => {
    expect(parseImageContent("just text")).toBeNull();
    expect(parseImageContent("{}")).toBeNull();
    expect(parseImageContent(JSON.stringify({ file: { key: 1, iv: "x" } }))).toBeNull();
    expect(parseImageContent("null")).toBeNull();
  });

  it("copes with a missing caption or size", () => {
    const parsed = parseImageContent(JSON.stringify({ file: { key: "k", iv: "i" } }));
    expect(parsed.caption).toBe("");
    expect(parsed.file.width).toBe(0);
  });
});

describe("describeMessage", () => {
  it("text stays text, photos become 'Photo' or 'Photo: caption'", () => {
    expect(describeMessage("text", "namaste")).toBe("namaste");
    expect(describeMessage("image", photo())).toBe("Photo: Goa!");
    expect(describeMessage("image", photo({ caption: "" }))).toBe("Photo");
    expect(describeMessage("image", "broken")).toBe("Photo");
  });
});
