/**
 * The sweep behind `station-bands.ts` under D16 (tour editor plan
 * 2026-10-17-1816): a station is found by the radius the tour gives it and
 * nothing else - no accuracy widening, no pose floor. This file measures
 * what that costs, so a creator's radius can be chosen from numbers; it
 * replaced the K4 sweep of the accuracy factor and the 5 m floor, which D16
 * removed.
 *
 * WHAT IS SIMULATED. A visitor's position estimate is the true position plus
 * the framework's Gauss-Markov GPS error (`gaussMarkovGpsErrors`: a slow
 * wander plus white noise, 1 Hz), judged by the station run's rule
 * (`stationBands(...).foundM`, the authored radius). Three noise models:
 * - `fused`: the framework's defaults (wander 0.25, white 0.15 of the
 *   reported accuracy, 60 s correlation) - the aligned position;
 * - `mid`: wander 0.45, white 0.20, 20 s;
 * - `raw`: wander 0.60, white 0.30, 20 s: the reported accuracy read as a
 *   68 % radius, what a phone reports for a raw fix (before any alignment).
 * Swept: accuracy 3/5/8/12/20 m, authored found radius 3/5/10/25 m, and the
 * station's own pose error (bias) 0 / 1 / 2 / 3.6 m (D34's 40 m sweep: 3.6 m
 * at p90), 120 seeds per cell.
 *
 * WHAT IS MEASURED (`STATION_BANDS_SWEEP_OUT=<file>` writes the table):
 * - the 25 m default radius (`STATION_RADIUS_M`, provisional) finds a
 *   visitor standing on the spot within 1 s at p90 in every cell, bias
 *   included, and a visitor walking past at three radii never (0 %);
 * - a small radius asks for a position as good as itself. Worst p90 over
 *   accuracy and bias, fused / mid / raw: 3 m 108 / 71 / never in 120 s;
 *   5 m 33 / 43 / 57 s; 10 m 2 / 18 / 25 s. At 3-5 m accuracy (an aligned
 *   position, a code just scanned) a 5 m station is found within 3 s
 *   (fused, no bias). The old rule widened the radius by the accuracy and
 *   was within 3 s everywhere; D16 gives that up on purpose.
 * - passing a small station at three radii is found by mistake when the
 *   noise is larger than the radius: 3 m at 20 m accuracy 24 / 37 / 38 %.
 *   At 1.5 radii a fix cannot tell the difference, as under the old rule
 *   (up to 70 % raw at 20 m for 25 m).
 * WHAT WOULD REVERSE IT: noise above the `raw` model (an accuracy that
 *   understates the error by more than 1.5x) at the 25 m default; a radius
 *   choice in the editor that ignores these numbers. The radius measurement
 *   of 15-40 m (tour editor plan, after M5a) refines the default.
 * Not simulated: the aligned AR pose between fixes (smoother than any model
 *   here, so this is the pessimistic side), SLAM drift, and a code's own
 *   correction of the position (which only makes it better).
 *
 * THE JUDGED PATH (r881): the last block drives the shipped decision end to
 * end - the station run's `observe` with the accuracy `judgedAccuracy`
 * hands it - for raw accuracies 3-500 m, with and without a code that lined
 * the position up, at the 5 m sample radius and the 25 m default. Without a
 * code the raw accuracy judges (above the 25 m ceiling nothing latches);
 * with one, the position is the code's (modelled as the `fused` noise at a
 * code accuracy of 1 / 3 / 5 m, an assumption: no field figure exists yet)
 * and the raw accuracy does not enter at all. Before the alignment is
 * ready (tracking `ok`, which a visitor standing or walking straight may
 * never reach) the guide judges by the fresh device fix with its own
 * accuracy - the no-code rows with the `raw` model are that case.
 */

import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  gaussMarkovGpsErrors,
  mulberry32,
} from "gps-plus-slam-app-framework/test-utils/integrated-slam-drift";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";

import { judgedAccuracy, stationBands } from "./station-bands";
import { STATION_RADIUS_M } from "./station-assign";
import { createStationRun } from "./station-run";

