# `clamp01.ts`

## Purpose

The landing page's one `clamp01`: clamps a number into `[0, 1]`.

## Public API

- `clamp01(value: number): number` — total, never throws.
  - In range → unchanged. Below `0` → `0`. Above `1` → `1`.
  - **Non-finite (`NaN`, `±Infinity`) → `0`.**

## Invariants & assumptions

- **The non-finite rule is a behaviour change, and a deliberate one.** The two
  copies this replaces (`scroll-color.ts`, `scroll-story.ts`) were
  `v < 0 ? 0 : v > 1 ? 1 : v`, which lets `NaN` through. Both callers divide by
  a pixel span read from the layout — a collapsed or not-yet-measured section
  makes that span `0`, so `NaN`/`±Infinity` is reachable, and it used to land in
  a colour interpolation and a scroll-progress value. `0` is the readable
  failure.
- **A deliberate copy of the framework's `utils/clamp01.ts`**, same contract.
  This package does not depend on `gps-plus-slam-app-framework` (its
  dependencies are three, animejs, postprocessing and uqr) and will not gain
  that dependency to share four lines. Owner decision DEC-H3, 2026-08-24: shared
  behaviour is unified across packages; pure one-liners live once per package.
- **Domain-named clamps stay where they are.** `clampDpr` (`capability.ts`) and
  `clampRad` (`scene/gyro-parallax.ts`) are not this function under another
  name — they carry a range that belongs to their subject.

## Example

```ts
import { clamp01 } from "./clamp01";

const progress = clamp01((centerLine - section.top) / section.height);
```

## Tests

`clamp01.test.ts` — the in-range identity, both bounds, and all three
non-finite inputs.

`clamp01.property.test.ts` — over arbitrary doubles: the result is always a
finite value in `[0, 1]`, and the function is idempotent.
