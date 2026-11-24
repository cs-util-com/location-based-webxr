import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  featureMatchActions as A,
  featureMatchReducer,
  initialFeatureMatchState,
  MAX_CRASHES,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "./feature-match-slice";
import {
  deviceSummary,
  hasRate,
  measureText,
  isMoving,
  motionStep,
  readyCount,
  shotRows,
  STEADY_THRESHOLD,
} from "./guided-model";
import { SHOT_WORDS } from "./guided-texts";
import type { DeviceInfo } from "./bench-report";
import type { PhotoMeta } from "./run-plan";

const run = (
  actions: readonly FeatureMatchAction[],
  s: FeatureMatchState = initialFeatureMatchState({ session: "s1" }),
): FeatureMatchState => actions.reduce(featureMatchReducer, s);

const photo = (id: string, greyMean = 120): PhotoMeta => ({
  id,
  width: 640,
  height: 480,
  source: { width: 1280, height: 720 },
  greyMean,
});
/** A photo of shot `id`, named after it. */
const shot = (id: string, mean = 120): FeatureMatchAction =>
  A.planShotTaken({ shot: id, photo: photo(`p-${id}`, mean) });

describe("shotRows", () => {
  // Why: the shots sheet is the way to jump to or repeat a shot; each row
  // says the shot, its title and its state in words.
  it("lists every shot with its state and marks the current one", () => {
    const s = run([
      shot("light-s1/L1", 120),
      shot("light-s1/L2", 120),
      shot("light-s1/L3", 119),
    ]);
    const rows = shotRows(s);
    expect(rows).toHaveLength(13);
    expect(rows[0]).toEqual({
      index: 0,
      label: "L1 place 1",
      sub: `${SHOT_WORDS.L1.title} - done`,
      status: "done",
      current: false,
    });
    expect(rows[2]).toMatchObject({ status: "retake", current: true });
    expect(rows[2]!.sub).toBe(`${SHOT_WORDS.L3.title} - retake suggested`);
    expect(rows[4]!.label).toBe("F1");
    expect(rows[4]!.status).toBe("missing");
  });
});

describe("readyCount", () => {
  // Why: the cockpit's pair count and the zip read it.
  it("counts the pairs with both photos", () => {
    const s = run([
      shot("light-s1/L1"),
      shot("light-s1/L2"),
      shot("flat-s1/F1"),
    ]);
    expect(readyCount(s)).toBe(1);
    expect(readyCount(run([]))).toBe(0);
  });
});

// Why: the end screen is where the tester decides to send now or wait;
// it must say how far the phone got, about how long the rest takes, and
// that what is not measured goes to the PC (no new element: the lede).
describe("measureText", () => {
  const p = {
    total: 4,
    done: 1,
    failed: 0,
    waiting: 2,
    running: "light-s1/L1-L3",
    stopped: false,
    crashes: 0,
    estimateMs: 150_000,
  };
  it("says the progress, the estimate and that the rest goes to the PC", () => {
    expect(measureText(p)).toBe(
      "Measuring on this phone: 1 of 4 pairs, about 3 min left. You can download now: pairs not measured yet go to the PC.",
    );
    expect(measureText({ ...p, estimateMs: null })).toBe(
      "Measuring on this phone: 1 of 4 pairs. You can download now: pairs not measured yet go to the PC.",
    );
    expect(measureText({ ...p, estimateMs: 20_000 })).toContain(
      "under a minute left",
    );
  });

  it("says when it is finished, stopped, or waits for nothing", () => {
    expect(
      measureText({
        ...p,
        done: 3,
        failed: 1,
        waiting: 0,
        running: null,
        estimateMs: 0,
      }),
    ).toBe(
      "Measured on this phone: 3 of 4 pairs, 1 failed (the PC measures it).",
    );
    expect(
      measureText({
        ...p,
        running: null,
        stopped: true,
        crashes: MAX_CRASHES,
      }),
    ).toBe(
      // Why: the count comes from MAX_CRASHES, so the text cannot drift
      // from the rule that stops the queue.
      `Measuring stopped: the worker crashed ${String(MAX_CRASHES)} times in a row. 1 of 4 pairs measured; the rest go to the PC.`,
    );
    expect(measureText({ ...p, running: null })).toBe(
      "1 of 4 pairs measured on this phone; the rest go to the PC.",
    );
    expect(
      measureText({ ...p, total: 0, done: 0, waiting: 0, running: null }),
    ).toBe("");
  });
});

