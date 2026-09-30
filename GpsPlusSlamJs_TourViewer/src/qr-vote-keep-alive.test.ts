import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  GPS_POINT_SOURCE_DEVICE,
  GPS_POINT_SOURCE_SYNTHETIC_QR,
} from "gps-plus-slam-app-framework/core";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { RecordGpsEventPayload } from "gps-plus-slam-app-framework/state";

import {
  createDeviceFixWatch,
  createQrVoteKeepAlive,
  keepAliveShare,
  type KeepAliveSettings,
  type KeptCode,
} from "./qr-vote-keep-alive";
import { createTourViewerStore } from "./tour-viewer-session";

/**
 * Why these tests matter: the keep-alive is what makes a scanned code keep
 * its hold on the alignment after the vote budget is spent (authoring plan
 * 2026-09-28-0953 §3.2, owner decisions D8/D9: "about two minutes, then
 * fade"). M0b/M0c measured ONE schedule - after the scan, one vote batch per
 * GPS fix at the full per-lock count for the hold, then a count falling
 * linearly to zero over the fade, carried in a credit accumulator so every
 * batch stays a ring of >= 3 points - and these tests pin that schedule and
 * its lifecycle rules with a fake clock (every time is an argument). A
 * schedule that drifted from the measured one would ship an unmeasured
 * vote strength; a lifecycle hole (a stopped hold that still votes, a
 * second code that never takes over) would pin the alignment to the wrong
 * code for minutes.
 */

// The geodesy the vote builder calls is licence-gated; the store's
// construction activates it (the same activation main.ts performs at boot).
createTourViewerStore();

/** The viewer's shipped schedule (`createViewerKeepAlive`): 16 votes per
 *  fix at full strength since owner decision D13 (M2a's count lever). */
const SETTINGS: KeepAliveSettings = {
  holdMs: 120_000,
  fadeMs: 120_000,
  votesPerFix: 16,
  baselineM: 30,
  syntheticAccuracyM: 5,
};

const T0 = 1_790_000_000_000;
const CODE_A: KeptCode = {
  text: "https://gps.csutil.com/tour/?qr=a",
  qrPoseWorld: { position: [1, 1.5, -2], rotation: [0, 0, 0, 1] },
  qrGeo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 },
  sizeM: 0.2,
};
const CODE_B: KeptCode = {
  text: "https://gps.csutil.com/tour/?qr=b",
  qrPoseWorld: { position: [40, 1.2, 25], rotation: [0, 0, 0, 1] },
  qrGeo: { lat: 47.5004, lon: 8.7003, alt: 401, headingDeg: 120 },
  sizeM: 0.2,
};

const FULL = SETTINGS.votesPerFix;

/** The odometry centroid of a batch - the code's position for a ring. */
function centroid(votes: readonly RecordGpsEventPayload[]): number[] {
  const c = [0, 0, 0];
  for (const v of votes) {
    for (let k = 0; k < 3; k += 1) c[k]! += v.odomPosition[k]! / votes.length;
  }
  return c;
}

function expectAt(votes: readonly RecordGpsEventPayload[], pose: Pose): void {
  const c = centroid(votes);
  for (let k = 0; k < 3; k += 1) expect(c[k]).toBeCloseTo(pose.position[k]!, 4);
}

/** Every fix from `fromS` to `toS` (inclusive) at 1 Hz; the batch sizes. */
function fixes(
  keepAlive: ReturnType<typeof createQrVoteKeepAlive>,
  fromS: number,
  toS: number,
): number[] {
  const counts: number[] = [];
  for (let s = fromS; s <= toS; s += 1) {
    counts.push(keepAlive.votesForFix(T0 + s * 1000).length);
  }
  return counts;
}

describe("keepAliveShare", () => {
  it("is full for the hold, falls linearly over the fade, then zero", () => {
    expect(keepAliveShare(0, 120_000, 120_000)).toBe(1);
    expect(keepAliveShare(120_000, 120_000, 120_000)).toBe(1);
    expect(keepAliveShare(180_000, 120_000, 120_000)).toBeCloseTo(0.5, 12);
    expect(keepAliveShare(240_000, 120_000, 120_000)).toBe(0);
    expect(keepAliveShare(999_000, 120_000, 120_000)).toBe(0);
    // A fix stamped slightly before the lock (the geolocation timestamp is
    // the acquisition time) is still inside the hold.
    expect(keepAliveShare(-800, 120_000, 120_000)).toBe(1);
    expect(keepAliveShare(Number.NaN, 120_000, 120_000)).toBe(0);
  });
});

