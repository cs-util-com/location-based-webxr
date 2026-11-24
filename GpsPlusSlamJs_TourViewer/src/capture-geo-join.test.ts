import { describe, expect, it } from "vitest";
import {
  Matrix4 as ThreeMatrix4,
  Quaternion as ThreeQuaternion,
  Vector3 as ThreeVector3,
} from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import {
  assessReplayedJoin,
  preflightCaptureJoin,
  computeCaptureGeoJoin,
  createCapturePickTracker,
  type CaptureWorldPose,
  type ReplayedJoinState,
} from "./capture-geo-join";

// Activates the library's gated math (fusedGpsFromOdom) — the documented
// test path this suite already uses elsewhere.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

/**
 * Why these tests matter (geo-join plan Rev 2): every decline reason in the
 * assessment IS the product's fallback contract — a wrong `ok` places a
 * coherent-looking cloud of photos at wrong positions (the cold review's
 * findings 3 and 8), and a wrong decline silently bakes no spot at all.
 * The transform test pins the frame contract end-to-end with hand-checkable
 * numbers: identity-rotation alignment with a pure translation, so the
 * expected geo offsets are readable by eye.
 */

const IDENTITY16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

/** Column-major 4x4: identity rotation + translation [tN, tU, tE]. */
function translation(tN: number, tU: number, tE: number): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tN, tU, tE, 1];
}

function baseState(overrides?: {
  matrix?: readonly number[];
  points?: ReplayedJoinState["gpsData"] extends infer G
    ? G extends { odometryPath: { points: infer P } }
      ? P
      : never
    : never;
  pairCount?: number;
  alignmentRotation?: readonly [number, number, number, number];
}): ReplayedJoinState {
  return {
    gpsData: {
      zero: { lat: 47.5, lon: 8.7 },
      gpsEvents: {
        gpsPositions: new Array<unknown>(overrides?.pairCount ?? 5).fill({}),
        alignmentMatrix: overrides?.matrix ?? translation(2, 0, 3),
        alignmentRotation: overrides?.alignmentRotation ?? [0, 0, 0, 1],
        gpsAccuracyMedian: 4.2,
      },
      odometryPath: {
        points: overrides?.points ?? [
          {
            imageFile: "images/a.jpg",
            position: [1, 0, 0],
            rotation: [0, 0, 0, 1],
            width: 640,
            height: 480,
          },
        ],
      },
    },
  };
}

const CURRENT_ERA = { odomCoordVersion: 5 };

describe("assessReplayForJoin", () => {
  it("accepts a solved current-era recording and reports its quality", () => {
    const verdict = assessReplayedJoin(baseState());
    expect(verdict).toEqual({
      ok: true,
      quality: { pairCount: 5, gpsAccuracyMedianM: 4.2 },
    });
  });

  it.each([
    [null],
    [{}],
    [{ odomCoordVersion: 2 }],
    [{ odomCoordVersion: null }],
    [{ odomCoordVersion: "9" }],
    [{ odomCoordVersion: 4.5 }],
  ])(
    "preflight declines a non-current-era recording (%o) BEFORE any replay — legacy actions without the RecorderApp migration double-convert every pose",
    (meta) => {
      expect(preflightCaptureJoin(meta, []).ok).toBe(false);
    },
  );

  it("preflight accepts the current era with no segmenting actions", () => {
    expect(preflightCaptureJoin(CURRENT_ERA, ["gpsData/setZeroPos"]).ok).toBe(
      true,
    );
  });

  it.each([
    ["gpsData/odometryTrackingRestarted", {}],
    ["gpsData/arLoopClosureDetected", {}],
    ["arSpaceCorrection/relocalizationObserved", {}],
    ["gpsData/odometryTrackingRestarted", { correctsRelocalization: true }],
    ["gpsData/arLoopClosureDetected", { correctsRelocalization: true }],
  ])(
    "declines when the recording contains %s (%o) - the final alignment is only valid for the last segment",
    (type, options) => {
      // Why this test matters: the join reads the shared segmenting list; a
      // tracking restart is declined even by a caller that corrects
      // relocalizations, and a caller reading raw poses (the splat
      // trainer) declines a relocalized recording too.
      const verdict = preflightCaptureJoin(CURRENT_ERA, [type], options);
      expect(verdict.ok).toBe(false);
      expect(verdict.ok ? "" : verdict.reason).toMatch(/relocalization/);
    },
  );

  it("a caller that corrects relocalizations accepts a relocalized recording", () => {
    // Why this test matters: once the recorder records every ARCore
    // relocalization, declining them would make most long walks unjoinable.
    expect(
      preflightCaptureJoin(
        CURRENT_ERA,
        ["arSpaceCorrection/relocalizationObserved"],
        { correctsRelocalization: true },
      ),
    ).toEqual({ ok: true });
  });

  it("declines a null gpsData, a missing zero, too few pairs, and no captures — each with plain words", () => {
    expect(assessReplayedJoin({ gpsData: null }).ok).toBe(false);
    const noZero = baseState();
    noZero.gpsData!.zero = null;
    expect(assessReplayedJoin(noZero).ok).toBe(false);
    expect(assessReplayedJoin(baseState({ pairCount: 2 })).ok).toBe(false);
    expect(assessReplayedJoin(baseState({ points: [] })).ok).toBe(false);
  });

  it("declines the IDENTITY alignment — the degenerate solve's default, not a real solve", () => {
    const verdict = assessReplayedJoin(baseState({ matrix: IDENTITY16 }));
    expect(verdict.ok).toBe(false);
  });
});

