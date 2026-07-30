# `terrain-note.ts`

## Purpose

Builds the one status-line phrase that says whether the terrain loaded:
`terrain ±N m`, or `terrain unavailable — ground is flat`.

## Public API

- `describeTerrain(field: TerrainRelief): string` — never empty. Appends
  `(M/T samples missing)` only when `missing > 0`.
- `TerrainRelief` — the four fields it reads (`hasData`, `missing`, `total`,
  `reliefM`), so callers can pass a `HeightfieldData` or anything shaped like one.

## Invariants & assumptions

- **This phrase is the only signal separating "flat" from "not loaded".** Both
  render as a flat plane and look identical on screen. DEC-R2-1 made that worse in
  a deliberate way: normal-based shading on sub-1° slopes shows nothing, and that
  is now the accepted correct outcome, so nothing else distinguishes the two.
  **It must not be dropped by the collapsible header (DEC-R2-4).**
- **It lives in its own module because it was briefly duplicated** — once in the
  worker that computes the field, once in a test that fakes the worker — and
  `check:dup` caught it. Two copies that drift give two different answers to the
  one question the number exists to settle.
- **It cannot live in `demo-worker.ts`.** That module calls
  `self.addEventListener` at import time, so anything importing it from a test
  would wire a worker handler onto the main thread.
- The missing-post count is surfaced because `buildHeightfieldData` fills gaps with
  the mean of what arrived — a deliberate choice that would otherwise be invisible.

## Examples

```ts
describeTerrain({ hasData: true, missing: 0, total: 2601, reliefM: 12.4 });
// "terrain ±12 m"
describeTerrain({ hasData: false, missing: 2601, total: 2601, reliefM: 0 });
// "terrain unavailable — ground is flat"
```

## Tests

Exercised through `terrain-cycle.test.ts`, which asserts the exact wording of both
branches and the missing-samples suffix — so a drift between the worker's use and
the test's fake fails rather than passing silently.
