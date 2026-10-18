import { describe, expect, it } from "vitest";
import { Group, Raycaster, Vector3, type Mesh, type RingGeometry } from "three";

import { createStationRing, STATION_RING_NAME } from "./station-ring.js";

/**
 * Why these tests matter (tour editor plan 2026-10-17-1816, W3 "AR
 * authoring"): the ring is where the creator sees a station end - a pin
 * beyond it starts a new station. It must sit at the anchor on the ground,
 * at the radius the rule uses, follow a change of either, go when asked
 * (also from a parent that keeps no `parent` link, as the e2e scene), and
 * never take a tap meant for an object inside it.
 */

function ringIn(parent: Group): Mesh | undefined {
  return parent.children.find((c) => c.name === STATION_RING_NAME) as
    Mesh | undefined;
}

describe("createStationRing", () => {
  it("lies flat on the ground at the centre, R out, as one band", () => {
    const scene = new Group();
    const ring = createStationRing();
    ring.show(scene, [10, 398.5, -4], 25);
    const mesh = ringIn(scene)!;
    expect(mesh.position.toArray()).toEqual([10, 398.5, -4]);
    const { innerRadius, outerRadius } = (mesh.geometry as RingGeometry)
      .parameters;
    expect(innerRadius).toBeLessThan(25);
    expect(outerRadius).toBeGreaterThan(25);
    expect(outerRadius - innerRadius).toBeLessThan(0.5);
    // Flat: every vertex at the centre's height.
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(box.max.y - box.min.y).toBeCloseTo(0, 9);
    expect(box.max.x).toBeCloseTo(outerRadius, 3);
  });

  it("moves with a new centre and rebuilds for a new radius, one ring at a time", () => {
    const scene = new Group();
    const ring = createStationRing();
    ring.show(scene, [0, 0, 0], 25);
    ring.show(scene, [5, 1, 5], 25);
    expect(scene.children).toHaveLength(1);
    expect(ringIn(scene)!.position.toArray()).toEqual([5, 1, 5]);
    ring.show(scene, [5, 1, 5], 30);
    expect(scene.children).toHaveLength(1);
    const { outerRadius } = (ringIn(scene)!.geometry as RingGeometry)
      .parameters;
    expect(outerRadius).toBeGreaterThan(30);
    // Another parent: it moves there.
    const other = new Group();
    ring.show(other, [0, 0, 0], 30);
    expect(ringIn(scene)).toBeUndefined();
    expect(ringIn(other)).toBeDefined();
  });

  it("goes on hide, also from a parent that keeps no parent link, and on input that is not a ring", () => {
    // The e2e scene is a plain object whose `add` keeps no `parent`.
    const children: unknown[] = [];
    const plain = {
      add: (o: unknown) => children.push(o),
      remove: (o: unknown) => children.splice(children.indexOf(o), 1),
    };
    const ring = createStationRing();
    ring.show(plain as unknown as Group, [0, 0, 0], 25);
    expect(children).toHaveLength(1);
    ring.hide();
    expect(children).toHaveLength(0);
    const scene = new Group();
    ring.show(scene, [0, 0, 0], 25);
    ring.show(scene, [0, 0, 0], Number.NaN);
    expect(ringIn(scene)).toBeUndefined();
    ring.show(scene, [0, Number.NaN, 0], 25);
    expect(ringIn(scene)).toBeUndefined();
    ring.show(scene, [0, 0, 0], 0);
    expect(ringIn(scene)).toBeUndefined();
    ring.show(scene, [0, 0, 0], 25);
    ring.dispose();
    expect(ringIn(scene)).toBeUndefined();
  });

  it("never takes a tap", () => {
    const scene = new Group();
    createStationRing().show(scene, [0, 0, 0], 25);
    scene.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(25, 10, 0), new Vector3(0, -1, 0));
    expect(ray.intersectObject(scene, true)).toEqual([]);
  });
});
