import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Without this file vitest resolves the WORKSPACE-ROOT vitest.config.js
// (config discovery walks up), whose include covers only tests/** — and
// "No test files found" exits red. Node environment on purpose: the worker
// runs server-side and must never depend on DOM globals.
export default defineConfig({
  test: {
    // The shared fast-check time limit (every interruption is red), so a
    // failing property cannot shrink for hours where testTimeout cannot reach:
    // scripts/test-timing/fast-check-time-limit.mjs.md.
    setupFiles: [
      fileURLToPath(
        new URL("../scripts/test-timing/fast-check-time-limit.mjs", import.meta.url)
      ),
    ],
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
