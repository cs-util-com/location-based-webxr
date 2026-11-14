import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { BuildingView } from "./building-view.js";

/**
 * WHY THESE TESTS MATTER. Street lamps and bollards are not drawn in AR
 * (owner decision), and a rebuild during AR brings brand-new furniture
 * objects, born visible. `setArShellMaterial` is the hold: AR entry calls it
 * with the shell material, and `render` re-applies it after every rebuild
 * while a session runs (pinned as source text in
 * `building-view-content.test.ts`, because `BuildingView` builds a
 * `WebGLRenderer` and cannot be constructed here). These run the REAL method
 * on a minimal view, so they see what it does to the objects, not only that
 * the call is written.
 */
interface HoldView {
  group: THREE.Group;
  arShellMaterial: THREE.Material | undefined;
  requestFrame: () => void;
}

const hold = (view: HoldView, material: THREE.Material | undefined): void => {
  BuildingView.prototype.setArShellMaterial.call(view, material);
};

function furniture(): THREE.InstancedMesh {
  const lamps = new THREE.InstancedMesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
    2,
  );
  lamps.userData["cityLayer"] = "furniture";
  return lamps;
}

function tree(): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry());
  mesh.userData["cityLayer"] = "trees";
  return mesh;
}

describe("BuildingView.setArShellMaterial - the street furniture in AR", () => {
  it("hides the furniture of a rebuild during AR, and shows it after AR", () => {
    const view: HoldView = {
      group: new THREE.Group(),
      arShellMaterial: undefined,
      requestFrame: () => undefined,
    };
    view.group.add(furniture(), tree());
    const shell = new THREE.MeshBasicMaterial();

    hold(view, shell);
    expect(view.group.children.map((o) => o.visible)).toEqual([false, true]);

    // The rebuild: the old objects go, new ones arrive visible, and the hold
    // is re-applied with the material the session holds.
    view.group.clear();
    const rebuilt = furniture();
    view.group.add(rebuilt, tree());
    expect(rebuilt.visible).toBe(true);
    hold(view, view.arShellMaterial);
    expect(rebuilt.visible).toBe(false);
    expect(view.group.children[1]?.visible).toBe(true);

    hold(view, undefined);
    expect(rebuilt.visible).toBe(true);
  });
});
