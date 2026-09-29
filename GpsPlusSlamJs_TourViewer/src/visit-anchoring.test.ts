/**
 * The frame conversion and the code correction behind the authoring
 * settle (authoring plan 2026-09-28-0953 §3.2, M2c; decisions D2, D10b).
 *
 * Why these tests matter: this is the one place where a raw WebXR pose,
 * the world group's odometry-NUE frame and the GPS-world frame meet, and
 * `content-placement.ts` records a 90-degree yaw bug from exactly this
 * mix-up. Every direction here is pinned by BEARING (North, East, West)
 * and against the scene graph the app really builds, never by matrix
 * components alone - component checks on a near-identity rotation are
 * what let the earlier bug through.
 */
import { describe, expect, it } from "vitest";
import { Group, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import { qrWorldPoseFromOdom } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";

import {
  codeCorrection,
  correctedAlignment,
  odomNueFromWebXr,
  throughAlignment,
  type NuePose,
} from "./visit-anchoring.js";

/** A rotation of `deg` about +Y (Up), as [x, y, z, w]. */
function yawQ(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

/** A yaw-only rigid alignment (the only shape the solver produces). */
function yawAlignment(deg: number, t: [number, number, number]): number[] {
  return new Matrix4()
    .compose(
      new Vector3(...t),
      new Quaternion(...yawQ(deg)),
      new Vector3(1, 1, 1),
    )
    .toArray();
}

/** Angle between two unit quaternions, degrees. */
function angleDeg(a: readonly number[], b: readonly number[]): number {
  const dot = Math.abs(
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!,
  );
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/** Largest component difference; Infinity when the lengths differ. */
function maxDiff(
  actual: readonly number[],
  expected: readonly number[],
): number {
  if (actual.length !== expected.length) return Number.POSITIVE_INFINITY;
  return Math.max(...expected.map((v, i) => Math.abs(actual[i]! - v)));
}

/** Rotate a direction by a pose's rotation. */
function turn(pose: NuePose, dir: [number, number, number]): number[] {
  return new Vector3(...dir)
    .applyQuaternion(new Quaternion(...pose.rotation))
    .toArray();
}

describe("odomNueFromWebXr: a raw WebXR pose in the world group's frame", () => {
  it("puts WebXR forward on North and WebXR +X on East (bearing, not components)", () => {
    const forward = odomNueFromWebXr({
      position: [0, 0, -10],
      rotation: [0, 0, 0, 1],
    });
    expect(maxDiff(forward.position, [10, 0, 0])).toBeLessThan(1e-9); // NUE: x = North
    const east = odomNueFromWebXr({
      position: [10, 0, 0],
      rotation: [0, 0, 0, 1],
    });
    expect(maxDiff(east.position, [0, 0, 10])).toBeLessThan(1e-9); // NUE: z = East
  });

  it("turned 90 degrees, the pose's forward axis points West, not North or South", () => {
    // +90 about WebXR up turns WebXR forward (-Z) to WebXR -X: West. In
    // NUE, West is -z. The opposite sign of the basis would give East, and
    // a trailing basis factor (the replay form) would give North or South.
    const local = odomNueFromWebXr({ position: [0, 0, 0], rotation: yawQ(90) });
    expect(maxDiff(turn(local, [0, 0, -1]), [0, 0, -1])).toBeLessThan(1e-9);
  });

  it("matches the scene graph the app builds: world group, basis node, raw pose", () => {
    // arWorldGroup (the alignment) -> basisChangeNode (WEBXR_TO_NUE) -> a
    // raw WebXR pose, which is where the camera and the code's glue live.
    // The conversion must give the pose's place in the GROUP's frame - the
    // frame an authoring preview is parented in.
    const pose: Pose = { position: [1, 0.5, -2], rotation: yawQ(90) };
    const group = new Group();
    group.matrixAutoUpdate = false;
    group.matrix.fromArray(yawAlignment(90, [5, 0, -3]));
    const basis = new Object3D();
    basis.matrixAutoUpdate = false;
    basis.matrix.copy(WEBXR_TO_NUE);
    group.add(basis);
    const object = new Object3D();
    object.position.set(...pose.position);
    object.quaternion.set(...pose.rotation);
    basis.add(object);
    group.updateMatrixWorld(true);

    const inGroup = group.matrixWorld
      .clone()
      .invert()
      .multiply(object.matrixWorld);
    const p = new Vector3();
    const q = new Quaternion();
    inGroup.decompose(p, q, new Vector3());

    const local = odomNueFromWebXr(pose);
    expect(maxDiff(local.position, p.toArray())).toBeLessThan(1e-9);
    expect(angleDeg(local.rotation, q.toArray())).toBeLessThan(1e-6);
  });

  it("through an alignment, agrees with the framework's mint composition (alignment · basis · pose)", () => {
    // The settle recomputes geo from the stored local pose; the tap-time
    // mint composed the raw pose directly. With the alignment unchanged
    // the two must agree exactly, or a settle would move every object.
    const pose: Pose = { position: [2, 1.2, -4], rotation: yawQ(-35) };
    const alignment = yawAlignment(63, [120, 0.5, -40]);
    const viaLocal = throughAlignment(odomNueFromWebXr(pose), alignment);
    const direct = qrWorldPoseFromOdom(pose, alignment as never);
    expect(viaLocal).not.toBeNull();
    expect(
      maxDiff(viaLocal!.position, [
        direct.position.x,
        direct.position.y,
        direct.position.z,
      ]),
    ).toBeLessThan(1e-9);
    expect(angleDeg(viaLocal!.rotation, direct.rotation)).toBeLessThan(1e-6);
  });

  it("refuses an alignment that is not 16 finite numbers", () => {
    const local = odomNueFromWebXr({
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    });
    expect(throughAlignment(local, [1, 0, 0])).toBeNull();
    const nan = yawAlignment(0, [0, 0, 0]);
    nan[12] = Number.NaN;
    expect(throughAlignment(local, nan)).toBeNull();
  });
});

describe("codeCorrection: this visit's code measurement onto the stored code", () => {
  it("is the identity when the measurement already sits on the stored pose", () => {
    const code: NuePose = { position: [3, 1, 4], rotation: yawQ(30) };
    expect(
      maxDiff(codeCorrection(code, code)!, new Matrix4().toArray()),
    ).toBeLessThan(1e-9);
  });

  it("moves the measured code exactly onto the stored one and turns by the yaw difference", () => {
    const measured: NuePose = { position: [3, 1, 4], rotation: yawQ(30) };
    const stored: NuePose = { position: [10, 2, -5], rotation: yawQ(75) };
    const t = new Matrix4().fromArray(codeCorrection(measured, stored)!);
    expect(
      maxDiff(
        new Vector3(...measured.position).applyMatrix4(t).toArray(),
        [10, 2, -5],
      ),
    ).toBeLessThan(1e-9);
    const q = new Quaternion();
    t.decompose(new Vector3(), q, new Vector3());
    expect(angleDeg(q.toArray(), yawQ(45))).toBeLessThan(1e-6);
  });

  it("keeps Up: a tilt difference between the two measurements is not applied", () => {
    // Both frames share gravity (ARCore's and the alignment's Up), while a
    // code's tilt from a pose solve is noise of a few degrees - which at a
    // 20 m note would be a metre of height. Only the yaw is corrected.
    const tilt = (deg: number) =>
      new Quaternion().setFromAxisAngle(
        new Vector3(1, 0, 0),
        (deg * Math.PI) / 180,
      );
    const measuredQ = new Quaternion(...yawQ(30)).multiply(tilt(6));
    const storedQ = new Quaternion(...yawQ(75)).multiply(tilt(-2));
    const t = new Matrix4().fromArray(
      codeCorrection(
        {
          position: [0, 0, 0],
          rotation: measuredQ.toArray(),
        },
        {
          position: [1, 0, 1],
          rotation: storedQ.toArray(),
        },
      )!,
    );
    const up = new Vector3(0, 1, 0).transformDirection(t);
    expect(maxDiff(up.toArray(), [0, 1, 0])).toBeLessThan(1e-9);
    const q = new Quaternion();
    t.decompose(new Vector3(), q, new Vector3());
    expect(angleDeg(q.toArray(), yawQ(45))).toBeLessThan(1e-6);
  });

  it("refuses non-finite input rather than returning a NaN transform", () => {
    const ok: NuePose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    expect(
      codeCorrection(
        { position: [Number.NaN, 0, 0], rotation: [0, 0, 0, 1] },
        ok,
      ),
    ).toBeNull();
    expect(
      codeCorrection(ok, {
        position: [0, 0, 0],
        rotation: [0, 0, 0, Number.NaN],
      }),
    ).toBeNull();
  });
});

describe("correctedAlignment: a later visit, corrected through the code (D10b)", () => {
  it("recovers the measuring visit's alignment from a second visit with a different GPS alignment", () => {
    // Visit 1 measured the code at raw odometry pose `code` through A1 and
    // stored it. Visit 2 sees the same code at the same odometry pose but
    // its GPS alignment A2 is 20 m and 55 degrees off. Settled through A2 a
    // note would land 20 m away from the code; corrected through the code
    // it lands where A1 would have put it - the placement relative to the
    // code survives the change of visit.
    const code: Pose = { position: [0.4, 1.3, -2.5], rotation: yawQ(12) };
    const a1 = yawAlignment(20, [100, 0, 50]);
    const a2 = yawAlignment(-35, [80, 3, 40]);
    const codeLocal = odomNueFromWebXr(code);
    const stored = throughAlignment(codeLocal, a1)!;

    const corrected = correctedAlignment(a2, codeLocal, stored);
    expect(corrected).not.toBeNull();
    expect(maxDiff(corrected!, a1)).toBeLessThan(1e-9);

    const note: NuePose = { position: [3, 0, -1], rotation: [0, 0, 0, 1] };
    expect(
      maxDiff(
        throughAlignment(note, corrected!)!.position,
        throughAlignment(note, a1)!.position,
      ),
    ).toBeLessThan(1e-9);
  });

  it("refuses an alignment it cannot read", () => {
    const code: NuePose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    expect(correctedAlignment([1, 2, 3], code, code)).toBeNull();
  });
});
