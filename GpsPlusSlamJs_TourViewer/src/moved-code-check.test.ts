/**
 * The viewer's per-code moved-code check (authoring plan 2026-09-28-0953
 * §3.6, D20, M5c): a scanned code is pinned at its voted lock and judged on
 * the store's device fixes as they arrive.
 *
 * Why these tests matter: the check runs on the visitor's live GPS history,
 * which holds the code's OWN votes - points built from the same pose and
 * saved geo the pin uses, so they agree with it by construction and would
 * dilute any real move towards zero (§7j #3). It must read device fixes
 * only, decide once, stop at its horizon, survive a reset of the history,
 * and drop a pin whose odometry frame is gone. The fixes go through a real
 * viewer store, as the page's do.
 */
import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { buildQrGpsVotes } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import { calcGpsCoords, type LatLong } from "gps-plus-slam-app-framework/core";
import {
  recordGpsEvent,
  recordGpsEventBatch,
  resetGpsSessionData,
  selectGpsPositions,
  selectOdometryPositions,
  selectZeroReference,
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";

import { objectPoseNue } from "./content-placement.js";
import { alignmentNorthBearingDeg } from "./gps-noise-fit.js";
import { createMovedCodeChecks } from "./moved-code-check.js";
import { MOVED_CODE_RULE_VERSION } from "./moved-code-rule.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

// The geodesy is licence-gated; building a store activates it.
createTourViewerStore();

const ZERO: LatLong = { lat: 47.5, lon: 8.7 };
const T0 = 1_790_000_000_000;
const rad = (d: number): number => (d * Math.PI) / 180;

/** The true odometry-NUE to world-NUE transform: a 40 degree turn and a
 *  shift, so no identity frame can pass a test. */
const ODOM_TO_WORLD = new Matrix4().compose(
  new Vector3(30, 0, -12),
  new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rad(40)),
  new Vector3(1, 1, 1),
);
const WORLD_TO_ODOM = ODOM_TO_WORLD.clone().invert();
const NUE_TO_WEBXR = WEBXR_TO_NUE.clone().invert();

/** The saved code: 20 m north, 10 m east of the zero, facing east. */
const SAVED_GEO = (() => {
  const g = calcGpsCoords(ZERO, [20, 400, 10]);
  return { lat: g.lat, lon: g.lon, alt: 400, headingDeg: 90 };
})();
const level = (alignmentSampleCount = 300): QrLevel => ({
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: SAVED_GEO,
    mintQuality: { alignmentSampleCount, gpsAccuracyM: 3.5 },
  },
});

/** A world-NUE pose as the raw WebXR odometry sees it. */
function rawOf(world: Matrix4): Pose {
  const m = NUE_TO_WEBXR.clone().multiply(WORLD_TO_ODOM).multiply(world);
  const p = new Vector3();
  const q = new Quaternion();
  m.decompose(p, q, new Vector3());
  return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
}

/** Where the poster physically hangs: the saved pose moved by `move`
 *  (north, east) and turned by `turnDeg`, as the camera sees it. */
function codeSeen(move: readonly [number, number], turnDeg = 0): Pose {
  const saved = objectPoseNue(SAVED_GEO, ZERO);
  const turned = new Quaternion(...saved.rotationNue).premultiply(
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rad(turnDeg)),
  );
  return rawOf(
    new Matrix4().compose(
      new Vector3(
        saved.positionNue[0] + move[0],
        saved.positionNue[1],
        saved.positionNue[2] + move[1],
      ),
      turned,
      new Vector3(1, 1, 1),
    ),
  );
}

/** A device fix taken at world [n, e] at second `s`: exact odometry, GPS =
 *  truth + `bias`, accuracy `acc`. */
