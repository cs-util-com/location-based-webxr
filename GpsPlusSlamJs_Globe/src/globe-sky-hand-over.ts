/**
 * The sky hand-over's arithmetic (globe F2 plan 2026-10-03-1922, F2b): the
 * numbers the descent from space to the ground swaps the space pass's sky
 * for the framework's ground sky with. Pure functions, no imports beyond
 * the ease, so the lab and its tests read the same values.
 *
 * - `shellThicknessAt`: the space halo's thickness on the way down, 6x far
 *   out and 1x below the ramp (DEC-GL5-13), eased in log altitude.
 * - `groundSkyWeight`: the cross-fade below the edge, 0 above it, 1 a
 *   width below it.
 * - `quantisedObserverKm`: the ground sky's observer in log steps, under
 *   the atmosphere's top, so it is rebuilt per step and not per frame.
 * - `easedExposure`: the exposure from the space view's to the ground
 *   sky's, eased in its logarithm by the weight (DEC-GL5-16).
 * - `sunStepped`: whether the sun moved by a step since the last rebuild.
 *
 * @see globe-sky-hand-over.ts.md
 */
import { smoothstep } from "./globe-ease.js";

export const GLOBE_SKY_HAND_OVER = {
  /** The halo's ramp: its far thickness above this altitude, km. */
  shellFromKm: 2_000,
  /** The halo's ramp: 1x below this altitude, km. */
  shellToKm: 300,
  /** The ground sky's edge: no ground sky at or above it, km. */
  edgeKm: 80,
  /** The cross-fade's width below the edge, km. */
  widthKm: 20,
  /**
   * The ground sky's highest observer, km: the framework's atmosphere is
   * 100 km thick and refuses its top.
   */
  observerCeilingKm: 99.9,
  /** Below this height (km) the observer is on the ground (0). */
  observerFloorKm: 0.01,
  /** The observer's log step, percent. */
  altitudeStepPct: 5,
  /** The sun's step, degrees. */
  sunStepDeg: 0.25,
};

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite, got ${value}`);
  }
}

/**
 * The halo's thickness at `altitudeKm`: `thickness` at and above `fromKm`,
 * 1 at and below `toKm`, eased (smoothstep, so no kink at either end) in
 * the logarithm of the altitude between. RangeError for a non-finite
 * altitude, a thickness below 1, or edges not 0 < toKm < fromKm.
 */
export function shellThicknessAt(
  altitudeKm: number,
  thickness: number,
  {
    fromKm = GLOBE_SKY_HAND_OVER.shellFromKm,
    toKm = GLOBE_SKY_HAND_OVER.shellToKm,
  }: { fromKm?: number; toKm?: number } = {},
): number {
  finite("altitudeKm", altitudeKm);
  finite("thickness", thickness);
  if (thickness < 1) {
    throw new RangeError(`thickness must be at least 1, got ${thickness}`);
  }
  if (!(toKm > 0 && fromKm > toKm && Number.isFinite(fromKm))) {
    throw new RangeError(
      `the ramp needs 0 < toKm < fromKm, got ${toKm}, ${fromKm}`,
    );
  }
  if (altitudeKm >= fromKm) return thickness;
  if (altitudeKm <= toKm) return 1;
  const share =
    (Math.log(altitudeKm) - Math.log(toKm)) /
    (Math.log(fromKm) - Math.log(toKm));
  return 1 + (thickness - 1) * smoothstep(share);
}

/**
 * The ground sky's share of the sky at `altitudeKm`: 0 at and above
 * `edgeKm`, 1 at and below `edgeKm - widthKm`, smoothstep between.
 * RangeError for a non-finite altitude, an edge outside (0, 100) km, or a
 * width that is not positive or reaches below the ground.
 */
export function groundSkyWeight(
  altitudeKm: number,
  {
    edgeKm = GLOBE_SKY_HAND_OVER.edgeKm,
    widthKm = GLOBE_SKY_HAND_OVER.widthKm,
  }: { edgeKm?: number; widthKm?: number } = {},
): number {
  finite("altitudeKm", altitudeKm);
  if (!(edgeKm > 0 && edgeKm < 100)) {
    throw new RangeError(`edgeKm must be in (0, 100), got ${edgeKm}`);
  }
  if (!(widthKm > 0 && widthKm <= edgeKm)) {
    throw new RangeError(
      `widthKm must be in (0, edgeKm = ${edgeKm}], got ${widthKm}`,
    );
  }
  return smoothstep((edgeKm - altitudeKm) / widthKm);
}

/**
 * The ground sky's observer for `altitudeKm`: the nearest power of
 * (1 + stepPct / 100), held at most at the ceiling, and 0 below the floor
 * (on the ground). Idempotent, so an unchanged step rebuilds nothing.
 * RangeError for a negative or non-finite altitude or a step not positive.
 */
export function quantisedObserverKm(
  altitudeKm: number,
  stepPct: number = GLOBE_SKY_HAND_OVER.altitudeStepPct,
): number {
  finite("altitudeKm", altitudeKm);
  if (altitudeKm < 0) {
    throw new RangeError(`altitudeKm must not be negative, got ${altitudeKm}`);
  }
  if (!(stepPct > 0 && Number.isFinite(stepPct))) {
    throw new RangeError(`stepPct must be positive, got ${stepPct}`);
  }
  const { observerCeilingKm, observerFloorKm } = GLOBE_SKY_HAND_OVER;
  if (altitudeKm >= observerCeilingKm) return observerCeilingKm;
  if (altitudeKm < observerFloorKm) return 0;
  const step = Math.log(1 + stepPct / 100);
  const q = Math.exp(Math.round(Math.log(altitudeKm) / step) * step);
  // A height just above the floor can round to a step below it: on the
  // ground too, so a second quantisation changes nothing.
  return q < observerFloorKm ? 0 : Math.min(q, observerCeilingKm);
}

/**
 * The exposure between the space view's `spaceExposure` (weight 0) and the
 * ground sky's `groundExposure` (weight 1), linear in its logarithm, so
 * equal steps of the weight are equal steps in EV. The weight is clamped
 * into [0, 1]. RangeError for an exposure that is not positive and finite,
 * or a non-finite weight.
 */
export function easedExposure(
  spaceExposure: number,
  groundExposure: number,
  weight: number,
): number {
  for (const [name, value] of [
    ["spaceExposure", spaceExposure],
    ["groundExposure", groundExposure],
  ] as const) {
    if (!(value > 0 && Number.isFinite(value))) {
      throw new RangeError(`${name} must be positive and finite, got ${value}`);
    }
  }
  finite("weight", weight);
  const w = Math.min(Math.max(weight, 0), 1);
  if (w === 0) return spaceExposure;
  return Math.exp(
    Math.log(spaceExposure) +
      (Math.log(groundExposure) - Math.log(spaceExposure)) * w,
  );
}

/**
 * Whether the sun moved by at least `stepDeg` from `previous` (null: never
 * set) to `next`, both directions of any length. RangeError for a
 * non-finite or zero direction or a step not positive.
 */
export function sunStepped(
  previous: readonly [number, number, number] | null,
  next: readonly [number, number, number],
  stepDeg: number = GLOBE_SKY_HAND_OVER.sunStepDeg,
): boolean {
  if (!(stepDeg > 0 && Number.isFinite(stepDeg))) {
    throw new RangeError(`stepDeg must be positive, got ${stepDeg}`);
  }
  const length = (v: readonly number[]) => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!);
    if (!(l > 0 && Number.isFinite(l))) {
      throw new RangeError(`a sun direction must be finite and non-zero`);
    }
    return l;
  };
  const ln = length(next);
  if (previous === null) return true;
  const lp = length(previous);
  const cos =
    (previous[0] * next[0] + previous[1] * next[1] + previous[2] * next[2]) /
    (lp * ln);
  return Math.acos(Math.min(1, Math.max(-1, cos))) >= (stepDeg * Math.PI) / 180;
}
