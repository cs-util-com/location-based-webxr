/**
 * Why these tests matter: the pin's dive now waits on the arrival prefetch
 * (round-5 plan 2026-10-01-0945 §3.6). Two things the viewer sees come from
 * here, and both fail silently if wrong:
 * - the status line beside the pin: it must say that the city's data is
 *   loading while it loads (tiles warmed of the total, and whether the cache
 *   was cold or warm), and say how it ended, or the slower cold flight reads
 *   as a hang (the repo's async-feedback rule: an in-progress state and a
 *   final state);
 * - the dive's clock: paced by the prefetch by default, or the fixed
 *   `diveMs` when that is set by hand, and in both cases bounded, so the
 *   dive always reaches the hand-over.
 */

import { describe, expect, it } from "vitest";

import {
  arrivalStatusText,
  createDiveClock,
  type ArrivalSnapshot,
} from "./globe-arrival.js";
import { FLIGHT_PACE_DEFAULTS } from "./flight-pace.js";

const jobs = (total: number, warm = 0, fetched = 0, failed = 0) => ({
  total,
  warm,
  fetched,
  failed,
});

describe("arrivalStatusText", () => {
  it("says it is checking before the cache has been listed", () => {
    const snap: ArrivalSnapshot = {
      outcome: null,
      counts: { overpass: jobs(0), dem: jobs(0) },
    };
    expect(arrivalStatusText(snap)).toMatch(/checking/i);
  });

  it("counts the tiles warmed of the total while loading, and says cold", () => {
    const text = arrivalStatusText({
      outcome: null,
      counts: { overpass: jobs(2, 0, 1), dem: jobs(18, 0, 6) },
    });
    expect(text).toMatch(/loading/i);
    expect(text).toContain("7 of 20");
    expect(text).toMatch(/cold/i);
  });

  it("says warm when everything was already stored", () => {
    const text = arrivalStatusText({
      outcome: "settled",
      counts: { overpass: jobs(1, 1), dem: jobs(18, 18) },
    });
    expect(text).toContain("19 of 19");
    expect(text).toMatch(/already stored|warm/i);
  });

  it("gives a final state that names failures", () => {
    const text = arrivalStatusText({
      outcome: "settled",
      counts: { overpass: jobs(2, 0, 1, 1), dem: jobs(18, 0, 18) },
    });
    expect(text).toContain("19 of 20");
    expect(text).toMatch(/1 failed/);
  });

  it.each([
    ["aborted", /stopped/i],
    ["no-persistent-store", /cannot be stored/i],
    ["store-unwritable", /cannot be stored/i],
    ["invalid-target", /no city data/i],
    ["unavailable", /could not start/i],
  ])("says what happened when the outcome is %s", (outcome, pattern) => {
    expect(
      arrivalStatusText({
        outcome,
        counts: { overpass: jobs(1), dem: jobs(4) },
      }),
    ).toMatch(pattern);
  });
});

describe("createDiveClock", () => {
  it("fixed: elapsed time as it is, so diveMs keeps its old meaning", () => {
    const clock = createDiveClock({ kind: "fixed", durationMs: 15_000 });
    expect(clock.elapsedMs(5_000, 0)).toBe(5_000);
    expect(clock.elapsedMs(5_000, 1)).toBe(5_000);
    expect(clock.paced).toBe(false);
  });

  it("paced: maps the path fraction onto the dive's own duration", () => {
    const clock = createDiveClock({
      kind: "paced",
      durationMs: 15_000,
      pace: FLIGHT_PACE_DEFAULTS,
    });
    expect(clock.paced).toBe(true);
    // Cold before any signal: the whole path over the 30 s cap.
    const at3 = clock.elapsedMs(3_000, 0);
    expect(at3).toBeCloseTo((3_000 / 30_000) * 15_000, 3);
  });

  it("paced: a warm prefetch lands well before the cap", () => {
    const clock = createDiveClock({
      kind: "paced",
      durationMs: 15_000,
      pace: FLIGHT_PACE_DEFAULTS,
    });
    let t = 0;
    while (clock.elapsedMs(t, 1) < 15_000) t += 16;
    expect(t).toBeLessThan(FLIGHT_PACE_DEFAULTS.minMs + 1_000);
    expect(t).toBeGreaterThanOrEqual(FLIGHT_PACE_DEFAULTS.minMs);
  });

  it("paced: a prefetch that never ends still lands at the cap", () => {
    const clock = createDiveClock({
      kind: "paced",
      durationMs: 15_000,
      pace: FLIGHT_PACE_DEFAULTS,
    });
    let t = 0;
    while (clock.elapsedMs(t, 0) < 15_000) t += 16;
    expect(t).toBeGreaterThanOrEqual(FLIGHT_PACE_DEFAULTS.capMs - 16);
    expect(t).toBeLessThanOrEqual(FLIGHT_PACE_DEFAULTS.capMs + 16);
  });

  it("paced: asking twice for the same instant changes nothing", () => {
    const clock = createDiveClock({
      kind: "paced",
      durationMs: 15_000,
      pace: FLIGHT_PACE_DEFAULTS,
    });
    const a = clock.elapsedMs(4_000, 0.5);
    expect(clock.elapsedMs(4_000, 0.5)).toBe(a);
    expect(clock.rate()).toBeGreaterThan(0);
  });

  it("refuses a duration that is not a positive number", () => {
    expect(() => createDiveClock({ kind: "fixed", durationMs: 0 })).toThrow(
      RangeError,
    );
  });
});
