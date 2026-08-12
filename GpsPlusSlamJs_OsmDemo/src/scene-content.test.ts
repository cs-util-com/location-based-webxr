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