describe("computeCaptureGeoJoin", () => {
  it("maps captures through the alignment to geo with ABSOLUTE altitude", () => {
    // Alignment = translate [2, 0, 3] (NUE); capture at odom [1, 0, 0] →
    // aligned [3, 0, 3] = 3 m North, 3 m East of the zero, altitude 0
    // (absolute — fusedGpsFromOdom's documented contract).
    const [pose] = computeCaptureGeoJoin(baseState());
    expect(pose!.imageFile).toBe("images/a.jpg");
    expect(pose!.geo.lat).toBeGreaterThan(47.5); // moved North
    expect(pose!.geo.lon).toBeGreaterThan(8.7); // moved East
    expect(pose!.geo.altitude).toBe(0);
    expect(pose!.width).toBe(640);
    // ~3 m of latitude ≈ 2.7e-5 degrees; assert the right magnitude so a
    // units mistake (degrees-vs-metres) cannot pass.
    expect(pose!.geo.lat - 47.5).toBeGreaterThan(1e-5);
    expect(pose!.geo.lat - 47.5).toBeLessThan(1e-4);
  });

  // DIRECTIONAL tests, not component tests (this milestone's cold review,
  // finding 1): the state stores basis-CONJUGATED quaternions, and a
  // composition missing the trailing basis factor yawed every plane 90°
  // while every component-level assertion on identity captures stayed
  // green. These pin what the visitor actually sees: where the plane's
  // FRONT (+Z of PlaneGeometry) points in NUE (x=North, z=East).
  const front = (q: readonly [number, number, number, number]) =>
    new ThreeVector3(0, 0, 1)
      .applyQuaternion(new ThreeQuaternion(q[0], q[1], q[2], q[3]))
      .toArray();

  it("an identity capture (camera looking North) yields a SOUTH-facing plane front", () => {
    const [pose] = computeCaptureGeoJoin(baseState());
    const [fx, fy, fz] = front(pose!.rotationNue);
    expect(fx).toBeCloseTo(-1, 10); // South
    expect(fy).toBeCloseTo(0, 10);
    expect(fz).toBeCloseTo(0, 10);
  });

  it("the alignment's rotation composes on the LEFT (world frame), turning the front with it", () => {
    const state = baseState();
    const alignmentQ: [number, number, number, number] = [
      0,
      Math.SQRT1_2,
      0,
      Math.SQRT1_2,
    ];
    state.gpsData!.gpsEvents = {
      ...state.gpsData!.gpsEvents,
      alignmentRotation: alignmentQ,
    };
    const [pose] = computeCaptureGeoJoin(state);
    const expected = new ThreeVector3(-1, 0, 0) // the identity-capture front
      .applyQuaternion(
        new ThreeQuaternion(
          alignmentQ[0],
          alignmentQ[1],
          alignmentQ[2],
          alignmentQ[3],
        ),
      )
      .toArray();
    const got = front(pose!.rotationNue);
    expect(got[0]).toBeCloseTo(expected[0], 10);
    expect(got[1]).toBeCloseTo(expected[1], 10);
    expect(got[2]).toBeCloseTo(expected[2], 10);
  });

  it("a stored NUE yaw turns the front by the same yaw (yaws commute with the basis)", () => {
    const state = baseState();
    const yaw90: [number, number, number, number] = [
      0,
      Math.SQRT1_2,
      0,
      Math.SQRT1_2,
    ];
    state.gpsData!.odometryPath = {
      points: [
        {
          imageFile: "images/a.jpg",
          position: [1, 0, 0],
          rotation: yaw90,
        },
      ],
    };
    const [pose] = computeCaptureGeoJoin(state);
    const expected = new ThreeVector3(-1, 0, 0)
      .applyQuaternion(
        new ThreeQuaternion(yaw90[0], yaw90[1], yaw90[2], yaw90[3]),
      )
      .toArray();
    const got = front(pose!.rotationNue);
    expect(got[0]).toBeCloseTo(expected[0], 10);
    expect(got[1]).toBeCloseTo(expected[1], 10);
    expect(got[2]).toBeCloseTo(expected[2], 10);
  });

  it("throws when called without a passing assessment (programming error, not a fallback)", () => {
    expect(() => computeCaptureGeoJoin({ gpsData: null })).toThrow(
      /assess before computing/,
    );
  });
});

