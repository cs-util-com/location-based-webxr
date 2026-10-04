/**
 * The sweep behind `PREFETCH_LEAD_M` (`station-prefetch.ts`; tour kit plan
 * K4 "prefetch on approach").
 *
 * A story is READY when its media were read before the visitor reaches
 * the found radius. The prefetch starts at the activation exit radius plus
 * the lead, so the visitor has `(activateExitM + lead - foundM) / speed`
 * seconds, against `latency + bytes x 8 / bandwidth` for the read. Swept:
 * the lead 20-100 m, walking speed 0.8-1.8 m/s, a story of 1-20 MB, a
 * bandwidth of 1-20 Mbit/s, 1 s latency, and the tightest station geometry
 * the bands allow at 3 m accuracy (activation exit 7.5 m, found 3 m) next
 * to a typical one (activation 30 m, exit 34 m, found 5 m).
 *
 * Verdict at 80 m: every story up to 5 MB is ready at every speed swept
 * even at 1 Mbit/s, and up to 20 MB from 5 Mbit/s; what is not ready is a
 * 20 MB story at 1 Mbit/s (it shows "Loading…", which is what it showed
 * before prefetch existed). What would reverse it: 60 m leaves a 5 MB story
 * at 1 Mbit/s not ready for a visitor at 1.8 m/s at the tightest station,
 * 40 m at 1.4 m/s, 20 m at a typical station too (asserted). The cost of a
 * larger lead is data for stations the visitor never reaches, bounded by the
 * byte budget.
 */

import { describe, expect, it } from "vitest";

import { MAX_DECODE_SIDE_PX, PREFETCH_LEAD_M } from "./station-prefetch";

const LEADS = [20, 40, 60, 80, 100];
const SPEEDS = [0.8, 1.4, 1.8];
const STORY_MB = [1, 5, 20];
const MBITS = [1, 5, 20];
const LATENCY_S = 1;
/** [activateExitM, foundM]: the tightest bands at 3 m accuracy, and a typical station. */
const GEOMETRIES: readonly [number, number][] = [
  [7.5, 3],
  [34, 5],
];

function ready(
  lead: number,
  speed: number,
  mb: number,
  mbit: number,
  [exit, found]: readonly [number, number],
): boolean {
  const walkS = (exit + lead - found) / speed;
  const readS = LATENCY_S + (mb * 8) / mbit;
  return walkS >= readS;
}

const CELLS = SPEEDS.flatMap((speed) =>
  STORY_MB.flatMap((mb) =>
    MBITS.flatMap((mbit) =>
      GEOMETRIES.map((geometry) => ({ speed, mb, mbit, geometry })),
    ),
  ),
);

describe("prefetch lead sweep (K4)", () => {
  it("at the shipped lead, every story up to 5 MB is ready even at 1 Mbit/s, and up to 20 MB from 5 Mbit/s", () => {
    expect(PREFETCH_LEAD_M).toBe(80);
    const notReady = CELLS.filter(
      (c) => !ready(PREFETCH_LEAD_M, c.speed, c.mb, c.mbit, c.geometry),
    );
    expect(notReady.every((c) => c.mb === 20 && c.mbit === 1)).toBe(true);
  });

  it("a shorter lead would reverse it for a 5 MB story at 1 Mbit/s", () => {
    expect(ready(60, 1.8, 5, 1, [7.5, 3])).toBe(false);
    expect(ready(40, 1.4, 5, 1, [7.5, 3])).toBe(false);
    expect(ready(20, 1.4, 5, 1, [34, 5])).toBe(false);
    expect(ready(PREFETCH_LEAD_M, 1.8, 5, 1, [7.5, 3])).toBe(true);
  });

  it("more lead never makes a story less ready (the table is monotone)", () => {
    for (const c of CELLS) {
      const byLead = LEADS.map((lead) =>
        ready(lead, c.speed, c.mb, c.mbit, c.geometry),
      );
      const firstReady = byLead.indexOf(true);
      expect(firstReady === -1 || byLead.slice(firstReady).every(Boolean)).toBe(
        true,
      );
    }
  });
});

/** Screen pixels a 1.7 m figure covers at distance d (60 degree vertical
 *  view, a 2400 px tall screen). */
function figurePx(d: number): number {
  return ((2 * Math.atan(0.85 / d)) / (Math.PI / 3)) * 2400;
}

describe("decode cap sweep (K4)", () => {
  it("2048 px covers what a phone shows of a figure from 2 m on; 1024 would not closer than about 3.7 m", () => {
    for (const d of [2, 3, 5, 10])
      expect(figurePx(d)).toBeLessThanOrEqual(MAX_DECODE_SIDE_PX);
    expect(figurePx(1.5)).toBeGreaterThan(MAX_DECODE_SIDE_PX);
    expect(figurePx(3.6)).toBeGreaterThan(1024);
    expect(figurePx(3.8)).toBeLessThan(1024);
  });
});
