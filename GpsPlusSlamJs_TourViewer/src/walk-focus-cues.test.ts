import fc from "fast-check";
import {
  Group,
  Raycaster,
  Vector3,
  type Mesh,
  type MeshBasicMaterial,
  type Object3D,
} from "three";
import { describe, expect, it } from "vitest";

import { EYE_HEIGHT_M } from "./breadcrumbs";
import {
  createWalkFocusCues,
  walkBeaconRadiusM,
  WALK_BEACON_FROM_M,
  WALK_BEACON_MAX_RADIUS_M,
  WALK_BEACON_MIN_RADIUS_M,
  WALK_BEACON_NAME,
  WALK_BEACON_TO_M,
  WALK_FOCUS_RING_NAME,
  type WalkFocusCue,
} from "./walk-focus-cues";
import { WALK_RADAR_COLOURS } from "./walk-radar";

/**
 * Why these tests matter: the beacon over the station the walk is about
 * is what the visitor looks for between roofs and trees, and the ring on
 * the ground is where the station will be found. Both must stand at the
 * focus (on the ground, not at the phone's height), follow it when it
 * moves, go the moment there is no focus to show - a beacon left over a
 * station nobody is guided to is a wrong instruction - and never take a
 * tap meant for the content.
 */

function named(scene: Group, name: string): Mesh | undefined {
  return scene.children.find((c) => c.name === name) as Mesh | undefined;
}

const CUE: WalkFocusCue = {
  id: "well",
  at: [82, 400, 34],
  eye: [0, 401.5, 0],
  foundM: 5,
  distanceM: 88.8,
};

function rig(scene: Object3D | null = new Group()) {
  let current = scene;
  const cues = createWalkFocusCues({ getScene: () => current });
  return {
    cues,
    scene: () => current as Group,
    setScene: (s: Object3D | null) => (current = s),
  };
}

describe("createWalkFocusCues", () => {
  it("stands a beacon over the focus from 4 to 26 m above the ground, and a ring at its found radius on the ground", () => {
    const r = rig();
    r.cues.update(CUE);
    const ground = CUE.eye[1] - EYE_HEIGHT_M;
    const beacon = named(r.scene(), WALK_BEACON_NAME)!;
    expect(beacon).toBeDefined();
    beacon.updateMatrixWorld(true);
    beacon.geometry.computeBoundingBox();
    const box = beacon.geometry
      .boundingBox!.clone()
      .applyMatrix4(beacon.matrixWorld);
    expect(box.min.y).toBeCloseTo(ground + WALK_BEACON_FROM_M, 6);
    expect(box.max.y).toBeCloseTo(ground + WALK_BEACON_TO_M, 6);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(82, 6);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(34, 6);
    const ring = named(r.scene(), WALK_FOCUS_RING_NAME)!;
    expect(ring.position.toArray()).toEqual([82, ground, 34]);
    // In the walk's orange, the ring as the prototype draws it.
    for (const mesh of [beacon, ring]) {
      expect((mesh.material as MeshBasicMaterial).color.getHexString()).toBe(
        WALK_RADAR_COLOURS.accent.slice(1),
      );
    }
  });

  it("follows the focus and goes without one; the next focus brings the same meshes back", () => {
    const r = rig();
    r.cues.update(CUE);
    const beacon = named(r.scene(), WALK_BEACON_NAME);
    r.cues.update({ ...CUE, id: "gate", at: [28, 400, 0], foundM: 8 });
    expect(r.scene().children).toHaveLength(2);
    expect(named(r.scene(), WALK_BEACON_NAME)!.position.x).toBeCloseTo(28, 6);
    expect(named(r.scene(), WALK_FOCUS_RING_NAME)!.position.x).toBeCloseTo(
      28,
      6,
    );
    r.cues.update(null);
    expect(r.scene().children).toHaveLength(0);
    r.cues.update(CUE);
    expect(named(r.scene(), WALK_BEACON_NAME)).toBe(beacon);
    expect(r.scene().children).toHaveLength(2);
  });

  it("goes when there is no scene or the cue is no number, and moves with the scene", () => {
    const r = rig();
    r.cues.update(CUE);
    r.cues.update({ ...CUE, at: [Number.NaN, 400, 34] });
    expect(r.scene().children).toHaveLength(0);
    r.cues.update({ ...CUE, eye: [0, Number.POSITIVE_INFINITY, 0] });
    expect(r.scene().children).toHaveLength(0);
    const first = r.scene();
    r.cues.update(CUE);
    const next = new Group();
    r.setScene(next);
    r.cues.update(CUE);
    expect(first.children).toHaveLength(0);
    expect(next.children).toHaveLength(2);
    r.setScene(null);
    r.cues.update(CUE);
    expect(next.children).toHaveLength(0);
  });

  it("is removed through the scene it was added to, also one that keeps no parent link", () => {
    // The e2e scene is a plain object whose `add` keeps no `parent`.
    const children: unknown[] = [];
    const plain = {
      add: (o: unknown) => children.push(o),
      remove: (o: unknown) => {
        const i = children.indexOf(o);
        if (i >= 0) children.splice(i, 1);
      },
    } as unknown as Object3D;
    const r = rig(plain);
    r.cues.update(CUE);
    expect(children).toHaveLength(2);
    r.cues.update(null);
    expect(children).toHaveLength(0);
  });

  it("never takes a tap", () => {
    const r = rig();
    r.cues.update(CUE);
    r.scene().updateMatrixWorld(true);
    const down = new Raycaster(new Vector3(82, 450, 34), new Vector3(0, -1, 0));
    expect(down.intersectObject(r.scene(), true)).toEqual([]);
    const across = new Raycaster(new Vector3(0, 410, 34), new Vector3(1, 0, 0));
    expect(across.intersectObject(r.scene(), true)).toEqual([]);
  });
});

describe("walkBeaconRadiusM", () => {
  it("is the prototype's 5 cm near, keeps a few pixels far off, and is capped", () => {
    expect(walkBeaconRadiusM(10)).toBe(WALK_BEACON_MIN_RADIUS_M);
    expect(walkBeaconRadiusM(200)).toBeCloseTo(0.3, 6);
    expect(walkBeaconRadiusM(5_000)).toBe(WALK_BEACON_MAX_RADIUS_M);
    expect(walkBeaconRadiusM(Number.NaN)).toBe(WALK_BEACON_MIN_RADIUS_M);
    expect(walkBeaconRadiusM(-3)).toBe(WALK_BEACON_MIN_RADIUS_M);
  });

  it("never shrinks with the distance and stays within its bounds", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10_000, noNaN: true }),
        fc.double({ min: 0, max: 10_000, noNaN: true }),
        (a, b) => {
          const [near, far] = a <= b ? [a, b] : [b, a];
          expect(walkBeaconRadiusM(near)).toBeLessThanOrEqual(
            walkBeaconRadiusM(far),
          );
          expect(walkBeaconRadiusM(far)).toBeLessThanOrEqual(
            WALK_BEACON_MAX_RADIUS_M,
          );
          expect(walkBeaconRadiusM(near)).toBeGreaterThanOrEqual(
            WALK_BEACON_MIN_RADIUS_M,
          );
        },
      ),
    );
  });
});