describe("computeCaptureGeoJoin — captures it must refuse to place", () => {
  it("drops a capture whose fused position is not finite", () => {
    // Why this test matters (PR #370 review): main.ts converts these back with
    // calcRelativeCoordsInMeters(zero, {lat, lon}, altitude, 0), so NUE y IS
    // absolute altitude. A capture that comes out of the solve non-finite -
    // or, on the old `?? 0` fallback, with no altitude at all - was placed at
    // sea level, which at any inland site is hundreds of metres under the
    // visitor's feet. And the status line still said "N photos at capture
    // spots", so the visitor was told the join SUCCEEDED while seeing
    // nothing. Dropping it lets the bake decline, which is the honest
    // outcome.
    const poses = computeCaptureGeoJoin(
      baseState({
        points: [
          {
            imageFile: "images/good.jpg",
            position: [1, 0, 0],
            rotation: [0, 0, 0, 1],
          },
          {
            imageFile: "images/bad.jpg",
            position: [Number.NaN, 0, 0],
            rotation: [0, 0, 0, 1],
          },
        ] as never,
      }),
    );

    expect(poses).toHaveLength(1);
    expect(poses[0]?.imageFile).toBe("images/good.jpg");
  });

  it("drops a capture whose ROTATION is not finite", () => {
    // Why this test matters (PR #377 review): the sibling of the test above,
    // and the axis its guard did not cover. A non-finite rotation component
    // sails past the position check, reaches `mesh.quaternion.copy(...)` in
    // `image-planes.ts`, and the plane silently never renders — while
    // `viewerPlanesInfo` still reports "N photos at capture spots", because
    // `count` is `meshes.length`. Identical visible outcome to the position
    // case: the visitor is told the join succeeded and sees nothing.
    const poses = computeCaptureGeoJoin(
      baseState({
        points: [
          {
            imageFile: "images/good.jpg",
            position: [1, 0, 0],
            rotation: [0, 0, 0, 1],
          },
          {
            imageFile: "images/bad-rotation.jpg",
            position: [1, 0, 0],
            rotation: [0, Number.NaN, 0, 1],
          },
          {
            imageFile: "images/short-rotation.jpg",
            position: [1, 0, 0],
            rotation: [0, 0, 1],
          },
          {
            // Finite AND length-4, but norm 0 — `Matrix4.compose` turns this
            // into the IDENTITY, so the capture would face East rather than
            // the direction it was taken (PR #378 review).
            imageFile: "images/zero-quat.jpg",
            position: [1, 0, 0],
            rotation: [0, 0, 0, 0],
          },
        ] as never,
      }),
    );

    expect(poses).toHaveLength(1);
    expect(poses[0]?.imageFile).toBe("images/good.jpg");
  });

  it("emits an exactly-unit rotation for a within-tolerance input", () => {
    // Why this test matters (PR #379 review): the guard called
    // `renormalizeUnitQuaternion` purely as a PREDICATE and then composed the
    // raw value, so a quaternion that is unit only to within the 1e-3
    // tolerance stayed slightly off-unit all the way to the mesh. The
    // framework's other two callers of this contract (`parseQrLevel`,
    // `mintQrGeoPose`) use the RETURNED value, which is what makes the
    // writer/reader round-trip exact rather than merely close.
    const scale = 1 + 5e-4; // inside the 1e-3 tolerance, so it is ACCEPTED
    const poses = computeCaptureGeoJoin(
      baseState({
        points: [
          {
            imageFile: "images/slightly-off-unit.jpg",
            position: [1, 0, 0],
            rotation: [0, 0, 0, scale],
          },
        ] as never,
      }),
    );

    expect(poses).toHaveLength(1);
    const q = poses[0]!.rotationNue;
    expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 9);
  });

  it("renormalizes the ALIGNMENT rotation, not just the per-capture one", () => {
    // Why this test matters (PR #380 review): the previous round fixed the
    // predicate-vs-value split for a capture's own rotation and left it in
    // place for the alignment rotation - where it matters more, because
    // `alignmentQuat` multiplies into EVERY plane. `image-planes.ts` does
    // `mesh.quaternion.copy(...)` with no normalise, and Three composes the
    // matrix as R*|q|^2, so an off-unit alignment scales the whole photo
    // constellation by up to ~0.2 % at the 1e-3 tolerance.
    const scale = 1 + 5e-4; // inside the tolerance, so it is ACCEPTED
    const poses = computeCaptureGeoJoin(
      baseState({ alignmentRotation: [0, 0, 0, scale] }),
    );

    expect(poses).toHaveLength(1);
    const q = poses[0]!.rotationNue;
    expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 9);
  });

  it("throws on a NON-FINITE alignment rotation rather than composing NaN", () => {
    // Why this test matters (PR #381 review): the first cut of the alignment
    // renormalisation checked only the NORM, and
    // `renormalizeUnitQuaternion` does not reject non-finite input - it
    // returns `[NaN, 0, 0, 1]` unchanged rather than `undefined`. So a NaN
    // alignment produced a NaN quaternion for EVERY plane while the sidecar
    // claimed the function failed loudly. This is defence-in-depth on an
    // exported function: `main.ts` gates on `assessReplayedJoin` first, but
    // nothing makes a caller do that.
    for (const bad of [
      [Number.NaN, 0, 0, 1],
      [0, 0, 1], // short: `w` is undefined, so Math.hypot yields NaN
    ] as const) {
      expect(() =>
        computeCaptureGeoJoin(baseState({ alignmentRotation: bad as never })),
      ).toThrow(/assess before computing/);
    }
  });

  it("keeps a capture whose altitude is legitimately zero", () => {
    // Why this test matters: zero is a VALID absolute altitude - the zero
    // reference sits at 0 in the fixture above - so the drop must key on
    // "missing or non-finite", never on "falsy". Getting that wrong would
    // silently discard every capture at a sea-level site.
    const poses = computeCaptureGeoJoin(baseState());
    expect(poses).toHaveLength(1);
    expect(poses[0]?.geo.altitude).toBe(0);
  });
});

