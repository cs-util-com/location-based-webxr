/**
 * Viewer content follows the live alignment (Tour Viewer authoring plan
 * 2026-09-28-0953 §3.2 "Viewing - content follows the alignment", owner
 * decision D10a, milestone M2d).
 *
 * Why this test matters: it pins a DECISION, so that nobody "fixes" the
 * viewer into per-note GPS anchors (`FW/visualization/gps-anchor.ts`)
 * without meeting it. The plan's cold review showed an anchor moves only
 * while off screen and by more than `threshold x (1 + 0.1 x distance)`
 * (at least ~2.2 m), and sets position only - so a scan's correction would
 * stay hidden while the visitor looks at the note, and the 0.3 m field
 * acceptance would be out of reach. The viewer therefore places the tour's
 * content ONCE at the scene root in the session's GPS-world NUE, and the
 * alignment (applied to the odometry group the camera lives in) carries it:
 * every alignment change moves the content in the visitor's view, and a
 * scan's correction reaches it in the same dispatch as the votes.
 *
 * Scenario: exact odometry whose frame equals GPS-world NUE up to the
 * absolute altitude (the true alignment is a lift by the altitude), GPS biased 8 m to the north-east, a ~40 m walk
 * to a code minted at its true pose, a pin 3.6 m beside it. "Where the
 * visitor sees the pin" is the pin's scene position mapped into the
 * odometry frame through the store's alignment - what the aligned world
 * group makes of it, once its lerp settles.
 */
import { describe, expect, it } from "vitest";
import { Group, Matrix4, Object3D, Scene, Vector3 } from "three";
import { buildQrGpsVotes } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import { qrWorldPoseFromOdom } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { TourPin } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  calcGpsCoords,
  webxrToNUE,
  type Vector3 as NumTriple,
} from "gps-plus-slam-app-framework/core";
import {
  recordGpsEvent,
  selectAlignmentMatrix,
  setZeroPos,
} from "gps-plus-slam-app-framework/state";

import { renderTourObjects } from "./content-placement.js";
import {
  MAX_VOTED_LOCKS_PER_CODE,
  VIEWER_SYNTHETIC_ACCURACY_M,
  VIEWER_VOTE_BASELINE_M,
  VIEWER_VOTE_COUNT,
} from "./qr-viewer-mode.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

const ZERO = { lat: 47.5, lon: 8.7 };
const T0 = 1_790_000_000_000;
const ALT = 400;
/** The TRUE alignment: odometry NUE lifted to absolute altitude (GPS-world
 *  Up is absolute altitude in this stack), no rotation, no offset. */
const TRUE_ALIGNMENT: readonly number[] = new Matrix4()
  .makeTranslation(0, ALT, 0)
  .toArray();
/** GPS is off by this much (north, east), as in the vote-strength harness. */
const BIAS_NE = [4, 6.93] as const; // 8 m at bearing 60°

/** The code: 22 m north, 6 m east of the zero at 1.5 m, facing +z (WebXR). */
const CODE_ODOM: Pose = { position: [6, 1.5, -22], rotation: [0, 0, 0, 1] };
/** The pin's true position, 3.6 m from the code (NUE: north, up, east). */
const PIN_TRUE_NUE: NumTriple = [20, 1.5, 9];

/** `A · p` for a column-major 4x4 alignment and a NUE point. */
function apply(a: readonly number[], p: NumTriple): NumTriple {
  const v = new Vector3(...p).applyMatrix4(new Matrix4().fromArray([...a]));
  return [v.x, v.y, v.z];
}

/** Where the visitor sees a scene-root point, in the odometry frame. */
function inView(a: readonly number[], sceneNue: NumTriple): NumTriple {
  return apply(
    new Matrix4()
      .fromArray([...a])
      .invert()
      .toArray(),
    sceneNue,
  );
}

