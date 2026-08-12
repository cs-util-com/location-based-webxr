/**
 * `SceneContent` — the AR attachment seam, pinned before AR exists.
 *
 * Why this test matters: milestone 0 of the AR plan is "prove the seam without
 * AR", and the thing that has to be true is narrow and easy to break — **the
 * world content moves to a new parent AS ONE SUBTREE, carrying its children.**
 * AR mode reparents this under the framework's scene root, where the GPS-world
 * frame lives; anything a future edit attaches to `BuildingView`'s own scene
 * instead of to this root silently stays behind, and the symptom is content
 * missing in AR while every desktop test stays green.
 *
 * `BuildingView` itself cannot be unit-tested — it constructs a
 * `THREE.WebGLRenderer` — so the seam is extracted to where a test can reach
 * it rather than left as an untested option on a class the unit suite cannot
 * instantiate. That extraction IS the milestone.
 *
 * @see scene-content.ts.md
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";

import { SceneContent } from "./scene-content.js";

const named = (name: string): THREE.Object3D => {
  const object = new THREE.Object3D();
  object.name = name;
  return object;
};

/**
 * THE AXIS MAPPING, which the first version of this module asserted was
 * unnecessary and was WRONG about.
 *
 * The demo's scene is X=East, Y=Up, Z=−North (`main.ts` round-trips a picked
 * point as `frame.toLatLng({ x: point.x, y: -point.z })`, and `protocol.ts`
 * calls the ENU→scene reflection "a real trap"). The framework's scene root is
 * the GPS-world frame in NUE — X=North, Y=Up, Z=East
 * (`ar-scene-hierarchy.ts`, and `gpsMath.ts` returns `[north, up, east]`).
 *
 * Those are not the same frame. Plan §2.2 says so in capitals — "AXIS MAPPING
 * IS REAL WORK AND MUST NOT BE ASSUMED" — and the milestone-0 commit
 * nevertheless documented the opposite in three places, which would have sent
 * M1 to render the city 90° off while telling the implementer not to look.
 *
 * These tests are the "stated, tested, derived once" §2.2 asks for.
 */
describe("the demo frame is NOT the GPS-world frame, and the seam converts", () => {
  /** A point 10 m North in the demo's own scene axes: north is −z. */
  const TEN_NORTH_DEMO = new THREE.Vector3(0, 0, -10);
  /** A point 10 m East in the demo's own scene axes: east is +x. */
  const TEN_EAST_DEMO = new THREE.Vector3(10, 0, 0);

  const worldPositionUnder = (
    parent: THREE.Object3D,
    local: THREE.Vector3,
  ): THREE.Vector3 => {
    const marker = new THREE.Object3D();
    marker.position.copy(local);
    const content = new SceneContent(new THREE.Scene());
    content.add(marker);
    content.attachTo(parent, "gps-world-nue");
    parent.updateMatrixWorld(true);
    return marker.getWorldPosition(new THREE.Vector3());
  };

  it("maps the demo's NORTH onto the GPS-world frame's +X", () => {
    // NUE's X axis is North. A thing 10 m north of the origin must land at
    // x=+10 once the content is in the GPS-world frame — not at z=−10, which
    // is where it sits in the demo's own axes and where an identity attach
    // would leave it.
    const world = worldPositionUnder(new THREE.Object3D(), TEN_NORTH_DEMO);

    expect(world.x).toBeCloseTo(10, 6);
    expect(world.y).toBeCloseTo(0, 6);
    expect(world.z).toBeCloseTo(0, 6);
  });

  it("maps the demo's EAST onto the GPS-world frame's +Z", () => {
    // The other half, and the one that catches a sign error that happens to
    // leave north correct. NUE's Z axis is East.
    const world = worldPositionUnder(new THREE.Object3D(), TEN_EAST_DEMO);

    expect(world.x).toBeCloseTo(0, 6);
    expect(world.y).toBeCloseTo(0, 6);
    expect(world.z).toBeCloseTo(10, 6);
  });

  it("leaves UP alone, because both frames agree on it", () => {
    // Stated as a test rather than assumed: a mapping built as a reflection
    // rather than a rotation could flip it, and an upside-down city is the
    // kind of thing that reads as "AR is broken" rather than as an axis bug.
    const world = worldPositionUnder(
      new THREE.Object3D(),
      new THREE.Vector3(0, 7, 0),
    );

    expect(world.y).toBeCloseTo(7, 6);
  });

  it("is a ROTATION, not a reflection — handedness is preserved", () => {
    // A mirrored frame renders a city that looks plausible and is wrong, and
    // this demo has already shipped one: `building-view.ts.md` records a
    // mirrored mesh frame surviving for months because the view has no north
    // reference to check against. Determinant +1 is the check that would have
    // caught it.
    const content = new SceneContent(new THREE.Scene());
    content.attachTo(new THREE.Object3D(), "gps-world-nue");

    const basis = new THREE.Matrix3().setFromMatrix4(content.root.matrix);
    expect(basis.determinant()).toBeCloseTo(1, 6);
  });

  it("returns to an IDENTITY transform when attached back to the demo frame", () => {
    // Leaving AR must not leave the desktop view rotated. The transform is
    // owned by the attach call rather than accumulated, so a round trip is
    // exactly the identity.
    const desktop = new THREE.Scene();
    const content = new SceneContent(desktop);

    content.attachTo(new THREE.Object3D(), "gps-world-nue");
    content.attachTo(desktop, "demo-scene");

    expect(content.root.matrix.equals(new THREE.Matrix4())).toBe(true);
  });
});

