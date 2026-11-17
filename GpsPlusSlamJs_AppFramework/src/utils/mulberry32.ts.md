# `mulberry32.ts`

## Purpose

The package's one seeded generator for production code: mulberry32, a small
32-bit PRNG with uniform draws in [0, 1).

## Public API

- `mulberry32(seed: number): () => number` - a fresh generator; each call of
  the returned function advances its own state and returns the next draw.
  - The seed is read as an unsigned 32-bit integer (`seed >>> 0`): a
    fraction is truncated, a negative seed wraps (`-1` is `0xffffffff`), a
    non-finite one reads as `0`. Never throws.

## Invariants & assumptions

- **One per package.** A pure helper this size may exist once per package,
  not once per file. Production code imports this module (deep, never
  through the `utils` barrel); it used to exist twice, inline in the live
  clouds' cover thresholds and as the ambient occlusion's noise generator.
- **The sequence is a contract.** The ambient occlusion's denoise noise
  (`aoNoiseRandom` in `visualization/ambient-occlusion.ts`, which validates
  its seed and then delegates here) must equal the design system's look-dev
  copy draw for draw, since that page is where the look was chosen;
  `tests/repo-config/ambient-occlusion-copies.test.js` holds the two equal.
  `cloudLiveCoverThresholds` builds its quantile table from these draws, and
  `CLOUD_LIVE_COVER_THRESHOLDS` is that table precomputed.
- Validation is the caller's: this helper is total, so a caller that must
  refuse a non-integer seed (the ambient occlusion does) checks it first.
- `test-utils/elevation-offset-scenarios.ts` keeps its own copy for the
  test scenarios; production code never imports from `test-utils/`.

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
