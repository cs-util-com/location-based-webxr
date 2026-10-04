import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
