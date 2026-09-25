// Starts Vitest (used by the client and server "test" scripts).
//
// Why not call `vitest` directly: on Windows, when Vitest is started from a
// path with a lowercase drive letter ("c:\..." — how VS Code often opens a
// folder), it loads itself twice and every test file fails with "Vitest
// failed to find the runner". Starting it from the same path with an
// uppercase drive letter avoids that. On macOS/Linux this changes nothing.
import { createRequire } from "module";
import { dirname, join } from "path";
import { pathToFileURL } from "url";

const require = createRequire(import.meta.url);
const vitestDir = dirname(require.resolve("vitest/package.json"));
const vitestBin = join(vitestDir, "vitest.mjs").replace(/^[a-z]:/, (drive) => drive.toUpperCase());

await import(pathToFileURL(vitestBin).href);
