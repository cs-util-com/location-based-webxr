# `mulberry32.ts`

## Purpose

The workspace's one seeded generator for production code: mulberry32, a small
32-bit PRNG with uniform draws in [0, 1).

## Public API

- `mulberry32(seed: number): () => number` - a fresh generator; each call of
  the returned function advances its own state and returns the next draw.
  - The seed is read as an unsigned 32-bit integer (`seed >>> 0`): a
    fraction is truncated, a negative seed wraps (`-1` is `0xffffffff`), a
    non-finite one reads as `0`. Never throws.

## Invariants & assumptions

- **One in the workspace.** Production code imports this module (deep,
  never through the `utils` barrel); it used to exist twice here, inline in
  the live clouds' cover thresholds and as the ambient occlusion's noise
  generator. The globe package (`globe-stars.ts`, `globe-speed-dust.ts`) and the Tour Viewer (`asset-optimizer-check.ts`,
  `mesh-distance.ts`, `narration-look.ts`, `picture-paint.ts`) deep-import
  it as `gps-plus-slam-app-framework/utils/mulberry32` (a `tsdown` entry);
  their private copies drew the same sequence bit for bit, and each package
  pins its outputs in its `seeded-draws.test.ts`. In the design system the import
  map of the globe lab (`labs/globe/index.html`) maps the specifier, and `WORKER_IMPORTS` in `serve-routes.mjs` maps it for the
  cloud bake's module worker.
  `tests/repo-config/duplicate-helpers.test.js` holds the name to this one
  definition.
- **The sequence is a contract.** The ambient occlusion's denoise noise
  (`aoNoiseRandom` in `visualization/ambient-occlusion.ts`, which validates
  its seed and then delegates here) must equal the design system's look-dev
  copy draw for draw, since that page is where the look was chosen;
  `tests/repo-config/ambient-occlusion-copies.test.js` holds the two equal.
  `cloudLiveCoverThresholds` builds its quantile table from these draws, and
  `CLOUD_LIVE_COVER_THRESHOLDS` is that table precomputed.
- Validation is the caller's: this helper is total, so a caller that must
  refuse a non-integer seed (the ambient occlusion does) checks it first.
- `test-utils/elevation-offset-scenarios.ts` and
  `test-utils/integrated-slam-drift.ts` re-export this generator, and
  `test-utils/non-trivial-alignment.ts` imports it. Local copies remain in
  test code only: test files (`storage/autosave.property.test.ts`,
  `cloud-live-noise.test.ts`, `cloud-live-noise.sweep.test.ts`, the QR
  tracking demo's `qrperf/pipeline-timings.property.test.ts`, and several
  Tour Viewer tests under other names) and the Tour Viewer's test support
  (`characters/test-support/synthetic-sheet.ts` as `seeded`,
  `test-support/qr-hold-scenario.ts` as `gaussian`), plus the design system's `.js`
  look-dev copies (`3d/ambient-occlusion.js`, `labs/city-look/city-look-model.js`)
  and the Tour Viewer's throwaway prototypes, which import nothing from
  the framework. Production code never imports from `test-utils/`.

## Example

```ts
import { mulberry32 } from '../utils/mulberry32.js';

const next = mulberry32(1);
next(); // 0.6270739405881613
```

## Tests

- `mulberry32.test.ts`: the reference draws for seed 1, the seed read as an
  unsigned 32-bit integer, independent state per generator; a property test
  for determinism per seed and the [0, 1) range.
- `tests/repo-config/ambient-occlusion-copies.test.js`: this generator and
  the design system's copy draw the same sequence.
- `GpsPlusSlamJs_Globe/src/seeded-draws.test.ts` and
  `GpsPlusSlamJs_TourViewer/src/seeded-draws.test.ts`: the consumers'
  seeded outputs, pinned.
