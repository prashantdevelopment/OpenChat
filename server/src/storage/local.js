import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";

// Stores each file as <dir>/<id> on the server's disk. Ids are checked by the
// caller (32 hex characters), so they can never point outside the folder.
const createLocalStorage = (dir) => ({
    save: async (id, bytes) => {
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, id), bytes, { flag: "wx" }); // never overwrite
    },
    read: (id) => readFile(path.join(dir, id)),
    remove: (id) => rm(path.join(dir, id), { force: true }),
});

export default createLocalStorage;
