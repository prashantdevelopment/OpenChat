import { STORAGE_DRIVER, UPLOADS_DIR } from "../config/env.js";
import createLocalStorage from "./local.js";

// Where uploaded files live. They are encrypted in the browser before upload,
// so the store only ever holds unreadable bytes and needs no image features:
// a Cloudinary or S3 driver only has to offer the same three methods
// (save, read, remove). "local" (the server's disk) is the only driver so far.
const drivers = {
    local: () => createLocalStorage(UPLOADS_DIR),
};

const storage = drivers[STORAGE_DRIVER]();

export default storage;
