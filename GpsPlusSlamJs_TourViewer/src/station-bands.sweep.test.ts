/**
 * The sweep behind `station-bands.ts` (tour kit plan K4, §8 D9: "radii from
 * measured accuracy, tied to the HUD deadband, swept").
 *
 * WHAT IS SIMULATED. A visitor's position estimate is the true position plus
 * the framework's Gauss-Markov GPS error (`gaussMarkovGpsErrors`: a slow
 * wander plus white noise, 1 Hz), judged by the station run's own rule
 * (`stationBands` and the found latch). Three noise models, because the
 * model's defaults were fitted for the Recorder's fused path and a visitor
 * may be placing by GPS alone:
 * - `fused`: the framework's defaults (wander 0.25, white 0.15 of the
 *   reported accuracy, 60 s correlation);
 * - `mid`: wander 0.45, white 0.20, 20 s (the correlation time of D20's
 *   real-recording noise fit);
 * - `raw`: wander 0.60, white 0.30, 20 s: per axis about 0.67 of the
 *   reported accuracy, i.e. the reported accuracy read as a 68 % radius,
 *   which is what phones report for a raw fix.
 * Swept: accuracy 3/5/8/12/20 m, authored found radius 3/5/10 m, and the
 * found factor itself (`FOUND_ACCURACY_FACTOR` 0.5/1/1.5), 120 seeds per
 * cell. The band factor is not swept: it was swept for the activation
 * hysteresis that K4 review R10 removed.
 *
 * WHAT IS MEASURED, and the verdict across the whole range at the shipped
 * found factor (1.0):
 * - a visitor STANDING on the station's spot is found within 3 s at p90 in
 *   every cell; the worst of 120 visitors waits 3 s (fused), 7 s (mid) or
 *   16 s (raw);
 * - a visitor WALKING PAST at three found radii is found by mistake at most
 *   1.7 % of the time (raw at 20 m; 0 % in every fused and mid cell).
 * WHAT WOULD REVERSE IT: a found factor of 0.5 leaves a standing visitor
 *   unfound for 25 s at p90 under the `raw` model (asserted below: over
 *   10 s); noise above the `raw` model (a reported accuracy that understates the real error by
 *   more than 1.5x) would need a found factor above 1.
 * THE STATION'S OWN POSE ERROR (K4 review R7). The viewer reads station
 *   poses that are off by up to 3.6 m at p90 (D34's 40 m sweep: notes
 *   1.6-2.8 m, codes measured at a visit's start 1.9-3.6 m). A visitor
 *   standing on the REAL spot is then that far from the stored one, and
 *   the K4 rule (a 1.5 m floor) left them unfound: 108 s at p90 under the
 *   fused model with a 3 m found radius at 3 m accuracy and a 3.6 m bias
 *   (33-34 s under mid and raw). Swept: bias 0 / 1 / 2 / 3.6 m and a found
 *   floor of 1.5 / 4 / 5 / 6 / 7 m (worst p90 over every cell: fused 108 /
 *   6 / 2 / 0 / 0 s, mid 34 / 17 / 11 / 2 / 2 s, raw 33 / 19 / 14 / 9 / 9
 *   s). Shipped: `STATION_POSE_FLOOR_M` 5 m (asserted below: fused 3 s,
 *   mid and raw 15 s at worst). Its cost: every station is found from at
 *   least 5 m, and the HUD's arrow hides there; two stations closer than
 *   about 10 m overlap under `any` order. A visitor who follows the arrow
 *   is found regardless of the bias (the arrow and the run share the stored
 *   spot); the floor is for one who stops at the landmark itself. What
 *   would reverse it: station poses measurably better than D34's (the
 *   real-recording sweep filed with D34), which would allow a lower floor.
 * PASSING AT 1.5 FOUND RADII (R7): measured, not bounded at 2 %: a fix
 *   cannot tell 1.0 from 1.5 radii. Found by mistake (no bias): fused up to
 *   15 %, mid 52 %, raw 73 % (each worst at 20 m accuracy) -
 *   i.e. a story may start 1.5 found radii away (7.5 m at the 5 m floor).
 *   The run judges the fused position, so the fused row is the honest one.
 * Not simulated: the fused AR pose between fixes (smoother than any model
 *   here, so this is the pessimistic side) and SLAM drift.
 *
 * `STATION_BANDS_SWEEP_OUT=<file>` writes the full table.
 */

