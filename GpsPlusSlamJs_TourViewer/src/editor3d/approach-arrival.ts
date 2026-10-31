/**
 * The approach's arrival, pure: when the camera lands, the tour's
 * stations pop in one after another (each grows from nothing with a small
 * overshoot while a ring spreads once around it on the ground), and then,
 * only when the tour carries a recorded walk, the walk draws itself from
 * its first point to its last. Time since the landing in, a scale, a ring
 * and a drawn share out.
 *
 * The timings are the chosen prototype's (a 150 ms pause, 160 ms between
 * stations, 900 ms per pop, the ring from 450 ms over 1.2 s, the walk
 * 400 ms after the last pop over 1.4 s). Under `prefers-reduced-motion`
 * every station appears together in a short fade-free grow, with no ring
 * and a walk drawn in 300 ms.
 *
 * @see approach-arrival.ts.md
 */
import { backOut, easeOut } from "../landing/film-math.js";

export interface ArrivalTiming {
  readonly delayMs: number;
  readonly staggerMs: number;
  readonly popMs: number;
  /** The ring starts this long after its station's pop starts. */
  readonly ringDelayMs: number;
  /** 0: no ring. */
  readonly ringMs: number;
  /** The walk starts this long after the last pop starts. */
  readonly walkGapMs: number;
  readonly walkMs: number;
}

export const ARRIVAL: ArrivalTiming = Object.freeze({
  delayMs: 150,
  staggerMs: 160,
  popMs: 900,
  ringDelayMs: 450,
  ringMs: 1_200,
  walkGapMs: 400,
  walkMs: 1_400,
});

export const ARRIVAL_REDUCED: ArrivalTiming = Object.freeze({
  delayMs: 0,
  staggerMs: 0,
  popMs: 200,
  ringDelayMs: 0,
  ringMs: 0,
  walkGapMs: 0,
  walkMs: 300,
});

/** The ring's look: it spreads from `ringFrom` to `ringTo` times the
 *  station's radius, fading out. */
export const ARRIVAL_RING = Object.freeze({ ringFrom: 0.15, ringTo: 1.2 });

function share(elapsedMs: number, startMs: number, lengthMs: number): number {
  if (Number.isNaN(elapsedMs)) return 1;
  if (lengthMs <= 0) return elapsedMs >= startMs ? 1 : 0;
  return Math.min(1, Math.max(0, (elapsedMs - startMs) / lengthMs));
}

/** One station `elapsedMs` after the landing. */
export interface StationPop {
  /** Its scale: 0 before its pop, a small overshoot over 1 mid-pop, 1
   *  after. */
  readonly scale: number;
  /** Its ring's size (times the station's radius) and opacity, or null
   *  when no ring shows. */
  readonly ring: { readonly radius: number; readonly opacity: number } | null;
}

/**
 * The `index`th station (0 first) `elapsedMs` after the landing. A time
 * that is not a number reads as the end; an index that is not a whole
 * number >= 0 as 0.
 */
export function stationPop(
  elapsedMs: number,
  index: number,
  timing: ArrivalTiming = ARRIVAL,
): StationPop {
  const i = Number.isInteger(index) && index > 0 ? index : 0;
  const start = timing.delayMs + i * timing.staggerMs;
  const k = share(elapsedMs, start, timing.popMs);
  const scale = k >= 1 ? 1 : Math.max(0, backOut(k));
  let ring: StationPop["ring"] = null;
  if (timing.ringMs > 0) {
    const r = share(elapsedMs, start + timing.ringDelayMs, timing.ringMs);
    if (r > 0 && r < 1) {
      const e = easeOut(r);
      const { ringFrom, ringTo } = ARRIVAL_RING;
      ring = { radius: ringFrom + (ringTo - ringFrom) * e, opacity: 1 - e };
    }
  }
  return { scale, ring };
}

/** When the walk starts drawing, for `stations` stations (ms after the
 *  landing). */
export function walkStartMs(
  stations: number,
  timing: ArrivalTiming = ARRIVAL,
): number {
  const last = Math.max(
    0,
    Math.floor(Number.isFinite(stations) ? stations : 0) - 1,
  );
  return timing.delayMs + last * timing.staggerMs + timing.walkGapMs;
}

/** The share of the walk drawn `elapsedMs` after the landing (0 to 1,
 *  eased out). */
export function walkShare(
  elapsedMs: number,
  stations: number,
  timing: ArrivalTiming = ARRIVAL,
): number {
  return easeOut(
    share(elapsedMs, walkStartMs(stations, timing), timing.walkMs),
  );
}

/** Whether the arrival is over (every pop, ring and the walk). */
export function arrivalDone(
  elapsedMs: number,
  stations: number,
  timing: ArrivalTiming = ARRIVAL,
): boolean {
  const lastStart =
    timing.delayMs + Math.max(0, stations - 1) * timing.staggerMs;
  const end = Math.max(
    lastStart + timing.popMs,
    lastStart + timing.ringDelayMs + timing.ringMs,
    walkStartMs(stations, timing) + timing.walkMs,
  );
  return Number.isNaN(elapsedMs) || elapsedMs >= end;
}
