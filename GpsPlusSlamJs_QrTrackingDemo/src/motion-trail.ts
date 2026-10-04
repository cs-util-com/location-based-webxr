/**
 * The demo's motion trail (QR near-frontal pose plan §26): the active
 * code's positions over the last ~2 s, so a hand-held code's path can be
 * seen next to its motion mode. Pure; `motion-trail-view.ts` draws it.
 * See motion-trail.ts.md.
 */

export type TrailPoint = [number, number, number];

export interface MotionTrail {
  /** One detection's position at `timestampMs` (any monotonic ms clock). */
  add(timestampMs: number, position: readonly number[]): void;
  /** The kept positions, oldest first (copies). */
  points(): TrailPoint[];
  /** Forget everything (a restart, another code). */
  clear(): void;
}

export function createMotionTrail(
  options: { spanMs?: number } = {},
): MotionTrail {
  const spanMs =
    typeof options.spanMs === "number" && options.spanMs > 0
      ? options.spanMs
      : 2000;
  let kept: { t: number; p: TrailPoint }[] = [];
  return {
    add(timestampMs, position) {
      const p = [position[0], position[1], position[2]];
      if (!Number.isFinite(timestampMs) || !p.every(Number.isFinite)) return;
      const newest = kept[kept.length - 1];
      // A clock going backwards is a new run: never join it to the old one.
      if (newest && timestampMs < newest.t) kept = [];
      kept.push({ t: timestampMs, p: p as TrailPoint });
      kept = kept.filter((k) => k.t >= timestampMs - spanMs);
    },
    points() {
      return kept.map((k) => [...k.p] as TrailPoint);
    },
    clear() {
      kept = [];
    },
  };
}