describe("SceneContent attaches world content to a swappable root", () => {
  it("parents its root under the scene it is constructed with", () => {
    // The desktop case, which must keep working exactly as before: content
    // hangs off the view's own scene without the caller doing anything.
    const scene = new THREE.Scene();
    const content = new SceneContent(scene);

    expect(content.root.parent).toBe(scene);
    expect(scene.children).toContain(content.root);
  });

  it("moves the WHOLE subtree when reparented, children included", () => {
    // The AR case and the reason this class exists. Three.js `add()` reparents
    // rather than duplicating, so the assertion worth making is that the
    // children survive the move — a caller that re-created the group instead
    // would pass a "root moved" check and lose everything under it.
    const desktop = new THREE.Scene();
    const arWorld = new THREE.Object3D();
    const content = new SceneContent(desktop);

    const buildings = named("buildings");
    const heatGrid = named("heat-grid");
    content.add(buildings);
    content.add(heatGrid);

    content.attachTo(arWorld);

    expect(content.root.parent).toBe(arWorld);
    expect(desktop.children).not.toContain(content.root);
    // The point of the test: the content came along.
    expect(content.root.children).toEqual([buildings, heatGrid]);
    expect(buildings.parent).toBe(content.root);
  });

  it("is reversible, so leaving AR restores the desktop parent", () => {
    // M5 disposes nothing and hides the desktop renderer instead, so exiting AR
    // has to hand the content back. A one-way seam would make that a rebuild.
    const desktop = new THREE.Scene();
    const arWorld = new THREE.Object3D();
    const content = new SceneContent(desktop);
    content.add(named("buildings"));

    content.attachTo(arWorld);
    content.attachTo(desktop);

    expect(content.root.parent).toBe(desktop);
    expect(arWorld.children).not.toContain(content.root);
    expect(content.root.children.map((c) => c.name)).toEqual(["buildings"]);
  });

  it("detaches from a parent that outlives it", () => {
    // The AR disposal case. `BuildingView.dispose()` frees GPU buffers by field
    // reference; on desktop the root dies with the view's scene, but the
    // framework's scene root does not, so a subtree of disposed geometry would
    // stay attached to a live scene and simply stop drawing.
    const arWorld = new THREE.Object3D();
    const content = new SceneContent(new THREE.Scene());
    content.add(named("buildings"));
    content.attachTo(arWorld, "gps-world-nue");

    content.detach();

    expect(content.root.parent).toBe(null);
    expect(arWorld.children).toHaveLength(0);
  });

  it("removes an object without disturbing its siblings", () => {
    // `BuildingView` swaps the cell mesh and the underground lines in and out
    // independently of the layer group, so removal has to be per-object rather
    // than a subtree clear.
    const content = new SceneContent(new THREE.Scene());
    const keep = named("keep");
    const drop = named("drop");
    content.add(keep);
    content.add(drop);

    content.remove(drop);

    expect(content.root.children).toEqual([keep]);
  });

  it("survives being attached to the parent it already has", () => {
    // Idempotence matters because the AR entry path is gated on a first GPS fix
    // and may be re-run; three.js removes-then-adds, so the child would end up
    // last in the list rather than duplicated, but the content must not be lost.
    const scene = new THREE.Scene();
    const content = new SceneContent(scene);
    content.add(named("buildings"));

    content.attachTo(scene);

    expect(content.root.parent).toBe(scene);
    expect(scene.children.filter((c) => c === content.root)).toHaveLength(1);
    expect(content.root.children).toHaveLength(1);
  });
});