function fixAt(
  s: number,
  n: number,
  e: number,
  over: { bias?: readonly [number, number]; acc?: number } = {},
): RecordGpsEventPayload {
  const raw = rawOf(new Matrix4().makeTranslation(n, 1.4, e));
  const b = over.bias ?? [0, 0];
  const g = calcGpsCoords(ZERO, [n + b[0], 400, e + b[1]]);
  return {
    odomPosition: raw.position,
    odomRotation: [0, 0, 0, 1],
    rawGpsPoint: {
      id: `gps-${String(s)}`,
      latitude: g.lat,
      longitude: g.lon,
      altitude: 400,
      latLongAccuracy: over.acc ?? 4,
      timestamp: T0 + s * 1000,
    },
  };
}

/** A walk around world [n, e] on a circle of `radiusM`, one fix a second
 *  from second `from` to `to`. */
function circle(
  from: number,
  to: number,
  centre: readonly [number, number],
  radiusM: number,
  over: { bias?: readonly [number, number]; acc?: number } = {},
): RecordGpsEventPayload[] {
  const out: RecordGpsEventPayload[] = [];
  for (let s = from; s <= to; s += 1) {
    const a = (2 * Math.PI * s) / 40;
    out.push(
      fixAt(
        s,
        centre[0] + radiusM * Math.cos(a),
        centre[1] + radiusM * Math.sin(a),
        over,
      ),
    );
  }
  return out;
}

function harness() {
  const store = createTourViewerStore();
  store.dispatch(setZeroPos(ZERO));
  const checks = createMovedCodeChecks();
  const view = () => {
    const s = store.getState();
    return {
      gpsPositions: selectGpsPositions(s),
      odometryPositions: selectOdometryPositions(s),
      zero: selectZeroReference(s),
    };
  };
  /** Feed fixes one by one, judging after each (the viewer's cadence);
   *  returns every verdict with the second it came at. */
  const feed = (fixes: readonly RecordGpsEventPayload[]) => {
    const out: { s: number; levelId: string; decidedBy: string }[] = [];
    for (const f of fixes) {
      store.dispatch(recordGpsEvent(f));
      const s = (f.rawGpsPoint.timestamp - T0) / 1000;
      for (const v of checks.update(view(), T0 + s * 1000)) {
        out.push({ s, levelId: v.levelId, decidedBy: v.evidence.decidedBy });
      }
    }
    return out;
  };
  const pin = (pose: Pose, atS: number, lvl: QrLevel = level(), id = "lvl") =>
    checks.pin({
      text: `text-${id}`,
      levelId: id,
      level: lvl,
      qrPoseWorld: pose,
      atMs: T0 + atS * 1000,
      zero: ZERO,
    });
  return { store, checks, view, feed, pin };
}

