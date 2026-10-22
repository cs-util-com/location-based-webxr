import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The shared fast-check time limit (every interruption is red), so a
    // failing property cannot shrink for hours where testTimeout cannot reach:
    // scripts/test-timing/fast-check-time-limit.mjs.md.
    setupFiles: [
      fileURLToPath(
        new URL(
          "../../scripts/test-timing/fast-check-time-limit.mjs",
          import.meta.url,
        ),
      ),
    ],
    globals: true,
    // The globe's logic is tested under Node; its browser check is the
    // design system's globe lab smoke (plan 2026-09-26-0539 §7.1).
    environment: "node",
    include: ["src/**/*.test.ts"],
    silent: true,
    // A deadlock guard, not a performance gate (the Osm package's reasoning:
    // a loaded machine blows 5 s on ordinary tests).
    testTimeout: 30_000,
  },
});