import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  gaussMarkovGpsErrors,
  mulberry32,
} from "gps-plus-slam-app-framework/test-utils/integrated-slam-drift";

import {
  BAND_ACCURACY_FACTOR,
  FOUND_ACCURACY_FACTOR,
  HUD_ARRIVAL_BAND_M,
  STATION_POSE_FLOOR_M,
  stationBands,
} from "./station-bands";

const NOISE = {
  fused: { wanderFrac: 0.25, whiteFrac: 0.15, tauS: 60 },
  mid: { wanderFrac: 0.45, whiteFrac: 0.2, tauS: 20 },
  raw: { wanderFrac: 0.6, whiteFrac: 0.3, tauS: 20 },
} as const;
type NoiseName = keyof typeof NOISE;
const NOISES = Object.keys(NOISE) as NoiseName[];
const ACCURACIES = [3, 5, 8, 12, 20];
const FOUND_RADII = [3, 5, 10];
const SEEDS = 120;
/** `STATION_BANDS_SWEEP_OUT=<file>` writes the whole table there. */
const OUT = process.env["STATION_BANDS_SWEEP_OUT"];
const table: string[] = [];

/** The shipped rule with the factors swept in place of the constants. */
function bandsAt(
  foundRadiusM: number,
  accuracyM: number,
  foundK: number,
  bandK: number,
  floorM: number = STATION_POSE_FLOOR_M,
) {
  const band = Math.max(bandK * accuracyM, HUD_ARRIVAL_BAND_M);
  const foundM = Math.max(foundRadiusM, foundK * accuracyM, floorM);
  const activateM = Math.max(foundRadiusM * 4, foundM + band);
  return { foundM, activateM };
}

function quantile(sorted: readonly number[], q: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ??
    Infinity
  );
}

/** Seconds until a visitor standing on the spot is found (Infinity: never
 *  in 120 s); `biasM`: the station's stored spot is that far from the real
 *  one, where the visitor stands (K4 review R7). */
function standingTimes(
  noise: NoiseName,
  acc: number,
  foundR: number,
  foundK: number,
  biasM = 0,
  floorM = STATION_POSE_FLOOR_M,
): number[] {
  const times: number[] = [];
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const errors = gaussMarkovGpsErrors(
      mulberry32(seed * 7919 + 1),
      120,
      acc,
      NOISE[noise],
    );
    const { foundM } = bandsAt(foundR, acc, foundK, 1, floorM);
    const t = errors.findIndex(([n, e]) => Math.hypot(n + biasM, e) <= foundM);
    times.push(t < 0 ? Infinity : t);
  }
  return times.sort((a, b) => a - b);
}

/** Share of visitors walking a straight line `passK` found radii from the
 *  station (1.2 m/s, 140 s) who are found by mistake. */
function passByRate(
  noise: NoiseName,
  acc: number,
  foundR: number,
  foundK: number,
  passK: number,
): number {
  let wrong = 0;
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const errors = gaussMarkovGpsErrors(
      mulberry32(seed * 104729 + 3),
      140,
      acc,
      NOISE[noise],
    );
    const { foundM } = bandsAt(foundR, acc, foundK, 1);
    const closest = passK * foundM;
    if (
      errors.some(
        ([n, e], i) => Math.hypot(-80 + 1.2 * i + n, closest + e) <= foundM,
      )
    )
      wrong += 1;
  }
  return wrong / SEEDS;
}