// Every fix is a full re-solve in the reducer, so a test here takes
// seconds, more on a loaded machine.
describe("createMovedCodeChecks", { timeout: 60_000 }, () => {
  // Why: the headline case. A poster re-hung 40 m east; the visitor scans
  // it and walks. The fit needs 60 s and 2 m of evidence, then reads the
  // move - once.
  it("reads a code moved 40 m as moved by position, once, after 60 s of walking", () => {
    const h = harness();
    // GPS before the scan, then the scan at second 10.
    h.feed(circle(0, 9, [20, 50], 6));
    h.pin(codeSeen([0, 40]), 10);
    const verdicts = h.feed(circle(10, 120, [20, 50], 6));
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      levelId: "lvl",
      decidedBy: "position",
    });
    // The evidence spans 60 s (the history from second 0 is folded too).
    expect(verdicts[0]!.s).toBeGreaterThanOrEqual(60);
    expect(verdicts[0]!.s).toBeLessThan(75);
  });

  it("never reads an unmoved code as moved, and stops at its horizon", () => {
    const h = harness();
    h.pin(codeSeen([0, 0]), 0);
    expect(h.feed(circle(0, 290, [20, 10], 8, { bias: [4, -3] }))).toEqual([]);
    expect(h.checks.snapshot()).toHaveLength(1);
    // Past the 300 s horizon the check is gone: even a wild jump decides
    // nothing.
    h.feed(circle(301, 310, [20, 10], 8, { bias: [60, 0] }));
    expect(h.checks.snapshot()).toEqual([]);
  });

  // Why (§7j #3): the code's own votes agree with its pin by construction.
  // A check that read them would see a 40 m move shrink towards zero.
  it("reads device fixes only: the code's votes in the history change nothing", () => {
    const withVotes = harness();
    const plain = harness();
    for (const h of [withVotes, plain]) h.pin(codeSeen([0, 40]), 0);
    const fixes = circle(0, 90, [20, 50], 6);
    const judged = (h: ReturnType<typeof harness>) => {
      for (const f of fixes) {
        h.store.dispatch(recordGpsEvent(f));
        if (h === withVotes) {
          h.store.dispatch(
            recordGpsEventBatch({
              events: buildQrGpsVotes({
                qrPoseWorld: codeSeen([0, 40]),
                sizeM: 0.2,
                qrGeo: SAVED_GEO,
                syntheticAccuracyM: 5,
                baselineM: 30,
                count: 16,
                timestamp: f.rawGpsPoint.timestamp,
              }),
            }),
          );
        }
      }
      // One judgement over the whole walk: moved, with its evidence.
      const [verdict] = h.checks.update(h.view(), T0 + 50_000);
      return { ...verdict!.evidence, samples: verdict!.evidence.deviceFixes };
    };
    const a = judged(withVotes);
    const b = judged(plain);
    expect(a.magnitudeM).toBeCloseTo(b.magnitudeM, 6);
    expect(a.samples).toBe(b.samples);
    expect(a.magnitudeM).toBeGreaterThan(35);
  });

  // Why: the turn check - the rigid fit absorbs a turn, so only the yaw
  // reads it. A settled save (300 solved fixes) uses the yaw at 45 degrees.
  it("reads a poster turned 90 degrees in place by the settled yaw", () => {
    const h = harness();
    h.pin(codeSeen([0, 0], 90), 0);
    const verdicts = h.feed(circle(0, 120, [20, 10], 10));
    expect(verdicts).toEqual([
      expect.objectContaining({ decidedBy: "settled-yaw" }),
    ]);
  });

  // Why: an early save (under 120 fixes) with an outdoor compass decides by
  // the compass at the first reading after the scan, with no walk at all.
  it("reads a turned poster of an early save by the compass at the scan, outdoors", () => {
    const h = harness();
    h.feed(circle(0, 5, [20, 12], 1, { acc: 4 }));
    h.pin(codeSeen([0, 0], 90), 6, level(30));
    h.checks.compass(
      alignmentNorthBearingDeg(ODOM_TO_WORLD.toArray()),
      T0 + 6000,
    );
    const verdicts = h.feed(circle(6, 8, [20, 12], 1, { acc: 4 }));
    expect(verdicts).toEqual([
      expect.objectContaining({ s: 6, decidedBy: "compass" }),
    ]);
  });

  it("does not read the compass indoors, nor a reading taken before the scan", () => {
    const indoor = harness();
    indoor.feed(circle(0, 5, [20, 12], 1, { acc: 12 }));
    indoor.pin(codeSeen([0, 0], 90), 6, level(30));
    indoor.checks.compass(
      alignmentNorthBearingDeg(ODOM_TO_WORLD.toArray()),
      T0 + 6000,
    );
    expect(indoor.feed(circle(6, 20, [20, 12], 1, { acc: 12 }))).toEqual([]);
    expect(indoor.checks.snapshot()[0]).toMatchObject({
      turnChannel: "fallback-yaw",
    });
    const before = harness();
    before.checks.compass(
      alignmentNorthBearingDeg(ODOM_TO_WORLD.toArray()),
      T0,
    );
    before.pin(codeSeen([0, 0], 90), 6, level(30));
    expect(before.checks.snapshot()[0]?.compassTurnDeg).toBeNull();
  });

  // Why: after an odometry restart the pin names a place in a dead frame.
  // The check ends; the next voted lock pins again and folds only the fixes
  // stored after the change.
  it("drops every pin at a frame change, and a new pin folds only what came after it", () => {
    const h = harness();
    h.pin(codeSeen([0, 40]), 0);
    h.feed(circle(0, 30, [20, 50], 6));
    h.checks.frameChanged(selectGpsPositions(h.store.getState()).length);
    expect(h.checks.snapshot()).toEqual([]);
    h.feed(circle(31, 40, [20, 50], 6));
    h.pin(codeSeen([0, 40]), 41);
    h.checks.update(h.view(), T0 + 41_000);
    // The new pin's evidence starts at the frame change (second 31).
    expect(h.checks.snapshot()[0]!.spanS).toBeCloseTo(9, 6);
  });

  // Why: the recovery resets the GPS history and re-feeds the device fixes;
  // a check still running for another code must not double-count them.
  it("folds the history again when it shrinks (a reset), without counting a fix twice", () => {
    const h = harness();
    const fixes = circle(0, 40, [20, 50], 6);
    h.pin(codeSeen([0, 40]), 0);
    h.feed(fixes);
    const before = h.checks.snapshot()[0]!;
    h.store.dispatch(resetGpsSessionData());
    h.store.dispatch(recordGpsEventBatch({ events: fixes }));
    h.checks.update(h.view(), T0 + 41_000);
    const after = h.checks.snapshot()[0]!;
    expect(after.samples).toBe(before.samples);
    expect(after.magnitudeM).toBeCloseTo(before.magnitudeM, 6);
  });

  // Why (§7j #15): the log must carry what the detector computed, so a
  // recording can say why a code was ignored.
  it("hands back the detector's inputs with a verdict", () => {
    const h = harness();
    h.pin(codeSeen([0, 40]), 0);
    for (const f of circle(0, 70, [20, 50], 6, { acc: 3 })) {
      h.store.dispatch(recordGpsEvent(f));
    }
    const [v] = h.checks.update(h.view(), T0 + 70_000);
    expect(v).toMatchObject({ text: "text-lvl", levelId: "lvl" });
    expect(v!.evidence).toMatchObject({
      ruleVersion: MOVED_CODE_RULE_VERSION,
      decidedBy: "position",
      turnChannel: "settled-yaw",
      boundM: 20,
      settled: true,
      alignmentSampleCount: 300,
      storedAccuracyM: 3.5,
      deviceAccuracyMedianM: 3,
      deviceFixes: 71,
      outdoor: true,
      compassTurnDeg: null,
      sinceScanS: 70,
    });
    expect(v!.evidence.magnitudeM).toBeGreaterThan(35);
    expect(v!.evidence.spanS).toBe(70);
    expect(v!.evidence.spreadM).toBeGreaterThan(2);
    expect(v!.evidence.displacementM).toHaveLength(2);
    expect(Number.isFinite(v!.evidence.yawDeg)).toBe(true);
  });

  it("pins a code once per frame, and refuses a level without geo or a zero", () => {
    const h = harness();
    h.pin(codeSeen([0, 0]), 0);
    h.pin(codeSeen([0, 40]), 5);
    expect(h.checks.snapshot()).toHaveLength(1);
    h.checks.pin({
      text: "t2",
      levelId: "nogeo",
      level: { version: 1, qr: { physicalSizeM: 0.2 } },
      qrPoseWorld: codeSeen([0, 0]),
      atMs: T0,
      zero: ZERO,
    });
    h.checks.pin({
      text: "t3",
      levelId: "nozero",
      level: level(),
      qrPoseWorld: codeSeen([0, 0]),
      atMs: T0,
      zero: null,
    });
    expect(h.checks.snapshot().map((c) => c.levelId)).toEqual(["lvl"]);
  });
});

describe("createMovedCodeChecks - a tour switch", () => {
  // Why (§7j #13): the checks belong to the open tour; a check of a closed
  // tour's code left running could veto it - and reset the new tour's GPS
  // history with the recovery.
  it("ends every check at clear(), and pins again afterwards", () => {
    const h = harness();
    h.pin(codeSeen([0, 40]), 0);
    h.checks.clear();
    expect(h.checks.snapshot()).toEqual([]);
    expect(h.feed(circle(0, 90, [20, 50], 6))).toEqual([]);
    h.pin(codeSeen([0, 40]), 91);
    expect(h.checks.snapshot()).toHaveLength(1);
  });
});
