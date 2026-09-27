// Photos are prepared in the browser before they are encrypted:
// - redrawn on a canvas, which drops all metadata (EXIF: camera, time and
//   often the GPS location where the photo was taken),
// - made at most 2048px on the long side (phone photos are much bigger).
// GIFs are kept as they are, so they stay animated.
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // before shrinking
const MAX_SIDE = 2048;

// Returns { blob, mime, width, height }, or throws an Error with a message
// for the user.
export const prepareImage = async (file) => {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, WebP or GIF image.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("This image is larger than 20 MB.");
  }

  // imageOrientation: turn the photo upright first (orientation is EXIF too).
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("This image couldn't be read.");
  });
  try {
    if (file.type === "image/gif") {
      return { blob: file, mime: file.type, width: bitmap.width, height: bitmap.height };
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    // PNG keeps transparency; everything else becomes a compact JPEG.
    const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.85));
    if (!blob) throw new Error("This image couldn't be prepared.");
    return { blob, mime, width, height };
  } finally {
    bitmap.close();
  }
};

// Profile photo: the middle square of the image, 256×256 JPEG (redrawn, so
// without metadata too). Transparent parts become white.
const AVATAR_SIZE = 256;
export const makeAvatar = async (file) => {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, WebP or GIF image.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("This image is larger than 20 MB.");
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("This image couldn't be read.");
  });
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("This image couldn't be prepared.");
    return blob;
  } finally {
    bitmap.close();
  }
};
