/**
 * The QR-first M0 replay instrument's own tests (QR-first alignment plan
 * 2026-10-14-0445, §3 M0 and §7 #1-#8; the harness is
 * `test-support/qr-hold-replay.ts`). Default run, no private data: every
 * fixture here is synthetic and checked against an independent oracle (the
 * production vote builder, the production keep-alive and sink, the core's
 * compass reader) before any number of the opt-in suite is trusted.
 *
 * Why this file matters: the M0 question - does the alignment leave a held
 * code because GPS PULLS it, or because the frozen kept pose stops matching
 * drifting odometry - is answered by splitting one residual into two parts.
 * A sign or frame slip in that split, or a regeneration that does not match
 * what the phone cast, would make the attribution measure the instrument
 * instead of the session.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  arNorthBearingDeg,
  calcGpsCoords,
  calcRelativeCoordsInMeters,
  webxrToNUE,
  type Quaternion,
  type Vector3,
} from "gps-plus-slam-app-framework/core";
import {
  buildQrGpsVotes,
  type QrGeoPose,
} from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import {
  selectAlignmentMatrix,
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";

import { createQrVoteKeepAlive } from "./qr-vote-keep-alive.js";
import {
  VIEWER_KEEP_ALIVE_FADE_MS,
  VIEWER_KEEP_ALIVE_HOLD_MS,
  VIEWER_SYNTHETIC_ACCURACY_M,
  VIEWER_VOTE_BASELINE_M,
  VIEWER_VOTE_COUNT,
} from "./qr-viewer-mode.js";
import { createTourViewerStore } from "./tour-viewer-session.js";
import { startEntryVoteSink } from "./viewer-vote-sink.js";
import {
  codeAtGeo,
  codeInWorld,
  createDistanceHold,
  createReplayStore,
  isSyntheticEvent,
  poseNoiseFloor,
  replayVotePath,
  resightingSplit,
  TODAY_KNOBS,
  withCompassBias,
  type ReplayEvent,
} from "./test-support/qr-hold-replay.js";
import {
  buildScenario,
  SCENARIO_CODE_GEO,
  SCENARIO_CODE_POSE,
  SCENARIO_TRUE_ALIGNMENT,
  SCENARIO_ZERO,
  type ScenarioParams,
} from "./test-support/qr-hold-scenario.js";

// The core's geodesy is licence-gated; a store activates it.
createTourViewerStore();

const ZERO = { lat: 48.137, lon: 11.575 };
const EPOCH_MS = 1_790_000_000_000;
const rad = (d: number): number => (d * Math.PI) / 180;
const yawQuat = (a: number): Quaternion => [
  0,
  Math.sin(a / 2),
  0,
  Math.cos(a / 2),
];
const nueToWebxr = (v: Vector3): Vector3 => [v[2], v[1], -v[0]];

/** world NUE = Ry(yaw) * odomNue + t, column-major like the store's. */
function alignment(yawDeg: number, t: Vector3): number[] {
  const c = Math.cos(rad(yawDeg));
  const s = Math.sin(rad(yawDeg));
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, t[0], t[1], t[2], 1];
}

const TRUE_YAW = 40;
const TRUE_T: Vector3 = [5, 400, -8];
const A_TRUE = alignment(TRUE_YAW, TRUE_T);
/** The code's odometry NUE position and its true world NUE. */
const CODE_ODOM_NUE: Vector3 = [3, 1.5, -2];
const CODE_HEADING = 70;
function mapNue(a: readonly number[], o: Vector3): Vector3 {
  return [
    a[0]! * o[0] + a[4]! * o[1] + a[8]! * o[2] + a[12]!,
    a[1]! * o[0] + a[5]! * o[1] + a[9]! * o[2] + a[13]!,
    a[2]! * o[0] + a[6]! * o[1] + a[10]! * o[2] + a[14]!,
  ];
}
const CODE_WORLD = mapNue(A_TRUE, CODE_ODOM_NUE);
const CODE_GEO: QrGeoPose = {
  ...calcGpsCoords(ZERO, CODE_WORLD),
  alt: CODE_WORLD[1],
  headingDeg: CODE_HEADING,
};
/** A vertical poster at heading h, in raw WebXR, as the stable pose gives
 *  it (the vote-strength harness's derivation). */