const NOISE = {
  fused: { wanderFrac: 0.25, whiteFrac: 0.15, tauS: 60 },
  mid: { wanderFrac: 0.45, whiteFrac: 0.2, tauS: 20 },
  raw: { wanderFrac: 0.6, whiteFrac: 0.3, tauS: 20 },
} as const;
type NoiseName = keyof typeof NOISE;
const NOISES = Object.keys(NOISE) as NoiseName[];
const ACCURACIES = [3, 5, 8, 12, 20];
const FOUND_RADII = [3, 5, 10, STATION_RADIUS_M];
const BIASES = [0, 1, 2, 3.6];
const SEEDS = 120;
const OUT = process.env["STATION_BANDS_SWEEP_OUT"];
const table: string[] = [];

function foundAt(foundRadiusM: number, accuracyM: number): number {
  return stationBands(
    { activateRadiusM: foundRadiusM * 4, foundRadiusM },
    accuracyM,
  ).foundM;
}

function quantile(sorted: readonly number[], q: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ??
    Infinity
  );
}

/** Seconds until a visitor standing on the real spot is found (Infinity:
 *  never in 120 s); the stored spot is `biasM` from the real one. */
function standingTimes(
  noise: NoiseName,
  acc: number,
  foundR: number,
  biasM: number,
): number[] {
  const foundM = foundAt(foundR, acc);
  const times: number[] = [];
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const errors = gaussMarkovGpsErrors(
      mulberry32(seed * 7919 + 1),
      120,
      acc,
      NOISE[noise],
    );
    const t = errors.findIndex(([n, e]) => Math.hypot(n + biasM, e) <= foundM);
    times.push(t < 0 ? Infinity : t);
  }
  return times.sort((a, b) => a - b);
}

/** Share of visitors walking a straight line `passK` found radii from the
 *  station (1.2 m/s, 140 s, starting 80 m before it) found by mistake. */
function passByRate(
  noise: NoiseName,
  acc: number,
  foundR: number,
  passK: number,
): number {
  const foundM = foundAt(foundR, acc);
  const closest = passK * foundM;
  let wrong = 0;
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const errors = gaussMarkovGpsErrors(
      mulberry32(seed * 104729 + 3),
      140,
      acc,
      NOISE[noise],
    );
    if (
      errors.some(
        ([n, e], i) => Math.hypot(-80 + 1.2 * i + n, closest + e) <= foundM,
      )
    )
      wrong += 1;
  }
  return wrong / SEEDS;
}

/** The judged path's sweep (r881): raw accuracies from open sky to a cold
 *  start, the sample tour's 5 m radius and the 25 m default, and the code's
 *  own accuracy (an assumption, swept). */
const JUDGED_RAW_ACCURACIES = [3, 5, 8, 12, 20, 25, 30, 40, 60, 100, 200, 500];
const JUDGED_RADII = [5, STATION_RADIUS_M];
const CODE_ACCURACIES = [1, 3, 5];
const JUDGED_STEP = {
  id: "s",
  block: { kind: "text", text: "Hi" },
  advance: { mode: "tap" },
} as const;

function judgedStation(foundRadiusM: number): TourStation {
  return {
    id: "st",
    title: "ST",
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
    activateRadiusM: foundRadiusM * 4,
    foundRadiusM,
    hint: "arrow",
    steps: [JUDGED_STEP],
    items: [],
  };
}

/** Whether the shipped run latches "found" on these distances, judged by
 *  the accuracy `judgedAccuracy` gives for this raw accuracy and code. */
function latches(
  distances: readonly number[],
  foundR: number,
  rawAccuracyM: number,
  codeLinedUp: boolean,
): boolean {
  const run = createStationRun({
    stations: [judgedStation(foundR)],
    order: "fixed",
    nowMs: 0,
  });
  const accuracyM = judgedAccuracy(rawAccuracyM, codeLinedUp);
  for (const [i, d] of distances.entries()) {
    const events = run.observe({
      distances: new Map([["st", d]]),
      nowMs: i * 1000,
      accuracyM,
    });
    if (events.some((e) => e.kind === "found")) return true;
  }
  return false;
}

/** Share of visitors standing on the spot found within 120 s. The position
 *  error is `errorAccM` of `noise`: the raw accuracy's without a code, the
 *  code's own with one. */