// About 10 s alone (the bias sweep doubles the standing walks).
describe("station bands sweep (K4, §8 D9)", { timeout: 60_000 }, () => {
  afterAll(() => {
    if (OUT !== undefined) writeFileSync(OUT, table.join("\n") + "\n");
  });

  it("the swept rule is the shipped rule at the shipped factors", () => {
    for (const acc of ACCURACIES) {
      for (const foundR of FOUND_RADII) {
        const shipped = stationBands(
          { activateRadiusM: foundR * 4, foundRadiusM: foundR },
          acc,
        );
        const swept = bandsAt(
          foundR,
          acc,
          FOUND_ACCURACY_FACTOR,
          BAND_ACCURACY_FACTOR,
        );
        expect(swept.foundM).toBe(shipped.foundM);
        expect(swept.activateM).toBe(shipped.activateM);
      }
    }
  });

  it("finds a visitor standing on the spot within 3 s at p90 in every cell", () => {
    for (const noise of NOISES) {
      for (const acc of ACCURACIES) {
        for (const foundR of FOUND_RADII) {
          const times = standingTimes(
            noise,
            acc,
            foundR,
            FOUND_ACCURACY_FACTOR,
          );
          table.push(
            `standing ${noise} acc ${acc} found ${foundR}: p90 ${quantile(times, 0.9)} s, worst ${times.at(-1)} s`,
          );
          expect(quantile(times, 0.9)).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it("a found factor of 0.5 would reverse it: over 10 s at p90 under the raw model", () => {
    const times = standingTimes("raw", 8, 3, 0.5);
    table.push(
      `standing raw acc 8 found 3 at factor 0.5: p90 ${quantile(times, 0.9)} s`,
    );
    expect(quantile(times, 0.9)).toBeGreaterThan(10);
  });

  it("with the station's pose off by up to D34's 3.6 m, finds a visitor on the real spot within 3 s (fused) and 15 s (mid, raw) at p90; the K4 floor of 1.5 m did not (R7)", () => {
    const worst = (noise: NoiseName, floorM: number) => {
      let p90 = 0;
      for (const acc of ACCURACIES) {
        for (const foundR of FOUND_RADII) {
          for (const bias of [0, 1, 2, 3.6]) {
            p90 = Math.max(
              p90,
              quantile(
                standingTimes(
                  noise,
                  acc,
                  foundR,
                  FOUND_ACCURACY_FACTOR,
                  bias,
                  floorM,
                ),
                0.9,
              ),
            );
          }
        }
      }
      return p90;
    };
    for (const noise of NOISES) {
      const shipped = worst(noise, STATION_POSE_FLOOR_M);
      table.push(`biased ${noise}: worst p90 ${shipped} s at the 5 m floor`);
      expect(shipped).toBeLessThanOrEqual(noise === "fused" ? 3 : 15);
    }
    // What the floor fixed, and what a lower one would reverse.
    expect(worst("fused", 1.5)).toBeGreaterThan(60);
    expect(worst("fused", 4)).toBeGreaterThan(3);
  });

  it("measures passing at 1.5 found radii: under the fused model found by mistake at most 15 %", () => {
    let fused = 0;
    for (const noise of NOISES) {
      for (const acc of ACCURACIES) {
        for (const foundR of FOUND_RADII) {
          const rate = passByRate(
            noise,
            acc,
            foundR,
            FOUND_ACCURACY_FACTOR,
            1.5,
          );
          table.push(
            `pass-by 1.5 radii ${noise} acc ${acc} found ${foundR}: ${(rate * 100).toFixed(1)} %`,
          );
          if (noise === "fused") fused = Math.max(fused, rate);
        }
      }
    }
    expect(fused).toBeLessThanOrEqual(0.15);
  });

  it("finds a visitor walking past at three found radii at most 2 % of the time", () => {
    for (const noise of NOISES) {
      for (const acc of ACCURACIES) {
        for (const foundR of FOUND_RADII) {
          const rate = passByRate(noise, acc, foundR, FOUND_ACCURACY_FACTOR, 3);
          table.push(
            `pass-by ${noise} acc ${acc} found ${foundR}: ${(rate * 100).toFixed(1)} %`,
          );
          expect(rate).toBeLessThanOrEqual(0.02);
        }
      }
    }
  });
});