const KEPT: Pose = {
  position: nueToWebxr(CODE_ODOM_NUE),
  rotation: yawQuat(Math.PI / 2 - rad(CODE_HEADING) - rad(TRUE_YAW)),
};

/** A pose moved by `dNue` (odometry NUE, m) and turned by `turnDeg` about Up. */
function moved(p: Pose, dNue: Vector3, turnDeg: number): Pose {
  const q = yawQuat(rad(turnDeg));
  const [x, y, z, w] = p.rotation;
  const [qx, qy, qz, qw] = q;
  const rotation: Quaternion = [
    qw * x + qx * w + qy * z - qz * y,
    qw * y - qx * z + qy * w + qz * x,
    qw * z + qx * y - qy * x + qz * w,
    qw * w - qx * x - qy * y - qz * z,
  ];
  // The position turns about the pose's own position: only the rotation
  // changes there, and dNue moves it.
  const pos = webxrToNUE(p.position);
  return {
    position: nueToWebxr([
      pos[0] + dNue[0],
      pos[1] + dNue[1],
      pos[2] + dNue[2],
    ]),
    rotation,
  };
}

describe("the fixture (an independent oracle first)", () => {
  it("pairs every production vote of the kept pose with its geo point through the true alignment", () => {
    // Why this matters: every metric below is "zero when the alignment is
    // right"; that statement is only worth something if "right" is defined by
    // the production vote builder, not by the metric's own maths.
    const votes = buildQrGpsVotes({
      qrPoseWorld: KEPT,
      sizeM: 0.2,
      qrGeo: CODE_GEO,
      syntheticAccuracyM: 5,
      baselineM: 30,
      count: 16,
      timestamp: EPOCH_MS,
    });
    for (const v of votes) {
      const world = mapNue(A_TRUE, webxrToNUE(v.odomPosition));
      const geo = calcRelativeCoordsInMeters(
        ZERO,
        { lat: v.rawGpsPoint.latitude, lon: v.rawGpsPoint.longitude },
        v.rawGpsPoint.altitude ?? 0,
      );
      expect(Math.hypot(world[0] - geo[0], world[2] - geo[2])).toBeLessThan(
        2e-3,
      );
    }
  });
});

