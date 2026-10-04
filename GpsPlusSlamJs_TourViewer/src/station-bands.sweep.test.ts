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
 * factors themselves (`FOUND_ACCURACY_FACTOR` 0.5/1/1.5,
 * `BAND_ACCURACY_FACTOR` 0.5/1), 120 seeds per cell.
 *
 * WHAT IS MEASURED, and the verdict across the whole range at the shipped
 * factors (1.0 / 1.0):
 * - a visitor STANDING on the station's spot is found within 3 s at p90 in
 *   every cell; the worst of 120 visitors waits 3 s (fused), 7 s (mid) or
 *   16 s (raw);
 * - a visitor WALKING PAST at three found radii is found by mistake at most
 *   1.7 % of the time (raw at 20 m; 0 % in every fused and mid cell);
 * - a visitor standing exactly on the activation radius toggles the station
 *   at most 7 times in two minutes at p90 (raw), 4 (mid), 1 (fused).
 * WHAT WOULD REVERSE IT: a found factor of 0.5 leaves a standing visitor
 *   unfound for 25 s at p90 under the `raw` model (asserted below: over
 *   10 s), and a band factor of 0.5 allows 5-18 toggles in two minutes
 *   (asserted: over 8 under raw); noise above
 *   the `raw` model (a reported accuracy that understates the real error by
 *   more than 1.5x) would need a found factor above 1.
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
  HUD_ARRIVAL_MIN_M,
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
) {
  const band = Math.max(bandK * accuracyM, HUD_ARRIVAL_BAND_M);
  const foundM = Math.max(foundRadiusM, foundK * accuracyM, HUD_ARRIVAL_MIN_M);
  const activateM = Math.max(foundRadiusM * 4, foundM + band);
  return { foundM, activateM, activateExitM: activateM + band };
}

function quantile(sorted: readonly number[], q: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ??
    Infinity
  );
}

/** Seconds until a visitor standing on the spot is found (Infinity: never in 60 s). */
function standingTimes(
  noise: NoiseName,
  acc: number,
  foundR: number,
  foundK: number,
): number[] {
  const times: number[] = [];
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const errors = gaussMarkovGpsErrors(
      mulberry32(seed * 7919 + 1),
      60,
      acc,
      NOISE[noise],
    );
    const { foundM } = bandsAt(foundR, acc, foundK, 1);
    const t = errors.findIndex(([n, e]) => Math.hypot(n, e) <= foundM);
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

/** p90 of active/inactive toggles in 120 s for a visitor standing exactly
 *  on the activation radius. */
function toggleP90(
  noise: NoiseName,
  acc: number,
  foundR: number,
  bandK: number,
): number {
  const counts: number[] = [];
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const errors = gaussMarkovGpsErrors(
      mulberry32(seed * 31337 + 5),
      120,
      acc,
      NOISE[noise],
    );
    const { activateM, activateExitM } = bandsAt(foundR, acc, 1, bandK);
    let active = false;
    let toggles = 0;
    for (const [n, e] of errors) {
      const d = Math.hypot(activateM + n, e);
      if (!active && d <= activateM) {
        active = true;
        toggles += 1;
      } else if (active && d > activateExitM) {
        active = false;
        toggles += 1;
      }
    }
    counts.push(toggles);
  }
  return quantile(
    counts.sort((a, b) => a - b),
    0.9,
  );
}

describe("station bands sweep (K4, §8 D9)", () => {
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
        expect(swept.activateExitM).toBe(shipped.activateExitM);
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

  it("keeps a visitor on the activation radius to at most 8 toggles in two minutes at p90; a band of 0.5x would not", () => {
    for (const noise of NOISES) {
      for (const acc of ACCURACIES) {
        const p90 = toggleP90(noise, acc, 5, BAND_ACCURACY_FACTOR);
        table.push(
          `toggles ${noise} acc ${acc}: p90 ${p90} (band 0.5x: ${toggleP90(noise, acc, 5, 0.5)})`,
        );
        expect(p90).toBeLessThanOrEqual(8);
      }
    }
    expect(toggleP90("raw", 5, 5, 0.5)).toBeGreaterThan(8);
  });
});