function distance(a: NumTriple, b: NumTriple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A device fix at odometry `p` (WebXR), reported biased. */
function fix(
  store: ReturnType<typeof createTourViewerStore>,
  p: NumTriple,
  t: number,
) {
  const nue = webxrToNUE(p);
  const geo = calcGpsCoords(ZERO, [
    nue[0] + BIAS_NE[0],
    0,
    nue[2] + BIAS_NE[1],
  ]);
  store.dispatch(
    recordGpsEvent({
      odomPosition: p,
      odomRotation: [0, 0, 0, 1],
      rawGpsPoint: {
        id: `gps-${String(t)}`,
        latitude: geo.lat,
        longitude: geo.lon,
        altitude: ALT + nue[1],
        latLongAccuracy: 3,
        timestamp: t,
      },
    }),
  );
}

describe("viewer content follows the live alignment (D10a, M2d)", () => {
  it("sits at the scene root, moves with every alignment change, and takes a scan's correction at once", async () => {
    const store = createTourViewerStore();
    store.dispatch(setZeroPos(ZERO));
    // A walk from the zero north, then east, towards the code: 1 Hz fixes.
    let t = T0;
    for (let s = 0; s <= 22; s += 1) fix(store, [0, 1.5, -s], (t += 1000));
    for (let s = 1; s <= 6; s += 1) fix(store, [s, 1.5, -22], (t += 1000));

    // The code minted at its TRUE pose (true alignment = identity), and a
    // pin placed at its true spot - both as the creator's zip stores them.
    const codeWorld = qrWorldPoseFromOdom(CODE_ODOM, [
      ...TRUE_ALIGNMENT,
    ] as never);
    const qrGeo = mintQrGeoPose({
      worldNuePosition: codeWorld.position,
      worldNueRotation: codeWorld.rotation,
      zero: ZERO,
    });
    const pinGeo = calcGpsCoords(ZERO, [PIN_TRUE_NUE[0], 0, PIN_TRUE_NUE[2]]);
    const pin: TourPin = {
      id: "pin",
      kind: "pin",
      label: "Here",
      createdAtIso: "2026-09-30T00:00:00.000Z",
      geo: {
        lat: pinGeo.lat,
        lon: pinGeo.lon,
        alt: ALT + PIN_TRUE_NUE[1],
        rotation: [0, 0, 0, 1],
      },
    };

    // The viewer's content render: at the scene root, in the session's NUE.
    const scene = new Scene();
    const arWorldGroup = new Group(); // the odometry group the camera is in
    scene.add(arWorldGroup);
    const label = new Object3D();
    await renderTourObjects([pin], {
      scene,
      zero: ZERO,
      makeLabel: () => ({ object: label, dispose: () => undefined }),
      loadPhotoTexture: () => Promise.resolve(null),
    });
    expect(label.parent?.parent).toBe(scene); // no anchor, no world group
    let ancestor: Object3D | null = label;
    while (ancestor !== null) {
      expect(ancestor).not.toBe(arWorldGroup);
      ancestor = ancestor.parent;
    }
    const placed = label.getWorldPosition(new Vector3());
    const pinScene: NumTriple = [placed.x, placed.y, placed.z];

    // Before the scan: the biased GPS alignment shows the pin ~8 m off.
    const before = selectAlignmentMatrix(store.getState())!;
    expect(distance(inView(before, pinScene), PIN_TRUE_NUE)).toBeGreaterThan(6);

    // The scan: the viewer's lock burst, as the controller builds it.
    for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
      for (const vote of buildQrGpsVotes({
        qrPoseWorld: CODE_ODOM,
        sizeM: 0.2,
        qrGeo,
        syntheticAccuracyM: VIEWER_SYNTHETIC_ACCURACY_M,
        baselineM: VIEWER_VOTE_BASELINE_M,
        count: VIEWER_VOTE_COUNT,
        timestamp: t + 200 + i * 125,
      })) {
        store.dispatch(recordGpsEvent(vote));
      }
    }

    // The correction reached the pin in the same dispatches: nothing was
    // re-placed (its scene position is unchanged), the alignment moved.
    const after = selectAlignmentMatrix(store.getState())!;
    expect(after).not.toEqual(before);
    expect(label.getWorldPosition(new Vector3()).toArray()).toEqual(
      placed.toArray(),
    );
    expect(distance(inView(after, pinScene), PIN_TRUE_NUE)).toBeLessThan(0.3);
  }, 60_000);
});