describe("createCapturePickTracker - each photo through the first settled alignment after it (S-D11)", () => {
  // Why these tests matter (scan-pass plan S-D11, D33's rule for photos): a
  // photo taken early on a long walk placed through the END alignment is
  // off by as much as the walk drifted (D33 measured 8.4 m at 500 m with 1 %
  // drift, against 1.2 m through the first settled one). The tracker must
  // pick, per photo, the first alignment at or after the photo whose GPS
  // extent reached the floor, never the final one when a settled one came
  // earlier, and must never move a pick once it settled.
  const capture = (imageFile: string) => ({
    type: "gpsData/add2dImage",
    payload: { imageFile },
  });
  const tick = { type: "gpsData/recordGpsEvent", payload: {} };
  const extents = new WeakMap<object, number>();
  function stateAt(matrix: readonly number[] | null, extentM: number) {
    const state = {
      gpsData:
        matrix === null
          ? null
          : {
              zero: { lat: 47.5, lon: 8.7 },
              gpsEvents: {
                gpsPositions: [],
                alignmentMatrix: matrix,
                alignmentRotation: [0, 0, 0, 1] as const,
                gpsAccuracyMedian: 4,
              },
              odometryPath: { points: [] },
            },
    };
    extents.set(state, extentM);
    return state;
  }
  const tracker = () =>
    createCapturePickTracker({
      extentOf: (state) => extents.get(state) ?? 0,
    });

  it("moves an early photo's pick to the first settled alignment, then stops", () => {
    const t = tracker();
    t.observe(capture("images/early.jpg"), stateAt(translation(1, 0, 0), 10));
    t.observe(tick, stateAt(translation(2, 0, 0), 25));
    t.observe(tick, stateAt(translation(3, 0, 0), 45)); // first settled
    t.observe(tick, stateAt(translation(9, 0, 0), 400)); // the drifted end
    expect(t.alignmentFor("images/early.jpg")?.matrix).toEqual(
      translation(3, 0, 0),
    );
  });

  it("keeps a photo taken after the walk settled on its own moment", () => {
    const t = tracker();
    t.observe(tick, stateAt(translation(3, 0, 0), 60));
    t.observe(capture("images/late.jpg"), stateAt(translation(4, 0, 0), 70));
    t.observe(tick, stateAt(translation(9, 0, 0), 400));
    expect(t.alignmentFor("images/late.jpg")?.matrix).toEqual(
      translation(4, 0, 0),
    );
  });

  it("falls back to the last usable alignment when the walk never settles", () => {
    const t = tracker();
    t.observe(capture("images/short.jpg"), stateAt(translation(1, 0, 0), 5));
    t.observe(tick, stateAt(translation(2, 0, 0), 12));
    t.observe(tick, stateAt(null, 30)); // a moment without an alignment
    expect(t.alignmentFor("images/short.jpg")?.matrix).toEqual(
      translation(2, 0, 0),
    );
  });

  it("knows nothing of a photo it never saw", () => {
    expect(tracker().alignmentFor("images/none.jpg")).toBeUndefined();
  });

  it("computeCaptureGeoJoin refuses a picked alignment that never solved (identity) and uses the final one", () => {
    // Why (S1 milestone review #6): the store's alignment starts as the
    // IDENTITY, which the maturity rule counts as usable once a zero
    // exists. A walk whose GPS extent reaches the floor before the first
    // solve would otherwise pick it and place that photo at raw odometry
    // metres from the zero, baked into tour.json for good.
    const state = baseState({ matrix: translation(9, 0, 0) });
    const [viaPick] = computeCaptureGeoJoin(state, () => ({
      matrix: translation(0, 0, 0),
      rotation: [0, 0, 0, 1] as const,
    }));
    const north = (lat: number) => (lat - 47.5) * 111_320;
    expect(north(viaPick!.geo.lat)).toBeCloseTo(10, 0);
  });

  it("computeCaptureGeoJoin places a photo through its picked alignment, not the final one", () => {
    const state = baseState({ matrix: translation(9, 0, 0) });
    const picked = {
      matrix: translation(3, 0, 0),
      rotation: [0, 0, 0, 1] as const,
    };
    const [viaFinal] = computeCaptureGeoJoin(state);
    const [viaPick] = computeCaptureGeoJoin(state, () => picked);
    // Final: odom [1,0,0] + 9 m N = 10 m North; picked: 1 + 3 = 4 m North.
    const north = (lat: number) => (lat - 47.5) * 111_320;
    expect(north(viaFinal!.geo.lat)).toBeCloseTo(10, 0);
    expect(north(viaPick!.geo.lat)).toBeCloseTo(4, 0);
  });
});

