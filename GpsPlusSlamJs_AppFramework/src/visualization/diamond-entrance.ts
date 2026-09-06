/**
 * The diamond marker's entrance, as a pure function of elapsed time.
 *
 * Mirrors the design system's world-annotation build-up (`.diamond` in
 * `GpsPlusSlamJs_DesignSystem/design.css`): the outline draws itself around
 * over `--t-enter × 2` = 800 ms with `--ease-out`, then the centre dot pops
 * over `--t-state` = 250 ms after a `--t-enter × 1.5` = 600 ms delay — so
 * the whole entrance settles at 850 ms. Reduced motion shows the complete
 * marker at once, as the sheet's `prefers-reduced-motion` block does.
 *
 * This is THE seam between the HUD's clock and whatever draws the marker:
 * `(elapsedMs) → state`, never `(elapsedMs) → draw calls`, so a canvas
 * (today), a baked frame behind a progress shader or a sprite sheet can
 * present the same timeline. No three, no canvas, no DOM here. Plan:
 * `GpsPlusSlamJs_Docs/docs/2026-09-05-2138-hud-diamond-entrance-animation-plan.md`
 * (DEC-E1, §2).
 *
 * The dash length is 180 while the rotated 44 × 44, rx 4 outline measures
 * ≈ 169.1 — the CSS's own numbers. The outline therefore reads as CLOSED
 * once 180·(1 − outline) ≤ 10.9, i.e. outline ≥ 0.94, which the ease-out
 * reaches at ~545 ms: just before the dot pops. That is the design's feel;
 * "correcting" the dash to the true perimeter would make the outline close
 * at 800 ms instead and change the choreography.
 *
 * @see diamond-entrance.ts.md
 */
import { clamp01 } from '../utils/clamp01.js';
import { EASE_OUT } from '../utils/cubic-bezier-easing.js';

/** The CSS timeline, in milliseconds, plus the stroke dash length. */
export const DIAMOND_ENTRANCE = Object.freeze({
  /** `draw-line` runs `calc(var(--t-enter) * 2)`. */
  outlineMs: 800,
  /** `dot-pop` is delayed `calc(var(--t-enter) * 1.5)`. */
  dotDelayMs: 600,
  /** `dot-pop` runs `var(--t-state)`. */
  dotMs: 250,
  /**
   * When BOTH tracks are over: `max(outlineMs, dotDelayMs + dotMs)`. Today
   * the dot's end (850) is the later one; a sheet with `--t-enter > 2 ×
   * --t-state` would make the outline the later track, and the repo-config
   * guard holds this literal to the max of the two (PR #422 review).
   */
  totalMs: 850,
  /** `stroke-dasharray: 180`; the offset animates from 180 to 0. */
  dashLength: 180,
});

export interface DiamondEntranceState {
  /** 0..1, the drawn share of the outline; the drawer's dash offset is `dashLength · (1 − outline)`. */
  readonly outline: number;
  /** 0..1, the centre dot's scale AND opacity (both follow the same curve). */
  readonly dot: number;
  /** True once nothing will change any more: t ≥ `totalMs`, or reduced motion. */
  readonly settled: boolean;
}

export interface DiamondEntranceOptions {
  /** Show the complete marker at any time (the CSS's `animation: none`). */
  readonly reducedMotion?: boolean;
}

/** The complete marker — the state from 850 ms on, and under reduced motion. */
export const DIAMOND_ENTRANCE_SETTLED: DiamondEntranceState = Object.freeze({
  outline: 1,
  dot: 1,
  settled: true,
});

/**
 * The marker's state `elapsedMs` after its entrance began.
 *
 * - Negative times (a staggered spawn that has not started) read as 0.
 * - `reducedMotion: true` returns `DIAMOND_ENTRANCE_SETTLED` for any time.
 * - Throws `RangeError` on a non-finite time: a broken clock must not read
 *   as either "start" or "settled".
 */
export function computeDiamondEntrance(
  elapsedMs: number,
  options: DiamondEntranceOptions = {}
): DiamondEntranceState {
  if (options.reducedMotion === true) return DIAMOND_ENTRANCE_SETTLED;
  if (!Number.isFinite(elapsedMs)) {
    throw new RangeError(
      `computeDiamondEntrance: elapsedMs must be finite, got ${elapsedMs}`
    );
  }
  if (elapsedMs >= DIAMOND_ENTRANCE.totalMs) return DIAMOND_ENTRANCE_SETTLED;
  const outline = EASE_OUT(clamp01(elapsedMs / DIAMOND_ENTRANCE.outlineMs));
  const dot = EASE_OUT(
    clamp01((elapsedMs - DIAMOND_ENTRANCE.dotDelayMs) / DIAMOND_ENTRANCE.dotMs)
  );
  return { outline, dot, settled: false };
}