describe("deviceSummary", () => {
  const d: DeviceInfo = {
    userAgent: "UA",
    model: "Pixel 9",
    platformVersion: "16.0.0",
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    crossOriginIsolated: false,
    jspi: true,
    screen: "412x915",
    webgpu: "none",
  };
  it("names model, OS version and cores, with dashes for the unknown", () => {
    expect(deviceSummary(d)).toBe("Pixel 9, OS 16.0.0, 8 cores");
    expect(
      deviceSummary({
        ...d,
        model: null,
        platformVersion: null,
        hardwareConcurrency: null,
      }),
    ).toBe("unknown model, OS -, - cores");
  });
});

// Why this test matters: the steady chip tells the tester to keep still
// before a photo. Its level is a smoothed rotation rate (degrees per
// second, ~60 readings a second). The profiles below are assumptions, not
// recordings: a phone on a table (0.3 deg/s of sensor noise), held still
// in the hand (2-3 deg/s), the shake of a tap (a 40 deg/s spike that dies
// out over about a third of a second) and a slow pan (15 deg/s).
describe("the steady hint", () => {
  const level = (rates: readonly number[]): number[] => {
    const out: number[] = [];
    let l = 0;
    for (const r of rates) {
      l = motionStep(l, { alpha: r, beta: 0, gamma: 0 });
      out.push(l);
    }
    return out;
  };
  const table = Array.from({ length: 120 }, (_, i) => 0.3 * Math.sin(i));
  const hand = Array.from({ length: 120 }, (_, i) => 2 + Math.sin(i / 3));
  const pan = Array.from({ length: 120 }, () => 15);
  const tap = [
    ...Array.from({ length: 20 }, (_, i) => 40 * Math.exp(-i / 6)),
    ...hand,
  ];
  const settledAfter = (threshold: number): number =>
    level(tap).findIndex((l, i) => i > 0 && l <= threshold);

  // Why this test matters: the views' devicemotion listeners mark motion
  // as seen on a usable reading only; an all-NaN reading tested against
  // null alone made the readout claim "steady" without any measurement.
  it("counts only a finite rate as a reading", () => {
    expect(hasRate(null)).toBe(false);
    expect(hasRate({ alpha: null, beta: null, gamma: null })).toBe(false);
    expect(
      hasRate({ alpha: Number.NaN, beta: Infinity, gamma: -Infinity }),
    ).toBe(false);
    expect(hasRate({ alpha: Number.NaN, beta: 0, gamma: null })).toBe(true);
  });

  it("ignores a reading without a rotation rate", () => {
    expect(motionStep(5, null)).toBe(5);
    expect(motionStep(5, { alpha: null, beta: null, gamma: null })).toBe(5);
  });

  // Why: one NaN reading would latch the smoothed level to NaN for good
  // (NaN > threshold is false), pinning the chip to "steady" and hiding
  // the "phone moved during countdown" note. A value that is not a finite
  // number counts as missing.
  it("ignores rotation rates that are not finite numbers", () => {
    expect(
      motionStep(5, { alpha: Number.NaN, beta: Infinity, gamma: -Infinity }),
    ).toBe(5);
    expect(motionStep(5, { alpha: Number.NaN, beta: 10, gamma: null })).toBe(6);
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            alpha: fc.oneof(fc.double(), fc.constant(null)),
            beta: fc.oneof(fc.double(), fc.constant(null)),
            gamma: fc.oneof(fc.double(), fc.constant(null)),
          }),
          { maxLength: 30 },
        ),
        (readings) => {
          let l = 0;
          for (const r of readings) l = motionStep(l, r);
          return Number.isFinite(l) || l === 0;
        },
      ),
    );
  });

  // The sweep: every threshold from 3 to 12 calls the table and the hand
  // steady and the pan moving (the hand peaks at about 2.6); the threshold
  // only moves how long a tap reads moving: 28 readings at 3, 17 at 6, 11
  // at 12. 6 sits at twice the hand peak, short of the pan by half.
  it("keeps the verdicts across thresholds 3 to 12, and 6 has margin", () => {
    for (let t = 3; t <= 12; t++) {
      expect(level(table).every((l) => l <= t)).toBe(true);
      expect(
        level(hand)
          .slice(30)
          .every((l) => l <= t),
      ).toBe(true);
      expect(
        level(pan)
          .slice(30)
          .every((l) => l > t),
      ).toBe(true);
    }
    expect(STEADY_THRESHOLD).toBe(6);
    expect(isMoving(6.01)).toBe(true);
    expect(isMoving(6)).toBe(false);
    // About 0.3 s to settle at 6, slower at a lower threshold.
    expect(settledAfter(6)).toBeGreaterThan(10);
    expect(settledAfter(6)).toBeLessThan(30);
    expect(settledAfter(4)).toBeGreaterThan(settledAfter(6));
    expect(settledAfter(12)).toBeLessThan(settledAfter(6));
  });
});
