# `clamp01.ts`

## Purpose

The one `clamp01` in this package: clamps a number into `[0, 1]`.

## Public API

- `clamp01(value: number): number` — total, never throws.
  - In range → unchanged. Below `0` → `0`. Above `1` → `1`.
  - **Non-finite (`NaN`, `±Infinity`) → `0`.**

## Invariants & assumptions

- **The non-finite rule is the point of the module, not an implementation
  detail.** Until 2026-08-24 this package held three copies under one name, and
  they disagreed exactly there:
  - `state/onboarding-guidance.ts` guarded `Number.isNaN`, so `Infinity`
    clamped to `1`;
  - `state/tracking-quality.ts` guarded `Number.isFinite`, so `Infinity`
    collapsed to `0`;
  - `test-utils/elevation-offset-scenarios.ts` was
    `Math.min(1, Math.max(0, x))`, so `NaN` passed straight through.
  - The surviving contract is the strictest of the three. Everything clamped
    here is a **score or a confidence**, and the safe reading of garbage for
    those is "no confidence" — not "full confidence", and certainly not a `NaN`
    that spreads into whatever consumes it.
- **What changed for callers**, stated so it is not discovered later: nothing on
  any reachable path. `onboarding-guidance` receives values that
  `tracking-quality` has already clamped, so its inputs are finite by
  construction; `elevation-offset-scenarios` only reaches a non-finite value if
  its Box–Muller draw hits `rng() === 0` exactly, which a seeded PRNG does not
  do in practice. Where they DO differ, the new answer is the conservative one.
- **Not exported from the package.** It is an internal one-liner, kept once per
  package by owner decision (DEC-H3, 2026-08-24): shared _behaviour_ is
  unified across packages, pure one-liners are not — they may exist once in
  each package that needs them. `GpsPlusSlamJs_Landing` has its own copy for
  that reason.

## Example

```ts
import { clamp01 } from '../utils/clamp01.js';

const confidence = clamp01(rawScore); // 0 for NaN/±Infinity
```

## Tests

`clamp01.test.ts` — the in-range identity, both bounds, and all three non-finite
inputs asserted individually.

`clamp01.property.test.ts` — over arbitrary doubles: the result is always a
finite value in `[0, 1]`, the function is idempotent, and it preserves order
(so clamping cannot swap two scores around).

## Related

- `GpsPlusSlamJs_Landing/src/clamp01.ts` — the sibling copy, same contract.
- Domain-named clamps (`clampDpr`, `clampRad`, `clampPercent`) are deliberately
  NOT folded in here: they carry a domain rule that would move to the call site
  and be forgotten.
