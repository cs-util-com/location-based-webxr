/**
 * The sweep behind the skip suggestion's clock (`station-run.ts`,
 * `skipSuggestAfterMs`; tour kit plan §8 D5: "a labelled skip, as the scan
 * gate's escape").
 *
 * The suggestion must not nag a visitor who is on the way: it should appear
 * only once the visitor has had the time a slow walker needs. Swept:
 * straight-line distance at the offer 10-500 m, walking speed 0.6-1.6 m/s,
 * a street detour of 1.0-1.8x the straight line, and 0-90 s to read the line
 * and set off. A visitor "is nagged" when the suggestion appears before they
 * arrive.
 *
 * Verdict at the shipped clock (2 minutes plus 1 s per 0.5 m):
 * - nobody walking at 0.8 m/s or faster on a detour up to 1.5x is nagged,
 *   at any distance or set-off time swept;
 * - the visitors who are nagged walk at 0.6 m/s on a detour of 1.5x or
 *   more, or at 0.8 m/s on a 1.8x detour (asserted below, so a change of
 *   the clock shows up here).
 * What would reverse it: a slow speed of 0.7 m/s nags strollers on 1.5x
 * detours beyond about 270 m (asserted), and a fixed clock of any one value
 * nags either the short walks or leaves the long ones waiting: 5 minutes is
 * reached before a 0.8 m/s visitor arrives at 250 m.
 * The skip button itself is there from the start (on demand), so a
 * suggestion that comes late costs a visitor nothing they could not do.
 */

import { describe, expect, it } from "vitest";

import {
  SKIP_SUGGEST_BASE_MS,
  SKIP_SUGGEST_SLOW_MPS,
  skipSuggestAfterMs,
} from "./station-run";

const DISTANCES = [10, 25, 50, 100, 200, 300, 500];
const SPEEDS = [0.6, 0.8, 1.0, 1.2, 1.6];
const DETOURS = [1.0, 1.2, 1.5, 1.8];
const SET_OFF_S = [0, 30, 60, 90];

/** Seconds a visitor needs to arrive. */
function arrivalS(
  d: number,
  speed: number,
  detour: number,
  setOff: number,
): number {
  return setOff + (d * detour) / speed;
}

function nagged(
  clock: (d: number) => number,
  d: number,
  speed: number,
  detour: number,
  setOff: number,
): boolean {
  return clock(d) / 1000 < arrivalS(d, speed, detour, setOff);
}

/** Every swept visitor: distance, speed, detour and set-off time. */
const CELLS = DISTANCES.flatMap((d) =>
  SPEEDS.flatMap((speed) =>
    DETOURS.flatMap((detour) =>
      SET_OFF_S.map((setOff) => ({ d, speed, detour, setOff })),
    ),
  ),
);

describe("skip suggestion clock sweep (K4, §8 D5)", () => {
  it("never nags a visitor at 0.8 m/s or faster on a detour up to 1.5x", () => {
    const quick = CELLS.filter((c) => c.speed >= 0.8 && c.detour <= 1.5);
    const naggedQuick = quick.filter((c) =>
      nagged(skipSuggestAfterMs, c.d, c.speed, c.detour, c.setOff),
    );
    expect(quick.length).toBeGreaterThan(0);
    expect(naggedQuick).toEqual([]);
  });

  it("nags only the slowest cells: 0.6 m/s on a 1.5x detour or more, or 0.8 m/s on a 1.8x detour", () => {
    const naggedCells = new Set(
      CELLS.filter((c) =>
        nagged(skipSuggestAfterMs, c.d, c.speed, c.detour, c.setOff),
      ).map((c) => `${String(c.speed)}/${String(c.detour)}`),
    );
    expect([...naggedCells].sort()).toEqual(["0.6/1.5", "0.6/1.8", "0.8/1.8"]);
  });

  it("would be reversed by a slow speed of 0.7 m/s, or by any fixed clock", () => {
    const at07 = (d: number) => SKIP_SUGGEST_BASE_MS + (d / 0.7) * 1000;
    expect(nagged(at07, 300, 0.8, 1.5, 0)).toBe(true);
    const fixed5min = () => 300_000;
    expect(nagged(fixed5min, 250, 0.8, 1.0, 0)).toBe(true);
    expect(SKIP_SUGGEST_SLOW_MPS).toBe(0.5);
  });
});
