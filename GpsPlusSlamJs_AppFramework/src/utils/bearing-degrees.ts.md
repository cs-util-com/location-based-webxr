# `bearing-degrees.ts`

## Purpose

The framework's **one** bearing normalizer.

## Public API

- `normalizeBearingDeg(deg: number): number` — wraps a bearing in degrees into
  `[0, 360)`. **Exactly idempotent**: input already in range is returned
  unchanged. `NaN` propagates.

- `bearingDeltaDeg(a: number, b: number): number` — signed shortest difference
  `a − b` in `(−180, 180]`; exactly opposite bearings give `+180`. Built on
  `normalizeBearingDeg`, so it inherits the contract below. Added 2026-09-04
  in place of two unnamed copies (the recorder's `yaw-churn.ts`, the
  framework's `lerp-utils.ts`) that disagreed at the boundary.

## Invariants & assumptions

- **The early return is a correctness contract, not an optimisation.** Without
  it, `360 − ε` re-enters the double-mod, `(360 − ε) + 360` rounds to exactly
  `720`, and the result snaps to `0` — a full turn that never happened. The
  core library found this with fast-check (counterexample `−2.842e−14`) and
  fixed it 2026-07-20; this package never received the lesson.
- **The bare form also perturbs in-range values**, because `x + 360` is not
  exactly representable for most `x`: `0.1` round-trips to
  `0.10000000000002274`. That is the silent half, invisible to any range
  assertion — and a range assertion is exactly what the six former call sites
  had.
- **`NaN` propagates deliberately.** Callers that must not leak one guard
  before calling (`user-heading.ts` returns `null` for a degenerate basis
  first). Substituting a bearing for `NaN` here would invent a heading.
- Pure, dependency-free.

## Why it exists as a module

`((deg % 360) + 360) % 360` was written **six times** in this package, never
named:

- `ar/qr/qr-geo-pose-minting.ts`
- `ar/qr/qr-level.ts`
- `utils/qr-payload/codec-binary-anchor.ts`
- `utils/user-heading.ts`
- `visualization/heading-up-rotation.ts`
- `visualization/lerp-utils.ts`

**No guard in this repo could see any of them.**
`tests/repo-config/duplicate-helpers.test.js` matches declarations, and an
expression nobody named has none; `check:dup` runs jscpd at a 50-token floor
and this is nine tokens. It was found by grepping for the **expression**, from
a probe that started at a test named `always returns a value in [0, 360)`
whose body checked three hardcoded vectors.

`normalizeBearingDeg` is now a `shared` entry in that guard, so a seventh
**named** copy fails. An unnamed one still would not — that limit is real and
is why the expression grep is worth repeating.

## Not imported from the core library — a parked decision

The library has this function, corrected and property-tested, but exports only
its sibling `bearingDeltaDeg` publicly. Using it would mean growing the
library's public API while the API-narrowing pass (DEC-N7) is parked, and
would couple a framework release to a library release. Recorded as a parked
question in `GpsPlusSlamJs_Docs/docs/simplify-loop-state.md`; the local copy is
the reversible default, not a verdict.

## Examples

```ts
import { normalizeBearingDeg } from '../utils/bearing-degrees.js';

normalizeBearingDeg(-90); // 270
normalizeBearingDeg(0.1); // 0.1 exactly — the bare form gives 0.10000000000002274
```

## Tests

`bearing-degrees.test.ts` — wrapping, exact idempotence on in-range input, the
`360 − ε` counterexample pinned **against the bare form as a differential
oracle** (so the test states what the six copies did wrong, not just what this
does right), a fast-check range+idempotence property, and `NaN` propagation.
