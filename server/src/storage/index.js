import { CLOUDINARY, STORAGE_DRIVER, UPLOADS_DIR } from "../config/env.js";
import createLocalStorage from "./local.js";
import createCloudinaryStorage from "./cloudinary.js";

// Where uploaded files live. They are encrypted in the browser before upload,
// so the store only ever holds unreadable bytes and needs no image features:
// a Cloudinary or S3 driver only has to offer the same three methods
// (save, read, remove).
const drivers = {
    local: () => createLocalStorage(UPLOADS_DIR),
    cloudinary: () => createCloudinaryStorage(CLOUDINARY),
};

const storage = drivers[STORAGE_DRIVER]();

export default storage;