describe("computeCaptureGeoJoin - across a relocalization", () => {
  // Why these tests matter: once the recorder records every ARCore
  // relocalization, a photo taken before one sits in the old raw frame
  // while the final alignment was solved in the new one. Placed raw, it
  // lands as far off as the jump moved (metres); dropped, the walk loses
  // its early photos. The join must move it by the recorded jump, exactly
  // as an independently corrected recording would place it.
  const B = new ThreeMatrix4().copy(WEBXR_TO_NUE);
  const turn = new ThreeQuaternion().setFromAxisAngle(
    new ThreeVector3(0, 1, 0),
    Math.PI / 6,
  );
  const jump = {
    t: 2000,
    tLast: 1990,
    lastPose: {
      position: [0, 1.5, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    },
    tPrev: null,
    prevPose: null,
    newPose: {
      position: [3, 1.5, -2] as [number, number, number],
      rotation: [turn.x, turn.y, turn.z, turn.w] as [
        number,
        number,
        number,
        number,
      ],
    },
  };
  /** The jump in NUE, built with three.js: B * (P_new * P_old^-1) * B^-1. */
  function oracleJumpNue(): ThreeMatrix4 {
    const pose = (p: typeof jump.lastPose) =>
      new ThreeMatrix4().compose(
        new ThreeVector3(...p.position),
        new ThreeQuaternion(...p.rotation),
        new ThreeVector3(1, 1, 1),
      );
    const inR = pose(jump.newPose).multiply(pose(jump.lastPose).invert());
    return B.clone().multiply(inR).multiply(B.clone().invert());
  }
  function moved(
    m: ThreeMatrix4,
    point: { position: readonly number[]; rotation: readonly number[] },
  ) {
    const p = new ThreeVector3(
      point.position[0],
      point.position[1],
      point.position[2],
    ).applyMatrix4(m);
    const q = new ThreeQuaternion()
      .setFromRotationMatrix(m)
      .multiply(
        new ThreeQuaternion(
          point.rotation[0],
          point.rotation[1],
          point.rotation[2],
          point.rotation[3],
        ),
      );
    return {
      position: [p.x, p.y, p.z] as [number, number, number],
      rotation: [q.x, q.y, q.z, q.w] as [number, number, number, number],
    };
  }
  const early = {
    imageFile: "images/early.jpg",
    position: [1, 0.2, -4] as [number, number, number],
    // A unit quaternion: the join refuses a rotation that is not one.
    rotation: (() => {
      const q = new ThreeQuaternion(0.1, 0.2, 0.05, 0.97).normalize();
      return [q.x, q.y, q.z, q.w] as [number, number, number, number];
    })(),
    capturedAt: 1500,
  };
  const late = {
    imageFile: "images/late.jpg",
    position: [6, 0, 2] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
    capturedAt: 2500,
  };
  function relocalized(
    points: NonNullable<ReplayedJoinState["gpsData"]>["odometryPath"]["points"],
  ): ReplayedJoinState {
    return {
      ...baseState({ points }),
      arSpaceCorrection: { observations: [jump] },
    };
  }
  /** How two placements differ: an empty list when they are the same. */
  function poseMismatches(
    actual: CaptureWorldPose | undefined,
    expected: CaptureWorldPose | undefined,
  ): string[] {
    if (actual === undefined || expected === undefined) return ["missing"];
    const out: string[] = [];
    if (Math.abs(actual.geo.lat - expected.geo.lat) > 1e-9) out.push("lat");
    if (Math.abs(actual.geo.lon - expected.geo.lon) > 1e-9) out.push("lon");
    if (Math.abs(actual.geo.altitude - expected.geo.altitude) > 1e-6) {
      out.push("altitude");
    }
    const a = new ThreeQuaternion(...actual.rotationNue);
    const e = new ThreeQuaternion(...expected.rotationNue);
    if (a.angleTo(e) > 1e-6) out.push("rotation");
    return out;
  }

  it("places a photo from before the jump where the oracle-corrected photo lands", () => {
    // The final alignment was fit after the jump (epoch 1).
    const [actual] = computeCaptureGeoJoin(relocalized([early]), undefined, 1);
    const [expected] = computeCaptureGeoJoin(
      baseState({ points: [{ ...early, ...moved(oracleJumpNue(), early) }] }),
    );
    expect(poseMismatches(actual, expected)).toEqual([]);
    // The jump is not a no-op: the raw placement is metres away.
    const [raw] = computeCaptureGeoJoin(baseState({ points: [early] }));
    expect(
      Math.abs(raw!.geo.lat - actual!.geo.lat) * 111_320 +
        Math.abs(raw!.geo.lon - actual!.geo.lon) * 75_000,
    ).toBeGreaterThan(1);
  });

  it("leaves a photo from after the jump as captured", () => {
    const [actual] = computeCaptureGeoJoin(relocalized([late]), undefined, 1);
    const [expected] = computeCaptureGeoJoin(baseState({ points: [late] }));
    expect(poseMismatches(actual, expected)).toEqual([]);
  });

  it("drops a photo without a capture time instead of guessing its frame", () => {
    const timeless = {
      imageFile: early.imageFile,
      position: early.position,
      rotation: early.rotation,
    };
    const poses = computeCaptureGeoJoin(
      relocalized([timeless, late]),
      undefined,
      1,
    );
    expect(poses.map((p) => p.imageFile)).toEqual(["images/late.jpg"]);
  });

  it("a final alignment fit before the jump places a photo from before it raw", () => {
    // Why: the final alignment need not postdate the last jump; when it
    // was fit in epoch 0, an epoch-0 photo needs no correction at all.
    const [actual] = computeCaptureGeoJoin(relocalized([early]), undefined, 0);
    const [raw] = computeCaptureGeoJoin(baseState({ points: [early] }));
    expect(poseMismatches(actual, raw)).toEqual([]);
  });

  it("drops every photo when the final alignment's fit epoch is unknown", () => {
    // Why: without its fit epoch no correction is honest; placing the
    // photos anyway is the silently wrong cloud the drop guards prevent.
    expect(computeCaptureGeoJoin(relocalized([early, late]))).toEqual([]);
  });

  it("drops a photo whose picked alignment carries no fit epoch", () => {
    // Why: as for the final alignment, an unknown epoch is never guessed.
    const picked = {
      matrix: translation(2, 0, 3),
      rotation: [0, 0, 0, 1] as const,
    };
    expect(
      computeCaptureGeoJoin(relocalized([early]), () => picked, 1),
    ).toEqual([]);
  });

  it("keeps a photo with a missing time when the recording never relocalized", () => {
    // The default path: no observation, nothing changes for older walks.
    const timeless = {
      imageFile: early.imageFile,
      position: early.position,
      rotation: early.rotation,
    };
    expect(
      computeCaptureGeoJoin(baseState({ points: [timeless] })),
    ).toHaveLength(1);
  });

  it("an alignment picked before the jump places an early photo raw and a late one moved back", () => {
    const picked = {
      matrix: translation(2, 0, 3),
      rotation: [0, 0, 0, 1] as const,
      epoch: 0,
    };
    const [earlyPose, latePose] = computeCaptureGeoJoin(
      relocalized([early, late]),
      () => picked,
    );
    const [earlyRaw] = computeCaptureGeoJoin(baseState({ points: [early] }));
    expect(poseMismatches(earlyPose, earlyRaw)).toEqual([]);
    const [lateBack] = computeCaptureGeoJoin(
      baseState({
        points: [{ ...late, ...moved(oracleJumpNue().invert(), late) }],
      }),
    );
    expect(poseMismatches(latePose, lateBack)).toEqual([]);
  });

  it("between two jumps, an alignment picked after the first moves an early photo by the first jump only", () => {
    // Why: the correction is Delta(a)^-1 * Delta(c); with two jumps the
    // order of that product decides where the photo lands.
    const second = {
      ...jump,
      t: 3000,
      tLast: 2990,
      lastPose: {
        position: [5, 1.5, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
      newPose: {
        position: [1, 1.5, 4] as [number, number, number],
        rotation: [0, 0.6, 0, 0.8] as [number, number, number, number],
      },
    };
    const picked = {
      matrix: translation(2, 0, 3),
      rotation: [0, 0, 0, 1] as const,
      epoch: 1,
    };
    const [actual] = computeCaptureGeoJoin(
      {
        ...baseState({ points: [early] }),
        arSpaceCorrection: { observations: [jump, second] },
      },
      () => picked,
    );
    const [expected] = computeCaptureGeoJoin(
      baseState({ points: [{ ...early, ...moved(oracleJumpNue(), early) }] }),
      () => picked,
    );
    expect(poseMismatches(actual, expected)).toEqual([]);
  });

  it("drops a photo whose picked alignment names an epoch the recording does not have", () => {
    const bad = {
      matrix: translation(2, 0, 3),
      rotation: [0, 0, 0, 1] as const,
      epoch: 7,
    };
    expect(computeCaptureGeoJoin(relocalized([early]), () => bad)).toEqual([]);
  });

  it("a walk whose GPS fixes all came before the jump places its early photos with no jump applied", () => {
    // Why: a relocalization leaves the alignment matrix untouched, so an
    // alignment fit wholly from epoch-0 fixes is still an epoch-0 one
    // after the jump. Labelled with the count at the end instead, every
    // early photo is moved by the whole jump (metres) and still reported
    // as placed. The expectation is the same walk with no relocalization
    // recorded at all: nothing here applies the jump. The walk settles
    // only after the jump, so the photo's pick is a post-jump moment whose
    // matrix is still the epoch-0 fit.
    const fit = baseState({ points: [early] });
    const afterJump: ReplayedJoinState = {
      ...fit,
      arSpaceCorrection: { observations: [jump] },
    };
    const t = createCapturePickTracker({
      extentOf: (state) => (state.arSpaceCorrection === undefined ? 0 : 100),
    });
    t.observe({ type: "gpsData/addGpsPosition" }, fit);
    t.observe(
      { type: "gpsData/add2dImage", payload: { imageFile: early.imageFile } },
      fit,
    );
    t.observe({ type: "arSpaceCorrection/relocalizationObserved" }, afterJump);
    const finalEpoch = t.fitEpochOf(
      afterJump.gpsData!.gpsEvents.alignmentMatrix,
    );
    expect(finalEpoch).toBe(0);
    const [viaPick] = computeCaptureGeoJoin(
      afterJump,
      (file) => t.alignmentFor(file),
      finalEpoch,
    );
    const [viaFinal] = computeCaptureGeoJoin(afterJump, undefined, finalEpoch);
    const [unjumped] = computeCaptureGeoJoin(baseState({ points: [early] }));
    expect(poseMismatches(viaPick, unjumped)).toEqual([]);
    expect(poseMismatches(viaFinal, unjumped)).toEqual([]);
  });

  it("the pick tracker labels an alignment refit after the jump with the new epoch, and knows only the last matrix", () => {
    // Why: the fit epoch follows the matrix, not the moment: a refit after
    // the jump is an epoch-1 alignment, and a matrix the replay has since
    // replaced has no epoch the tracker can vouch for.
    const t = createCapturePickTracker({ extentOf: () => 100 });
    const before = baseState();
    const jumped = { ...before, arSpaceCorrection: { observations: [jump] } };
    const refit = {
      ...baseState({ matrix: translation(5, 0, 1) }),
      arSpaceCorrection: { observations: [jump] },
    };
    t.observe(
      { type: "gpsData/add2dImage", payload: { imageFile: "images/a.jpg" } },
      before,
    );
    t.observe({ type: "arSpaceCorrection/relocalizationObserved" }, jumped);
    t.observe(
      { type: "gpsData/add2dImage", payload: { imageFile: "images/b.jpg" } },
      refit,
    );
    expect(t.alignmentFor("images/a.jpg")?.epoch).toBe(0);
    expect(t.alignmentFor("images/b.jpg")?.epoch).toBe(1);
    expect(t.fitEpochOf(refit.gpsData!.gpsEvents.alignmentMatrix)).toBe(1);
    expect(t.fitEpochOf(before.gpsData!.gpsEvents.alignmentMatrix)).toBe(
      undefined,
    );
    expect(createCapturePickTracker().fitEpochOf(translation(1, 0, 0))).toBe(
      undefined,
    );
  });

  it("the pick tracker keeps the fit epoch for a new matrix array with the same 16 values, and bumps it on a changed value", () => {
    // Why: the fit epoch marks when the alignment last CHANGED. A reducer
    // or a replay that rebuilds the matrix array with equal values has not
    // refit anything; keyed on the array reference, that copy after a jump
    // relabelled an epoch-0 fit as epoch 1 and moved its photos by the
    // whole jump. A changed value is a real refit and must bump it.
    const t = createCapturePickTracker({ extentOf: () => 0 });
    const before = baseState();
    t.observe(
      { type: "gpsData/add2dImage", payload: { imageFile: "images/a.jpg" } },
      before,
    );
    const sameValues = {
      ...baseState({ matrix: [...before.gpsData!.gpsEvents.alignmentMatrix] }),
      arSpaceCorrection: { observations: [jump] },
    };
    t.observe(
      { type: "gpsData/add2dImage", payload: { imageFile: "images/b.jpg" } },
      sameValues,
    );
    expect(t.alignmentFor("images/b.jpg")?.epoch).toBe(0);
    expect(t.fitEpochOf(sameValues.gpsData!.gpsEvents.alignmentMatrix)).toBe(0);

    const changed = [...before.gpsData!.gpsEvents.alignmentMatrix];
    changed[12] = changed[12]! + 1e-9;
    const refit = {
      ...baseState({ matrix: changed }),
      arSpaceCorrection: { observations: [jump] },
    };
    t.observe(
      { type: "gpsData/add2dImage", payload: { imageFile: "images/c.jpg" } },
      refit,
    );
    expect(t.alignmentFor("images/c.jpg")?.epoch).toBe(1);
    expect(t.fitEpochOf(changed)).toBe(1);
  });
});
