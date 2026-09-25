import { defineConfig } from "vitest/config";

// Vitest scoping for TourBuilder: collect the colocated tests under
// src/components/ (each component's pure `core/` plus node-runnable view-layer
// tests, e.g. the proximity replay e2e), the shared contract in src/store/,
// and the Goal-2 composition layer in src/app/. Browser-only view layers are
// exercised manually via the demos (`pnpm dev`).
export default defineConfig({
  test: {
    include: [
      "src/components/**/*.test.ts",
      "src/store/**/*.test.ts",
      "src/app/**/*.test.ts",
    ],
    // Activates the gps-plus-slam-js community licence once per process, so
    // tests may call the library's licensed math directly (the app gets the
    // same activation for free via its store factory). See src/test-setup.ts.
    setupFiles: ["src/test-setup.ts"],
  },
});