describe("createQrVoteKeepAlive - the measured schedule", () => {
  it("casts nothing before a code is kept", () => {
    const keepAlive = createQrVoteKeepAlive(SETTINGS);
    expect(keepAlive.votesForFix(T0)).toEqual([]);
    expect(keepAlive.phase(T0)).toEqual({ kind: "none" });
  });

  it("casts the full batch at every fix of the hold, stamped as synthetic votes at the fix time", () => {
    const keepAlive = createQrVoteKeepAlive(SETTINGS);
    keepAlive.keep(CODE_A, T0);
    const batch = keepAlive.votesForFix(T0 + 1000);
    expect(batch).toHaveLength(FULL);
    expectAt(batch, CODE_A.qrPoseWorld);
    for (const vote of batch) {
      expect(vote.rawGpsPoint.source).toBe(GPS_POINT_SOURCE_SYNTHETIC_QR);
      expect(vote.rawGpsPoint.timestamp).toBe(T0 + 1000);
      expect(vote.rawGpsPoint.latLongAccuracy).toBe(5);
      expect(vote.rawGpsPoint.id.startsWith("qr-keep-")).toBe(true);
    }
    expect(fixes(keepAlive, 2, 120).every((n) => n === FULL)).toBe(true);
    expect(keepAlive.phase(T0 + 60_000)).toEqual({
      kind: "holding",
      text: CODE_A.text,
      remainingMs: 60_000,
    });
  });

  it("fades to zero over the fade window, half the hold's rate on average, in rings of at least 3", () => {
    const keepAlive = createQrVoteKeepAlive(SETTINGS);
    keepAlive.keep(CODE_A, T0);
    fixes(keepAlive, 1, 120);
    const fade = fixes(keepAlive, 121, 239);
    const total = fade.reduce((a, b) => a + b, 0);
    // Sum over the 119 fixes of 16 x (1 - (s - 120) / 120): 16 x 59.5 =
    // 952, minus a residual credit below 3.
    expect(FULL * 59.5).toBe(952);
    expect(total).toBeGreaterThan(952 - 3);
    expect(total).toBeLessThanOrEqual(952);
    expect(fade.every((n) => n === 0 || (n >= 3 && n <= FULL))).toBe(true);
    // The tail thins out: the last 10 fixes accrue FULL x (1 + ... + 10) /
    // 120 votes of credit (7.3 at 16) plus a carried residual below 3, so
    // at most 3 rings of 3 - most of those fixes cast nothing.
    const tail = fade.slice(-10);
    expect(tail.reduce((a, b) => a + b, 0)).toBeLessThan((FULL * 55) / 120 + 3);
    expect(tail.filter((n) => n > 0).length).toBeLessThanOrEqual(3);
    expect(keepAlive.phase(T0 + 180_000)).toEqual({
      kind: "fading",
      text: CODE_A.text,
      share: 0.5,
    });
    expect(fixes(keepAlive, 240, 400).every((n) => n === 0)).toBe(true);
    expect(keepAlive.phase(T0 + 240_000)).toEqual({
      kind: "ended",
      text: CODE_A.text,
    });
  });

  it("casts exactly the M0c credit schedule for any fix cadence (property)", () => {
    // The emitted total is the accumulated credit minus what is left over,
    // and what is left over is below 3 (a batch needs a ring of 3): so the
    // mean rate is exactly the measured schedule whatever the GPS cadence.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 200, max: 5000 }), {
          minLength: 1,
          maxLength: 400,
        }),
        (intervals) => {
          const keepAlive = createQrVoteKeepAlive(SETTINGS);
          keepAlive.keep(CODE_A, T0);
          let t = T0;
          let credit = 0;
          let emitted = 0;
          for (const dt of intervals) {
            t += dt;
            credit +=
              FULL * keepAliveShare(t - T0, SETTINGS.holdMs, SETTINGS.fadeMs);
            const batch = keepAlive.votesForFix(t);
            expect(batch.length === 0 || batch.length >= 3).toBe(true);
            emitted += batch.length;
            expect(credit - emitted).toBeGreaterThanOrEqual(-1e-9);
            expect(credit - emitted).toBeLessThan(3);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("createQrVoteKeepAlive - the lifecycle", () => {
  it("re-votes from the last kept pose, which later voted locks refresh", () => {
    const keepAlive = createQrVoteKeepAlive(SETTINGS);
    keepAlive.keep(CODE_A, T0);
    const refreshed: KeptCode = {
      ...CODE_A,
      qrPoseWorld: { position: [1.1, 1.5, -2.05], rotation: [0, 0, 0, 1] },
    };
    keepAlive.keep(refreshed, T0 + 125);
    const batch = keepAlive.votesForFix(T0 + 1000);
    expect(batch).toHaveLength(FULL);
    expectAt(batch, refreshed.qrPoseWorld);
  });

  it("a re-scan of the same code restarts the hold", () => {
    const keepAlive = createQrVoteKeepAlive(SETTINGS);
    keepAlive.keep(CODE_A, T0);
    expect(keepAlive.phase(T0 + 200_000).kind).toBe("fading");
    keepAlive.relock(CODE_A.text, T0 + 200_000);
    expect(keepAlive.phase(T0 + 200_000)).toEqual({
      kind: "holding",
      text: CODE_A.text,
      remainingMs: 120_000,
    });
    // Full strength again, from the SAME kept pose (a spent code's pose is
    // not re-evaluated).
    const batch = keepAlive.votesForFix(T0 + 201_000);
    expect(batch).toHaveLength(FULL);
    expectAt(batch, CODE_A.qrPoseWorld);
    // A lock of another code that cast no vote changes nothing.
    keepAlive.relock(CODE_B.text, T0 + 500_000);
    expect(keepAlive.phase(T0 + 500_000)).toEqual({
      kind: "ended",
      text: CODE_A.text,
    });
  });

  it("a second code takes over the keep-alive", () => {
    const keepAlive = createQrVoteKeepAlive(SETTINGS);
    keepAlive.keep(CODE_A, T0);
    keepAlive.keep(CODE_B, T0 + 30_000);
    const batch = keepAlive.votesForFix(T0 + 31_000);
    expect(batch).toHaveLength(FULL);
    expectAt(batch, CODE_B.qrPoseWorld);
    // The first code's re-scan no longer restarts anything: B holds.
    keepAlive.relock(CODE_A.text, T0 + 100_000);
    expect(keepAlive.phase(T0 + 100_000)).toEqual({
      kind: "holding",
      text: CODE_B.text,
      remainingMs: 50_000,
    });
  });

  it("stops: no vote after stop(), and nothing to restart", () => {
    const keepAlive = createQrVoteKeepAlive(SETTINGS);
    keepAlive.keep(CODE_A, T0);
    keepAlive.stop();
    expect(keepAlive.votesForFix(T0 + 1000)).toEqual([]);
    keepAlive.relock(CODE_A.text, T0 + 2000);
    expect(keepAlive.votesForFix(T0 + 3000)).toEqual([]);
    expect(keepAlive.phase(T0 + 3000)).toEqual({ kind: "none" });
  });

  it("ignores non-finite times instead of corrupting the hold", () => {
    const keepAlive = createQrVoteKeepAlive(SETTINGS);
    keepAlive.keep(CODE_A, Number.NaN);
    expect(keepAlive.phase(T0)).toEqual({ kind: "none" });
    keepAlive.keep(CODE_A, T0);
    keepAlive.relock(CODE_A.text, Number.POSITIVE_INFINITY);
    expect(keepAlive.votesForFix(Number.NaN)).toEqual([]);
    expect(keepAlive.votesForFix(T0 + 1000)).toHaveLength(FULL);
  });

  it("drops a code whose votes cannot be built rather than throwing into the store listener", () => {
    const keepAlive = createQrVoteKeepAlive(SETTINGS);
    // A geo pose with neither heading nor rotation makes the builder throw;
    // parseQrLevel rejects it, but the listener must never be the place
    // that finds out.
    keepAlive.keep(
      { ...CODE_A, qrGeo: { lat: 47.5, lon: 8.7, alt: 400 } as never },
      T0,
    );
    expect(keepAlive.votesForFix(T0 + 1000)).toEqual([]);
    expect(keepAlive.phase(T0 + 1000)).toEqual({ kind: "none" });
  });

  it("rejects settings the measured schedule cannot run with", () => {
    const bad: Partial<KeepAliveSettings>[] = [
      { holdMs: -1 },
      { fadeMs: Number.NaN },
      { votesPerFix: 2 },
      { votesPerFix: 7.5 },
      { baselineM: 0 },
      { syntheticAccuracyM: 0 },
    ];
    for (const patch of bad) {
      expect(() => createQrVoteKeepAlive({ ...SETTINGS, ...patch })).toThrow(
        RangeError,
      );
    }
  });
});

describe("createDeviceFixWatch", () => {
  const point = (id: string, source?: string) => ({
    id,
    timestamp: T0 + Number(id.replace(/\D/g, "")),
    ...(source === undefined ? {} : { source }),
  });

  it("reports each NEW device fix once, and never a synthetic or unknown one", () => {
    const next = createDeviceFixWatch();
    expect(next([])).toBeNull();
    const a = point("gps-1");
    expect(next([a])).toBe(a.timestamp);
    expect(next([a])).toBeNull(); // the same fix, seen again
    const vote = point("qr-2", GPS_POINT_SOURCE_SYNTHETIC_QR);
    expect(next([a, vote])).toBeNull();
    const b = point("gps-3", GPS_POINT_SOURCE_DEVICE);
    expect(next([a, vote, b])).toBe(b.timestamp);
    // A stamp this version does not know is NOT device (the core's
    // `gpsPointSourceOf` rule): never round an unknown source toward GPS.
    expect(next([a, vote, b, point("x-4", "synthetic-beacon")])).toBeNull();
  });
});
