import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        setupFiles: ["./tests/setup.js"],
        // All test files share one test database, so run them one at a time.
        fileParallelism: false,
    },
});