function judgedStandingRate(
  rawAccuracyM: number,
  foundR: number,
  codeLinedUp: boolean,
  errorAccM: number,
  noise: (typeof NOISE)[NoiseName],
): number {
  let hits = 0;
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const errors = gaussMarkovGpsErrors(
      mulberry32(seed * 7919 + 1),
      120,
      errorAccM,
      noise,
    );
    const distances = errors.map(([n, e]) => Math.hypot(n, e));
    if (latches(distances, foundR, rawAccuracyM, codeLinedUp)) hits += 1;
  }
  return hits / SEEDS;
}

/** Share of visitors walking past at three radii (as `passByRate`) found
 *  by mistake on the judged path. */
function judgedPassRate(
  rawAccuracyM: number,
  foundR: number,
  codeLinedUp: boolean,
  errorAccM: number,
  noise: (typeof NOISE)[NoiseName],
): number {
  const closest = 3 * foundR;
  let wrong = 0;
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const errors = gaussMarkovGpsErrors(
      mulberry32(seed * 104729 + 3),
      140,
      errorAccM,
      noise,
    );
    const distances = errors.map(([n, e], i) =>
      Math.hypot(-80 + 1.2 * i + n, closest + e),
    );
    if (latches(distances, foundR, rawAccuracyM, codeLinedUp)) wrong += 1;
  }
  return wrong / SEEDS;
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)} %`;
}

/** The worst p90 standing time over the given accuracies and every bias. */
function worstP90(
  noise: NoiseName,
  foundR: number,
  accs: readonly number[] = ACCURACIES,
): number {
  let p90 = 0;
  for (const acc of accs) {
    for (const bias of BIASES) {
      const q = quantile(standingTimes(noise, acc, foundR, bias), 0.9);
      table.push(
        `standing ${noise} acc ${acc} found ${foundR} bias ${bias}: p90 ${q} s`,
      );
      p90 = Math.max(p90, q);
    }
  }
  return p90;
}

describe(
  "station bands sweep (D16: the authored radius alone)",
  { timeout: 60_000 },
  () => {
    afterAll(() => {
      if (OUT !== undefined) writeFileSync(OUT, table.join("\n") + "\n");
    });

    it("the swept rule is the shipped rule: found is the authored radius at every accuracy", () => {
      for (const acc of ACCURACIES) {
        for (const foundR of FOUND_RADII) {
          expect(foundAt(foundR, acc)).toBe(foundR);
        }
      }
    });

    it("the default radius finds a visitor standing on the spot within 1 s in every cell, and never one walking past at three radii", () => {
      for (const noise of NOISES) {
        expect(worstP90(noise, STATION_RADIUS_M)).toBeLessThanOrEqual(1);
        for (const acc of ACCURACIES) {
          expect(passByRate(noise, acc, STATION_RADIUS_M, 3)).toBe(0);
        }
      }
    });

    it("a small radius at a poor accuracy is slow: the cost D16 accepts, measured", () => {
      // Why this test matters: it keeps the price of a precise radius in
      // view. The old rule widened the radius by the accuracy (3 s at p90
      // everywhere); since D16 a 5 m station asks for a 5 m position.
      const worst5 = Math.max(...NOISES.map((n) => worstP90(n, 5)));
      table.push(`worst p90 found 5: ${worst5} s`);
      expect(worst5).toBeGreaterThan(30);
      // A 3 m station at 20 m raw accuracy: 102 s at p90 on the spot itself.
      expect(quantile(standingTimes("raw", 20, 3, 0), 0.9)).toBeGreaterThan(60);
      // ... while a good aligned position finds the same stations fast.
      expect(worstP90("fused", 5, [3, 5])).toBeLessThanOrEqual(3);
      // A 3 m station is found fast only while its own pose error is below
      // its radius: with 3.6 m of bias the worst p90 is 108 s.
      expect(
        quantile(standingTimes("fused", 3, 3, 0), 0.9),
      ).toBeLessThanOrEqual(3);
    });

    // Why this test matters (r881): every position in a live session is
    // "aligned" from its first fix, so the trust a code earns must come
    // from the code and nothing else. This runs the shipped judgement - the
    // run's `observe` fed by `judgedAccuracy` - across raw accuracies the
    // phone really reports (3 m open sky to a 500 m cold start), and pins
    // what each side buys: without a code a fix above the ceiling latches
    // nothing, standing on the spot or passing it; with a code the raw
    // accuracy changes nothing, the courtyard case (M5c review #1).
    it("the judged path: found-latch rates over raw accuracy 3-500 m, with and without a code", () => {
      const rows: string[] = [];
      const oldPassRates = new Map<string, number>();
      /** No-code cells above the ceiling that latched at all: none may. */
      const aboveCeilingLatches: string[] = [];
      for (const foundR of JUDGED_RADII) {
        for (const raw of JUDGED_RAW_ACCURACIES) {
          for (const noise of NOISES) {
            const found = judgedStandingRate(
              raw,
              foundR,
              false,
              raw,
              NOISE[noise],
            );
            const wrong = judgedPassRate(raw, foundR, false, raw, NOISE[noise]);
            rows.push(
              `judged no-code ${noise} raw ${raw} found ${foundR}: standing ${pct(found)}, pass-by 3 radii ${pct(wrong)}`,
            );
            // Above the ceiling: nothing latches, right or wrong.
            if (raw > 25 && (found > 0 || wrong > 0)) {
              aboveCeilingLatches.push(`${noise} raw ${raw} found ${foundR}`);
            }
          }
          for (const codeAcc of CODE_ACCURACIES) {
            const found = judgedStandingRate(
              raw,
              foundR,
              true,
              codeAcc,
              NOISE.fused,
            );
            const wrong = judgedPassRate(
              raw,
              foundR,
              true,
              codeAcc,
              NOISE.fused,
            );
            rows.push(
              `judged code ${codeAcc} m raw ${raw} found ${foundR}: standing ${pct(found)}, pass-by 3 radii ${pct(wrong)}`,
            );
            // The raw accuracy does not enter a code's position: the same
            // seeds give the same latches at every raw accuracy.
            expect(found).toBe(
              judgedStandingRate(3, foundR, true, codeAcc, NOISE.fused),
            );
            expect(wrong).toBe(
              judgedPassRate(3, foundR, true, codeAcc, NOISE.fused),
            );
            // A code-placed visitor on the spot is found (the courtyard
            // case), and one passing at three radii is not.
            expect(found).toBe(1);
            expect(wrong).toBe(0);
          }
          // The rule this replaced, for the record: every aligned position
          // was trusted like a code's, its error still the raw fixes'.
          const oldWrong = judgedPassRate(raw, foundR, true, raw, NOISE.raw);
          oldPassRates.set(`${raw}/${foundR}`, oldWrong);
          rows.push(
            `judged old-rule raw raw ${raw} found ${foundR}: pass-by 3 radii ${pct(oldWrong)}`,
          );
        }
      }
      table.push(...rows);
      expect(aboveCeilingLatches).toEqual([]);
      // What the old rule cost: above the ceiling, where the new one
      // latches nothing, a visitor passing at three radii was found by
      // mistake in up to 55 % (5 m) and 88 % (25 m) of runs. The worst raw
      // accuracy moves with the radius (a huge error rarely lands in a
      // small disc), so the bound is on the worst above the ceiling.
      for (const foundR of JUDGED_RADII) {
        const worstOld = Math.max(
          ...JUDGED_RAW_ACCURACIES.filter((raw) => raw > 25).map(
            (raw) => oldPassRates.get(`${String(raw)}/${String(foundR)}`) ?? 0,
          ),
        );
        expect(worstOld).toBeGreaterThan(0.5);
      }
      // Below the ceiling without a code the 25 m default still finds a
      // visitor on the spot at every model (D16's own measurement).
      expect(
        judgedStandingRate(20, STATION_RADIUS_M, false, 20, NOISE.raw),
      ).toBe(1);
    });

    it("measures passing: a small station is found by mistake at three radii once the noise outgrows it", () => {
      let worst = 0;
      for (const noise of NOISES) {
        for (const acc of ACCURACIES) {
          for (const foundR of FOUND_RADII) {
            const at3 = passByRate(noise, acc, foundR, 3);
            const at15 = passByRate(noise, acc, foundR, 1.5);
            table.push(
              `pass-by ${noise} acc ${acc} found ${foundR}: 3 radii ${(at3 * 100).toFixed(1)} %, 1.5 radii ${(at15 * 100).toFixed(1)} %`,
            );
            if (foundR === 3 && acc === 20) worst = Math.max(worst, at3);
          }
        }
      }
      // Measured 38 %; bounded loosely so a reseed does not flip it.
      expect(worst).toBeGreaterThan(0.2);
      expect(worst).toBeLessThan(0.6);
    });
  },
);
