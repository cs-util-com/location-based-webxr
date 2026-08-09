import { defineConfig } from "vitest/config";

/**
 * Benchmark-only project, mirroring `GpsPlusSlamJs_Osm/config/vitest.bench.config.ts`.
 *
 * Kept separate from `vitest.config.ts` so the gate's `test:unit` stage never
 * pays for benchmark runs — that file's `include` is `src/**\/*.test.ts`, so a
 * `.bench.ts` is invisible to it and this config is what makes one runnable.
 *
 * `environment: "node"` and not jsdom, deliberately. What these benches measure
 * is CPU-side geometry construction — typed arrays in, `BufferGeometry` out —
 * and three's geometry and material classes are plain JS that construct fine
 * without a DOM, which `mesh-layers.ts` already relies on for its unit tests.
 * Anything that genuinely needs a GPU or a compositor is NOT measurable here and
 * is parked for a real-browser trace instead of being faked.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.bench.ts"],
  },
});
