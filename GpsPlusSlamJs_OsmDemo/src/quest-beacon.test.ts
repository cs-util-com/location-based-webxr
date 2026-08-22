import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { createQuestBeacons, questBeaconMaterials } from "./quest-beacon.js";
import { QUEST_BEACON_HOVER_M } from "./quest-beacon-placement.js";
import { GEO_WINNER_COLOUR } from "./surface-colours.js";

/**
 * Why these tests matter: this is the one object in the scene whose whole job is
 * to be FOUND. Every failure mode is a marker that is present in the graph and
 * useless on screen — black because it is metallic, clipped because it refuses
 * fog, or floating with its line ending in mid-air so it points at nothing.
 */

const placement = (over: Partial<Record<string, number>> = {}) => ({
  x: 0,
  y: QUEST_BEACON_HOVER_M,
  z: 0,
  groundY: 0,
  groundMeasured: true,
  ...over,
});

describe("createQuestBeacons", () => {
  it("adds one group per placement, and clears them all on the next set", () => {
    // The 2D map draws a glyph per pick and DEC-K4 is that the views agree, so a
    // count that drifts is a disagreement nobody sees until they count.
    const beacons = createQuestBeacons();

    beacons.set([placement(), placement({ x: 50 }), placement({ x: -50 })]);
    expect(beacons.root.children).toHaveLength(3);

    // A quest search replaces every marker at once. A `set` that appended would
    // leave the previous search's beacons standing over ground nobody searched.
    beacons.set([placement()]);
    expect(beacons.root.children).toHaveLength(1);

    beacons.set([]);
    expect(beacons.root.children).toHaveLength(0);
  });

  it("stands each beacon at its placement", () => {
    const beacons = createQuestBeacons();
    beacons.set([placement({ x: 12, y: 40, z: -7, groundY: 25 })]);

    const beacon = beacons.root.children[0] as THREE.Object3D;
    expect(beacon.position.x).toBe(12);
    expect(beacon.position.y).toBe(40);
    expect(beacon.position.z).toBe(-7);
  });

  it("runs its line all the way DOWN TO THE GROUND, not to mid-air", () => {
    // THE ASSERTION THE FEATURE IS FOR. The report asked for the line
    // specifically so the ground position is unambiguous — "dann quasi im Boden
    // im Endeffekt endet". A stalk sized from the hover CONSTANT rather than
    // from this beacon's own drop would end short wherever the terrain is not
    // flat, which is everywhere that matters.
    // ⚠️ THE DROP MUST NOT EQUAL THE HOVER CONSTANT, and the first draft of
    // this test used 115/100 — a drop of exactly `QUEST_BEACON_HOVER_M`. An
    // implementation that sized the stalk from the CONSTANT instead of from
    // this beacon's own drop passed it, which is the coincidence that lets a
    // test agree with a wrong implementation. 25 differs from 15, so the two
    // are distinguishable.
    const beacons = createQuestBeacons();
    beacons.set([placement({ y: 115, groundY: 90 })]);

    const beacon = beacons.root.children[0] as THREE.Object3D;
    const lowest = Math.min(
      ...beacon.children.map((child) => {
        const halfHeight =
          child instanceof THREE.Mesh &&
          child.geometry instanceof THREE.CylinderGeometry
            ? child.scale.y / 2
            : 0;
        return child.position.y - halfHeight;
      }),
    );

    // The beacon sits at y = 115 and the ground at 90, so the lowest point of
    // its geometry must reach 25 m below the beacon's own origin.
    expect(lowest).toBeCloseTo(-25, 6);
  });

  it("draws NO line when the mark is already on the ground", () => {
    // Degenerate rather than impossible: a zero-length cylinder renders as a
    // disc-shaped artefact at the origin, which reads as a rendering fault.
    const beacons = createQuestBeacons();
    beacons.set([placement({ y: 0, groundY: 0 })]);

    const beacon = beacons.root.children[0] as THREE.Object3D;
    const cylinders = beacon.children.filter(
      (child) =>
        child instanceof THREE.Mesh &&
        child.geometry instanceof THREE.CylinderGeometry,
    );
    expect(cylinders).toHaveLength(0);
  });

  it("is gold, diffuse, and fogged — the three ways it could be invisible", () => {
    // Metallic zeroes the diffuse term and AR has nothing to reflect, so the
    // marker draws black. `fog: false` makes it refuse to fade and then clip at
    // the far plane. Both produce a marker that exists and cannot be seen.
    const [entry] = questBeaconMaterials();
    const material = entry?.material as THREE.MeshStandardMaterial;

    expect(material.color.getHex()).toBe(GEO_WINNER_COLOUR);
    expect(material.metalness).toBe(0);
    expect(material.fog).toBe(true);
    expect(material.emissiveIntensity).toBeGreaterThan(0);
  });

  it("survives dispose, and takes itself out of the graph", () => {
    const parent = new THREE.Group();
    const beacons = createQuestBeacons();
    parent.add(beacons.root);
    beacons.set([placement()]);

    beacons.dispose();

    expect(beacons.root.parent).toBeNull();
    expect(beacons.root.children).toHaveLength(0);
  });
});
