import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { SceneContent } from "./scene-content.js";
import { createQuestBeacons } from "./quest-beacon.js";

/**
 * WHY THIS TEST MATTERS (M4, eighteenth field session). The session reported the
 * quest marks hanging far below the AR city and proposed a cause: that they sit
 * outside the node the entry fly-in moves, so the city rises and they do not.
 *
 * That is a claim about the scene graph, and it is cheap to settle. This test
 * drives the exact call AR's elevation composition makes — `attachTo` with an
 * `up` offset, which is what `applyElevation` does every frame of the descent —
 * and reads the beacons' WORLD position back.
 *
 * It is kept whichever way the field report resolves: the invariant "everything
 * on the content root moves together" is the one the whole entry animation rests
 * on, and no other test asserts it for the beacons at runtime.
 * `building-view-content.test.ts` only reads the source text.
 */
describe("quest beacons ride the AR entry fly-in", () => {
  const placement = {
    x: 30,
    y: 55,
    z: -40,
    groundY: 40,
    groundMeasured: true,
  } as const;

  /** Where the beacon's own group ends up in world space, given an `up` offset. */
  const beaconWorldY = (upM: number): number => {
    const scene = new THREE.Scene();
    const content = new SceneContent(scene);
    const beacons = createQuestBeacons();
    content.add(beacons.root);
    beacons.set([placement]);

    // EXACTLY WHAT `applyElevation` DOES: re-attach with the composed offset in
    // the `up` slot of the geometric offset.
    content.attachTo(scene, "gps-world-nue", { north: 0, up: upM, east: 0 });
    scene.updateMatrixWorld(true);

    const beacon = beacons.root.children[0];
    if (beacon === undefined) throw new Error("no beacon was built");
    return beacon.getWorldPosition(new THREE.Vector3()).y;
  };

  it("sits `up` metres from where it would with no descent offset", () => {
    // The descent's contribution is negative — the city starts below the user
    // and rises (DEC-Y14) — so this is the deepest frame of a 60 m entry.
    expect(beaconWorldY(-60)).toBeCloseTo(placement.y - 60, 6);
    // ...and the landed frame, with the descent term back at zero.
    expect(beaconWorldY(0)).toBeCloseTo(placement.y, 6);
  });

  it("moves by exactly the offset, so it cannot lag the city it marks", () => {
    // THE ASSERTION THAT ANSWERS THE FIELD REPORT. A beacon left outside the
    // moved node would return the same world Y for both offsets.
    expect(beaconWorldY(0) - beaconWorldY(-60)).toBeCloseTo(60, 6);
  });
});