describe("the re-sighting split (pull against drift)", () => {
  it("reads zero everywhere when the alignment is right and the odometry did not drift", () => {
    // Why this matters: a non-zero floor here would be read as GPS pull or
    // drift in every session.
    const s = resightingSplit({
      alignment: A_TRUE,
      fresh: KEPT,
      kept: KEPT,
      geo: CODE_GEO,
      zero: ZERO,
    });
    for (const r of [s.total, s.pull, s.drift]) {
      expect(r.m).toBeLessThan(2e-3);
      expect(Math.abs(r.deg)).toBeLessThan(0.01);
    }
  });

  it("puts an alignment shifted by GPS into PULL, not drift", () => {
    // Why: GPS can only act through the alignment; the kept pose is what the
    // keep-alive re-votes, so a shifted alignment shows as kept-vs-geo.
    const shifted = alignment(TRUE_YAW, [TRUE_T[0] + 1, TRUE_T[1], TRUE_T[2]]);
    const s = resightingSplit({
      alignment: shifted,
      fresh: KEPT,
      kept: KEPT,
      geo: CODE_GEO,
      zero: ZERO,
    });
    expect(s.pull.m).toBeCloseTo(1, 3);
    expect(s.pull.n).toBeCloseTo(1, 3);
    expect(s.total.m).toBeCloseTo(1, 3);
    expect(s.drift.m).toBeLessThan(2e-3);
  });

  it("puts odometry that moved under a frozen kept pose into DRIFT, not pull", () => {
    // Why: the owner's "a metre off, slightly turned" can come from odometry
    // alone - the alignment still honours the kept pose exactly, but the
    // phone now measures the same physical code somewhere else.
    const fresh = moved(KEPT, [0.6, 0, 0.53], 2);
    const s = resightingSplit({
      alignment: A_TRUE,
      fresh,
      kept: KEPT,
      geo: CODE_GEO,
      zero: ZERO,
    });
    expect(s.pull.m).toBeLessThan(2e-3);
    expect(Math.abs(s.pull.deg)).toBeLessThan(0.01);
    expect(s.drift.m).toBeCloseTo(Math.hypot(0.6, 0.53), 3);
    // A turn of the pose to the left (counterclockwise from above) lowers
    // the bearing of its +x axis.
    expect(s.drift.deg).toBeCloseTo(-2, 2);
    expect(s.total.m).toBeCloseTo(Math.hypot(0.6, 0.53), 3);
    expect(Math.abs(s.total.deg)).toBeCloseTo(2, 2);
  });

  it("reads an alignment turned about the code as a pure heading pull", () => {
    // Why: the M0 heading verdicts (§7 #2, the compass) need the yaw part to
    // be separable from the position part.
    // Turn the true alignment by 3 degrees about the code's world position.
    const turned = alignment(TRUE_YAW + 3, [0, 0, 0]);
    const at = mapNue(turned, CODE_ODOM_NUE);
    turned[12] = CODE_WORLD[0] - at[0];
    turned[13] = CODE_WORLD[1] - at[1];
    turned[14] = CODE_WORLD[2] - at[2];
    const s = resightingSplit({
      alignment: turned,
      fresh: KEPT,
      kept: KEPT,
      geo: CODE_GEO,
      zero: ZERO,
    });
    expect(s.pull.m).toBeLessThan(2e-3);
    expect(Math.abs(s.pull.deg)).toBeCloseTo(3, 2);
  });

  it("decomposes exactly: total = pull + the alignment's turn of the drift (property)", () => {
    // Why: the split must account for the whole residual, or a residue would
    // be silently attributed to neither cause.
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        (dYaw, tn, te, dn, de, dTurn) => {
          const a = alignment(TRUE_YAW + dYaw, [
            TRUE_T[0] + tn,
            TRUE_T[1],
            TRUE_T[2] + te,
          ]);
          const fresh = moved(KEPT, [dn, 0, de], dTurn);
          const s = resightingSplit({
            alignment: a,
            fresh,
            kept: KEPT,
            geo: CODE_GEO,
            zero: ZERO,
          });
          // The drift vector turned by the alignment's yaw.
          const c = Math.cos(rad(TRUE_YAW + dYaw));
          const sn = Math.sin(rad(TRUE_YAW + dYaw));
          const rn = c * s.drift.n + sn * s.drift.e;
          const re = -sn * s.drift.n + c * s.drift.e;
          expect(s.total.n).toBeCloseTo(s.pull.n + rn, 2);
          expect(s.total.e).toBeCloseTo(s.pull.e + re, 2);
          const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
          expect(wrap(s.total.deg - s.pull.deg - s.drift.deg)).toBeCloseTo(
            0,
            2,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("agrees with the code placed through the alignment and read from the geo directly", () => {
    // Why: the opt-in suite also reports the code's place at moments with no
    // re-sighting; those two primitives are the split's building blocks.
    const placed = codeInWorld(KEPT, A_TRUE);
    const truth = codeAtGeo(CODE_GEO, ZERO);
    expect(Math.hypot(placed.n - truth.n, placed.e - truth.e)).toBeLessThan(
      2e-3,
    );
    expect(placed.axisBearingDeg).toBeCloseTo(CODE_HEADING, 2);
    expect(truth.axisBearingDeg).toBeCloseTo(CODE_HEADING, 6);
  });
});

describe("the fresh pose's noise floor", () => {
  it("reports the spread of single-frame poses around their median", () => {
    // Why: drift below the measurement's own scatter is not drift; the
    // verdict compares against this floor.
    const poses = [0, 0.01, -0.01, 0.02, -0.02, 0.03, -0.03, 0.1].map((d) =>
      moved(KEPT, [d, 0, 0], d * 10),
    );
    const f = poseNoiseFloor(poses);
    expect(f.n).toBe(8);
    expect(f.p50M).toBeGreaterThan(0.009);
    expect(f.p50M).toBeLessThan(0.031);
    expect(f.p90M).toBeGreaterThanOrEqual(f.p50M);
    expect(f.p90Deg).toBeGreaterThan(0.1);
  });

  it("is NaN-free and empty-safe", () => {
    const f = poseNoiseFloor([]);
    expect(f.n).toBe(0);
    expect(Number.isNaN(f.p50M)).toBe(true);
  });
});

describe("the compass knob", () => {
  it("turns the core's AR-north bearing by exactly the bias, and leaves it at 0", () => {
    // Why: the compass is a cause and a knob (§7 #2); a bias applied with the
    // wrong sign or axis would measure a different phone.
    const k = Math.SQRT1_2;
    const reading = {
      quaternion: [
        Math.cos(-0.3) * k,
        Math.sin(-0.3) * k,
        Math.sin(-0.3) * k,
        Math.cos(-0.3) * k,
      ] as Quaternion,
      referenceFrame: "device" as const,
      screenAngleDeg: 0,
      sampleTimestamp: EPOCH_MS,
    };
    const odomRotation = yawQuat(0.4);
    const base = arNorthBearingDeg(reading.quaternion, odomRotation)!;
    for (const bias of [0, 10, 30, -10]) {
      const b = arNorthBearingDeg(
        withCompassBias(reading, bias).quaternion,
        odomRotation,
      )!;
      const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
      expect(wrap(b - base - bias)).toBeCloseTo(0, 4);
    }
  });
});

describe("telling device fixes from synthetic votes", () => {
  it("reads the source stamp and the vote id prefixes", () => {
    // Why: the replay strips every synthetic event of a recorded batch and
    // regenerates it; a device fix taken for a vote would vanish from GPS.
    const [vote] = buildQrGpsVotes({
      qrPoseWorld: KEPT,
      sizeM: 0.2,
      qrGeo: CODE_GEO,
      syntheticAccuracyM: 5,
      baselineM: 30,
      count: 3,
      timestamp: EPOCH_MS,
    });
    const fix: RecordGpsEventPayload = {
      odomPosition: [0, 0, 0],
      odomRotation: [0, 0, 0, 1],
      rawGpsPoint: {
        id: "gps-12",
        latitude: ZERO.lat,
        longitude: ZERO.lon,
        latLongAccuracy: 20,
        timestamp: EPOCH_MS,
      },
    };
    expect(isSyntheticEvent(vote!)).toBe(true);
    expect(isSyntheticEvent(fix)).toBe(false);
    // An unstamped keep-alive vote (an older build) is still a vote.
    const { source: _source, ...unstamped } = vote!.rawGpsPoint as {
      source?: unknown;
    } & RecordGpsEventPayload["rawGpsPoint"];
    expect(
      isSyntheticEvent({
        ...vote!,
        rawGpsPoint: { ...unstamped, id: "qr-keep-1-0" },
      }),
    ).toBe(true);
  });
});

describe("the distance hold (lever L1, measured from the kept pose)", () => {
  it("holds while the reach is short, fades over distance, and never by time", () => {
    // Why: L1 is the plan's answer to "drift grows with distance walked,
    // not with time" (§7 #1); its three measures must differ exactly as
    // defined - a walk out and back is short in reach, long in path.
    const hold = createDistanceHold({ measure: "reach", holdM: 10, fadeM: 20 });
    hold.keep([0, 0]);
    expect(hold.share([3, 4])).toBe(1); // 5 m
    expect(hold.share([0, 20])).toBeCloseTo(0.5, 9); // 20 m: half the fade
    expect(hold.share([0, 40])).toBe(0);
    expect(hold.share([0, 1])).toBe(1); // back near the code: reach is short

    const excursion = createDistanceHold({
      measure: "excursion",
      holdM: 10,
      fadeM: 20,
    });
    excursion.keep([0, 0]);
    excursion.share([0, 20]);
    expect(excursion.share([0, 1])).toBeCloseTo(0.5, 9); // remembers 20 m

    const path = createDistanceHold({ measure: "path", holdM: 10, fadeM: 20 });
    path.keep([0, 0]);
    for (let i = 1; i <= 20; i += 1) path.share([i % 2 === 0 ? 0 : 1, 0]);
    expect(path.share([0, 0])).toBeCloseTo(1 - (20 - 10) / 20, 9); // 20 m walked
  });
});

/** A small visitor session: a zero, an entry, fixes, three voted locks,
 *  then `afterS` seconds of fixes while the phone wanders. */
function syntheticSession(afterS: number): ReplayEvent[] {
  const events: ReplayEvent[] = [
    { kind: "zero", zero: ZERO },
    { kind: "entry" },
  ];
  const fixAt = (s: number, n: number, e: number): ReplayEvent => {
    const world: Vector3 = [
      CODE_WORLD[0] - 2 + n,
      CODE_WORLD[1] - 0.1,
      CODE_WORLD[2] + e,
    ];
    const d: Vector3 = [
      world[0] - TRUE_T[0],
      world[1] - TRUE_T[1],
      world[2] - TRUE_T[2],
    ];
    const c = Math.cos(rad(-TRUE_YAW));
    const sn = Math.sin(rad(-TRUE_YAW));
    const odomNue: Vector3 = [
      c * d[0] + sn * d[2],
      d[1],
      -sn * d[0] + c * d[2],
    ];
    const ll = calcGpsCoords(ZERO, [world[0] + 4, world[1], world[2] + 3]);
    return {
      kind: "fix",
      arrivalMs: EPOCH_MS + s * 1000 + 200,
      payload: {
        odomPosition: nueToWebxr(odomNue),
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: `gps-${String(s)}`,
          latitude: ll.lat,
          longitude: ll.lon,
          altitude: world[1],
          latLongAccuracy: 12,
          timestamp: EPOCH_MS + s * 1000,
        },
      },
    };
  };
  for (let s = 0; s < 10; s += 1) events.push(fixAt(s, s * 0.1, 0));
  for (let i = 0; i < 3; i += 1) {
    events.push({
      kind: "lock",
      text: "code-a",
      atMs: EPOCH_MS + 10_000 + i * 125,
      detectionPose: KEPT,
      voted: {
        pose: KEPT,
        geo: CODE_GEO,
        sizeM: 0.2,
        stampMs: EPOCH_MS + 10_000 + i * 125,
      },
    });
  }
  for (let s = 11; s < 11 + afterS; s += 1) {
    events.push(fixAt(s, 0.5 * Math.sin(s / 9), 0.5 * Math.cos(s / 7)));
  }
  return events;
}

/** The production path by hand, in viewer-placement's order: the entry's
 *  sink, a lock's ring then its keep, every fix with the keep-alive's ring. */
function productionPath(
  events: readonly ReplayEvent[],
  holdMs: number,
  fadeMs: number,
) {
  const store = createReplayStore();
  const dispatched: unknown[] = [];
  const recording = {
    dispatch: (a: Parameters<typeof store.dispatch>[0]) => {
      dispatched.push(a);
      return store.dispatch(a);
    },
    getState: store.getState,
  };
  let sink: ReturnType<typeof startEntryVoteSink> | null = null;
  const keepAlive = createQrVoteKeepAlive({
    holdMs,
    fadeMs,
    votesPerFix: VIEWER_VOTE_COUNT,
    baselineM: VIEWER_VOTE_BASELINE_M,
    syntheticAccuracyM: VIEWER_SYNTHETIC_ACCURACY_M,
  });
  for (const e of events) {
    if (e.kind === "zero") {
      recording.dispatch(setZeroPos(e.zero));
    } else if (e.kind === "entry") {
      sink = startEntryVoteSink(recording);
    } else if (e.kind === "fix") {
      const ring = keepAlive.votesForFix({
        atMs: e.arrivalMs,
        stampMs: e.payload.rawGpsPoint.timestamp,
      });
      sink!.recordFix(e.payload, ring);
    } else if (e.kind === "lock" && e.voted !== undefined) {
      sink!.castLockVotes(
        buildQrGpsVotes({
          qrPoseWorld: e.voted.pose,
          sizeM: e.voted.sizeM,
          qrGeo: e.voted.geo,
          syntheticAccuracyM: VIEWER_SYNTHETIC_ACCURACY_M,
          baselineM: VIEWER_VOTE_BASELINE_M,
          count: VIEWER_VOTE_COUNT,
          timestamp: e.voted.stampMs,
        }),
      );
      keepAlive.keep(
        {
          text: e.text,
          qrPoseWorld: e.voted.pose,
          qrGeo: e.voted.geo,
          sizeM: e.voted.sizeM,
        },
        e.atMs,
      );
    }
  }
  return { store, dispatched };
}

// Whole-store replays: seconds each, more on a loaded machine.
describe(
  "the vote-path replay against the production path",
  { timeout: 60_000 },
  () => {
    it("dispatches exactly what the production sink and keep-alive dispatch, at today's values", () => {
      // Why this matters: the brief's correctness rule - a replay that
      // disagrees with the phone is a broken instrument. Here the "phone" is
      // the production sink and keep-alive driven by hand in the viewer's own
      // order; the replay must reproduce every dispatched action and the final
      // alignment to the bit. (Hold only: 30 s of fixes after the lock.)
      expect(TODAY_KNOBS.holdMs).toBe(VIEWER_KEEP_ALIVE_HOLD_MS);
      expect(TODAY_KNOBS.fadeMs).toBe(VIEWER_KEEP_ALIVE_FADE_MS);
      const events = syntheticSession(30);
      const production = productionPath(
        events,
        TODAY_KNOBS.holdMs,
        TODAY_KNOBS.fadeMs,
      );
      const replay = replayVotePath(events, TODAY_KNOBS);
      expect(JSON.parse(JSON.stringify(replay.dispatched))).toEqual(
        JSON.parse(JSON.stringify(production.dispatched)),
      );
      expect(selectAlignmentMatrix(replay.store.getState())).toEqual(
        selectAlignmentMatrix(production.store.getState()),
      );
    });

    it("follows the production keep-alive through its fade and its end, at a short hold", () => {
      // Why: the fade is where the credit accumulator and the arrival clock
      // matter; a 10 s hold and 10 s fade cover both in 40 s of fixes.
      const events = syntheticSession(40);
      const knobs = { ...TODAY_KNOBS, holdMs: 10_000, fadeMs: 10_000 };
      const production = productionPath(events, knobs.holdMs, knobs.fadeMs);
      const replay = replayVotePath(events, knobs);
      expect(JSON.parse(JSON.stringify(replay.dispatched))).toEqual(
        JSON.parse(JSON.stringify(production.dispatched)),
      );
      // The fade cast partial rings, and the end cast none.
      const ringSizes = [...replay.castAt.values()].map((v) => v.length);
      expect(ringSizes.some((n) => n > 0 && n < VIEWER_VOTE_COUNT)).toBe(true);
      const lastFix = events.length - 1;
      expect(replay.castAt.has(lastFix)).toBe(false);
    });

    it("with GPS ignored, stores no device fix but still casts the keep-alive per fix", () => {
      // Why: the pre-registered indoor bar is "no worse than with GPS
      // ignored"; that arm must keep the code's own schedule.
      const events = syntheticSession(20);
      const off = replayVotePath(events, { ...TODAY_KNOBS, gps: "off" });
      const on = replayVotePath(events, TODAY_KNOBS);
      const stored = (r: typeof on) =>
        r.store.getState().gpsData?.gpsEvents?.gpsPositions.length ?? 0;
      // GPS off stores only votes: 3 locks of 16, then a ring per fix.
      expect(stored(off)).toBe(3 * VIEWER_VOTE_COUNT + 20 * VIEWER_VOTE_COUNT);
      expect(stored(on) - stored(off)).toBe(
        events.filter((e) => e.kind === "fix").length,
      );
    });
  },
);

// Whole-store replays: seconds each, more on a loaded machine.
describe(
  "the synthetic scenarios (the M0 synthetic arms' generator)",
  { timeout: 60_000 },
  () => {
    it("pairs the scenario code's votes with its geo through the true alignment", () => {
      // Why: the synthetic arms call the stored geo the truth; that holds only
      // if the code's odometry pose and geo agree through the true alignment.
      const votes = buildQrGpsVotes({
        qrPoseWorld: SCENARIO_CODE_POSE,
        sizeM: 0.16,
        qrGeo: SCENARIO_CODE_GEO,
        syntheticAccuracyM: 5,
        baselineM: 30,
        count: 16,
        timestamp: EPOCH_MS,
      });
      for (const v of votes) {
        const world = mapNue(
          SCENARIO_TRUE_ALIGNMENT,
          webxrToNUE(v.odomPosition),
        );
        const geo = calcRelativeCoordsInMeters(
          SCENARIO_ZERO,
          { lat: v.rawGpsPoint.latitude, lon: v.rawGpsPoint.longitude },
          0,
        );
        expect(Math.hypot(world[0] - geo[0], world[2] - geo[2])).toBeLessThan(
          2e-3,
        );
      }
    });

    const still = { perM: 0, bearingDeg: 90, yawDegPerMin: 0 };
    const exactGps = {
      kind: "synthetic" as const,
      biasM: 0,
      biasBearingDeg: 0,
      wanderM: 0,
      wanderTauS: 60,
      whiteM: 0,
      accuracyM: 5,
    };
    const base: ScenarioParams = {
      seed: 1,
      preScanS: 5,
      afterS: 30,
      walk: "kitchen",
      speedMps: 0.5,
      gps: exactGps,
      odometry: still,
    };
    const splitAtEnd = (p: ScenarioParams, knobs: typeof TODAY_KNOBS) => {
      const sc = buildScenario(p);
      const r = replayVotePath(sc.events, knobs);
      const last = sc.events.at(-1)!;
      const at = last.kind === "fix" ? last.payload.rawGpsPoint.timestamp : 0;
      return {
        sc,
        at,
        split: resightingSplit({
          alignment: selectAlignmentMatrix(r.store.getState())!,
          fresh: sc.freshPoseAt(at),
          kept: sc.freshPoseAt(sc.scanMs),
          geo: SCENARIO_CODE_GEO,
          zero: sc.zero,
        }),
      };
    };

    it("reads no pull and no drift with exact GPS and exact odometry", () => {
      // Why: the floor of every synthetic arm. (The zero is the first fix,
      // so the session frame is the same as the truth's up to that offset.)
      const { split } = splitAtEnd(base, TODAY_KNOBS);
      expect(split.pull.m).toBeLessThan(0.02);
      expect(split.drift.m).toBeLessThan(1e-6);
      expect(split.total.m).toBeLessThan(0.02);
    });

    it("measures the injected odometry drift as drift, and none of it as pull with GPS ignored", () => {
      // Why: the attribution needs the drift channel to read exactly what the
      // generator injected (2 % of the path, due east) and the pull channel
      // to stay silent when only the code's own votes shape the alignment.
      const p: ScenarioParams = {
        ...base,
        odometry: { perM: 0.02, bearingDeg: 90, yawDegPerMin: 0 },
      };
      const { sc, at, split } = splitAtEnd(p, { ...TODAY_KNOBS, gps: "off" });
      expect(split.drift.e).toBeCloseTo(0.02 * sc.pathAt(at), 3);
      expect(Math.abs(split.drift.n)).toBeLessThan(1e-6);
      expect(split.pull.m).toBeLessThan(0.02);
      expect(split.total.m).toBeCloseTo(split.drift.m, 1);
    });

    it("measures yaw drift as a turn of the fresh pose", () => {
      // Why: the owner saw the markers "slightly rotated"; a yaw drift must
      // show in the drift channel's degrees with the generator's sign.
      const p: ScenarioParams = {
        ...base,
        odometry: { perM: 0, bearingDeg: 90, yawDegPerMin: 2 },
      };
      const { sc, at, split } = splitAtEnd(p, { ...TODAY_KNOBS, gps: "off" });
      const minutes = (at - sc.scanMs) / 60_000;
      expect(split.drift.deg).toBeCloseTo(-2 * minutes, 3);
    });
  },
);
