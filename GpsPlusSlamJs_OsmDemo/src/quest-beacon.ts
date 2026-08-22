import * as THREE from "three";

import { GEO_WINNER_COLOUR } from "./surface-colours.js";
import { type QuestBeaconPlacement } from "./quest-beacon-placement.js";

/**
 * The 3D quest markers (N6, DEC-U14, DEC-K4).
 *
 * A large gold exclamation mark floating above each quest, with a thin bright
 * line down to the ground it marks — the field report's own design:
 *
 * > "so ein gelbes 3D-Ausrufezeichen … das irgendwie einfach schön groß ist,
 * > dass man es auch von ein bisschen weiter weg sehen kann … und so eine dünne
 * > Linie nach unten hat und dann quasi im Boden im Endeffekt endet"
 *
 * Built from primitives rather than loaded, because it must be legible at
 * several hundred metres and cost nothing to fetch.
 *
 * @see quest-beacon.ts.md
 */

/** Height of the "!" stem, metres. */
const BAR_H = 6;
/** Width and depth of the stem. */
const BAR_W = 1.4;
/** Radius of the dot below the stem. */
const DOT_R = 0.9;
/** Gap between stem and dot, as a fraction of the dot's radius. */
const DOT_GAP = 1.6;
/** Radius of the line running down to the ground. */
const STALK_R = 0.16;

/**
 * How much of the gold is emitted rather than lit.
 *
 * AR gives the scene very little to be lit BY — `ar-content-materials.test.ts`
 * exists because a metallic surface there is simply black. Emission is the way
 * to make something read as "glowing" without reaching for `metalness`, which
 * that guard forbids, or `fog: false`, which would make the marker refuse to
 * fade and clip at the far plane instead.
 */
const EMISSIVE_INTENSITY = 0.55;

/** The one material every part of every beacon shares. */
function beaconMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: GEO_WINNER_COLOUR,
    emissive: GEO_WINNER_COLOUR,
    emissiveIntensity: EMISSIVE_INTENSITY,
    // DIFFUSE, NOT METALLIC: `metalness = 1` zeroes the diffuse term, and in AR
    // there is nothing to reflect, so the beacon would draw black.
    metalness: 0,
    roughness: 0.6,
  });
  // FOGGED LIKE EVERYTHING ELSE. `fog: false` would leave a distant beacon at
  // full brightness against a hazed city and then clip at the far plane rather
  // than fading — the "prototype" preset's failure, on an object whose whole job
  // is to be seen from far away.
  material.fog = true;
  return material;
}

/**
 * The materials the AR content guard must check.
 *
 * Exported so `ar-content-materials.test.ts` can include them by name rather
 * than by a count that silently absorbs a new member.
 */
export function questBeaconMaterials(): {
  material: THREE.Material;
  where: string;
}[] {
  return [{ material: beaconMaterial(), where: "quest beacon" }];
}

export interface QuestBeacons {
  /** Attach this to the AR content root, not to the scene. */
  readonly root: THREE.Object3D;
  /** Replace every beacon. An empty list clears them. */
  set(placements: readonly QuestBeaconPlacement[]): void;
  dispose(): void;
}

/**
 * One reusable group holding every beacon.
 *
 * Rebuilt wholesale on each `set` rather than diffed: a quest search returns at
 * most seven picks and replaces all of them at once, so a diff would be more
 * code guarding against a case that does not arise.
 */
export function createQuestBeacons(): QuestBeacons {
  const root = new THREE.Group();
  root.name = "quest-beacons";
  // NOT CULLED AS A GROUP. Its bounding sphere is computed from children that
  // move every time a quest changes, and a stale sphere hides the marker the
  // user is walking towards — the one object in the scene that must not vanish.
  root.frustumCulled = false;

  const material = beaconMaterial();
  const barGeometry = new THREE.BoxGeometry(BAR_W, BAR_H, BAR_W);
  const dotGeometry = new THREE.SphereGeometry(DOT_R, 12, 8);
  // Unit-height cylinder, scaled per beacon: the drop to the ground differs for
  // every pick, and scaling one geometry beats building N of them.
  const stalkGeometry = new THREE.CylinderGeometry(STALK_R, STALK_R, 1, 8);

  const clear = (): void => {
    for (const child of [...root.children]) root.remove(child);
  };

  return {
    root,
    set(placements) {
      clear();
      for (const placement of placements) {
        const beacon = new THREE.Group();
        beacon.position.set(placement.x, placement.y, placement.z);

        // THE ICON, built around the placement's own origin so `y` means "where
        // the mark floats" for the caller as well as for the geometry.
        const bar = new THREE.Mesh(barGeometry, material);
        bar.position.y = BAR_H / 2;
        const dot = new THREE.Mesh(dotGeometry, material);
        dot.position.y = -DOT_R * DOT_GAP;
        beacon.add(bar, dot);

        // THE LINE DOWN TO THE GROUND. Its length is the hover minus how far the
        // dot already hangs, so it starts at the mark and ENDS IN THE GROUND
        // rather than floating short of it or overshooting into it.
        const drop = placement.y - placement.groundY;
        const stalkH = Math.max(0, drop - DOT_R * DOT_GAP);
        if (stalkH > 0) {
          const stalk = new THREE.Mesh(stalkGeometry, material);
          stalk.scale.y = stalkH;
          stalk.position.y = -DOT_R * DOT_GAP - stalkH / 2;
          beacon.add(stalk);
        }

        root.add(beacon);
      }
    },
    dispose() {
      clear();
      root.removeFromParent();
      barGeometry.dispose();
      dotGeometry.dispose();
      stalkGeometry.dispose();
      material.dispose();
    },
  };
}
