/**
 * Properties of the viewer's per-code moved-code check (authoring plan
 * 2026-09-28-0953 §3.6, D20, M5c).
 *
 * Why these properties matter: the viewer folds the history as it grows,
 * one dispatch at a time, in batches of whatever size the page produced (a
 * fix alone, a fix with its keep-alive ring, a re-feed of hundreds). The
 * verdict must not depend on how the growth was sliced, nor on how many
 * votes were interleaved - only on the device fixes themselves.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildQrGpsVotes } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import {
  recordGpsEvent,
  recordGpsEventBatch,
  selectGpsPositions,
  selectOdometryPositions,
  selectZeroReference,
  setZeroPos,
} from "gps-plus-slam-app-framework/state";

import { createMovedCodeChecks } from "./moved-code-check.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

createTourViewerStore();

const ZERO = { lat: 47.5, lon: 8.7 };
const T0 = 1_790_000_000_000;
const GEO = (() => {
  const g = calcGpsCoords(ZERO, [5, 400, 5]);
  return { lat: g.lat, lon: g.lon, alt: 400, headingDeg: 30 };
})();
const LEVEL = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: GEO,
    mintQuality: { alignmentSampleCount: 300 },
  },
};
const CODE_POSE = {
  position: [5, 1.5, -5] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
};

/** A store history: `n` device fixes on a wobbly walk (GPS with an offset
 *  that varies), a vote batch after the fixes `votesAfter` names. */
function history(n: number, votesAfter: ReadonlySet<number>) {
  const store = createTourViewerStore();
  store.dispatch(setZeroPos(ZERO));
  for (let i = 0; i < n; i += 1) {
    const g = calcGpsCoords(ZERO, [
      12 * Math.cos(i / 7) + 3 * Math.sin(i / 3),
      400,
      12 * Math.sin(i / 7),
    ]);
    store.dispatch(
      recordGpsEvent({
        odomPosition: [12 * Math.sin(i / 7), 1.4, -12 * Math.cos(i / 7)],
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: `g${String(i)}`,
          latitude: g.lat,
          longitude: g.lon,
          altitude: 400,
          latLongAccuracy: 3 + (i % 4),
          timestamp: T0 + i * 1000,
        },
      }),
    );
    if (votesAfter.has(i)) {
      store.dispatch(
        recordGpsEventBatch({
          events: buildQrGpsVotes({
            qrPoseWorld: CODE_POSE,
            sizeM: 0.2,
            qrGeo: GEO,
            syntheticAccuracyM: 5,
            baselineM: 30,
            count: 16,
            timestamp: T0 + i * 1000,
          }),
        }),
      );
    }
  }
  const s = store.getState();
  return {
    gpsPositions: selectGpsPositions(s),
    odometryPositions: selectOdometryPositions(s),
    zero: selectZeroReference(s),
  };
}

function finalView(
  h: ReturnType<typeof history>,
  cuts: readonly number[],
): ReturnType<ReturnType<typeof createMovedCodeChecks>["snapshot"]>[number] {
  const checks = createMovedCodeChecks();
  checks.pin({
    text: "t",
    levelId: "l",
    level: LEVEL,
    qrPoseWorld: CODE_POSE,
    atMs: T0,
    zero: ZERO,
  });
  for (const cut of [...cuts, h.gpsPositions.length]) {
    checks.update(
      {
        gpsPositions: h.gpsPositions.slice(0, cut),
        odometryPositions: h.odometryPositions.slice(0, cut),
        zero: h.zero,
      },
      // Inside the horizon, where only the estimate changes.
      T0 + 1000,
    );
  }
  return checks.snapshot()[0]!;
}

describe("moved-code check properties", () => {
  it("folds to the same estimate however the growing history is sliced", () => {
    const h = history(60, new Set());
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 60 }), { maxLength: 12 }),
        (raw) => {
          const cuts = [...raw].sort((a, b) => a - b);
          const once = finalView(h, []);
          const sliced = finalView(h, cuts);
          expect(sliced.samples).toBe(once.samples);
          expect(sliced.magnitudeM).toBeCloseTo(once.magnitudeM, 9);
          expect(sliced.yawDeg).toBeCloseTo(once.yawDeg, 9);
          expect(sliced.spreadM).toBeCloseTo(once.spreadM, 9);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("reads the same estimate whatever votes the history interleaves", () => {
    const plain = finalView(history(40, new Set()), []);
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { maxLength: 8 }),
        (after) => {
          const v = finalView(history(40, new Set(after)), []);
          expect(v.samples).toBe(plain.samples);
          expect(v.magnitudeM).toBeCloseTo(plain.magnitudeM, 9);
          expect(v.yawDeg).toBeCloseTo(plain.yawDeg, 9);
        },
      ),
      { numRuns: 15 },
    );
  });
});
