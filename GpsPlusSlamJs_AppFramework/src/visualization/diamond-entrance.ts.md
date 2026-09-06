# `diamond-entrance.ts`

- Purpose: the diamond marker's build-up as a pure function of elapsed time,
  mirroring the design system's world-annotation entrance (`.diamond` in
  `GpsPlusSlamJs_DesignSystem/design.css`: the outline draws over 800 ms,
  the accent dot pops from 600 to 850 ms, reduced motion is complete at
  once). It is THE seam between the HUD's clock and whatever draws the
  marker - `(elapsedMs) → state`, never draw calls - so the canvas drawer,
  a baked frame behind a progress shader or a sprite sheet can present the
  same timeline. Plan:
  [2026-09-05-2138 HUD diamond entrance animation](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-05-2138-hud-diamond-entrance-animation-plan.md)
  (DEC-E1, §2, M1).
- Public API:
  - `DIAMOND_ENTRANCE` - frozen `{ outlineMs: 800, dotDelayMs: 600, dotMs:
250, totalMs: 850, dashLength: 180 }`, the CSS tokens `--t-enter × 2`,
    `--t-enter × 1.5`, `--t-state`, their sum, and `stroke-dasharray`.
  - `computeDiamondEntrance(elapsedMs, { reducedMotion? }) →
DiamondEntranceState` - `outline` and `dot` in [0, 1] on the
    `--ease-out` curve (`utils/cubic-bezier-easing`), `settled` once t ≥ 850
    ms. Negative time reads as 0 (a staggered spawn not yet started);
    `reducedMotion: true` returns `DIAMOND_ENTRANCE_SETTLED` at any time;
    throws `RangeError` on a non-finite time.
  - `DIAMOND_ENTRANCE_SETTLED` - the frozen complete state `{ 1, 1, true }`,
    returned by identity from 850 ms on so a drawer can compare by
    reference.
  - Types `DiamondEntranceState`, `DiamondEntranceOptions`.
- Invariants & assumptions:
  - `outline`, `dot` and `settled` are monotone non-decreasing in time;
    `dot ≤ outline` always; `settled` implies both fractions are exactly 1.
  - The dash length stays 180 against a ≈ 169.1 perimeter ON PURPOSE: the
    outline reads as closed at outline ≥ 0.94, which the ease-out reaches
    at ~545 ms, just before the dot pops - the CSS's choreography. Setting
    the dash to the true perimeter would close the outline at 800 ms.
  - No three, no canvas, no DOM: usable from a worker or a test as-is.
  - Re-exported from `visualization/index.ts` (public seam; also what keeps
    knip's `exports: error` satisfied, since the drift guard reads this file
    as text).
- Example:

  ```ts
  const s = computeDiamondEntrance(400); // { outline: 0.839, dot: 0, settled: false }
  ctx.lineDashOffset = DIAMOND_ENTRANCE.dashLength * (1 - s.outline);
  ```

- Tests: `diamond-entrance.test.ts` (the constants, t = 0 and negative,
  the 400 ms midpoint, the dot's 600 ms threshold, 850 ms settled by
  identity, reduced motion, the non-finite throw);
  `diamond-entrance.property.test.ts` (fast-check: monotone in time, in
  [0, 1], dot never leads the outline, settled implies complete, reduced
  motion time-independent).
