/**
 * The focus in the scene (the radar-and-list prototype's scene cues): a
 * thin orange beacon standing over the station the walk is about, so it
 * can be told from afar between roofs and trees, and a ring on the ground
 * at its found radius, so the visitor sees where it will be found. Both
 * follow the focus and go without one; the station guide says when
 * (`onFocusCue`: a focus, a heading, and a distance shown).
 *
 * At the scene root in the session's GPS-world NUE, like the breadcrumbs
 * and the content. The ground is the phone's height less `EYE_HEIGHT_M`,
 * as the breadcrumbs read it.
 *
 * @see walk-focus-cues.ts.md
 */

import {
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from "three";

import { EYE_HEIGHT_M } from "./breadcrumbs.js";
import { createStationRing, type StationRing } from "./station-ring.js";
import { WALK_RADAR_COLOURS } from "./walk-radar.js";

/** How tests find the beacon in the scene. */
export const WALK_BEACON_NAME = "walk-focus-beacon";
/** How tests find the focus's ring in the scene. */
export const WALK_FOCUS_RING_NAME = "walk-focus-ring";

/**
 * The beacon's span above the ground, m (the prototype's: 4 m up to 26 m),
 * so it starts over a person's head and stands above a two-storey roof.
 */
export const WALK_BEACON_FROM_M = 4;
export const WALK_BEACON_TO_M = 26;

/**
 * The beacon's radius: the prototype's 5 cm near, growing with the
 * distance so it keeps about 0.17° of width (2-3 px on a phone) far off -
 * at 5 cm a beacon 150 m away is a quarter of a pixel. Capped at 0.6 m.
 * The look is the builder's; a field test on a phone decides.
 */
export const WALK_BEACON_MIN_RADIUS_M = 0.05;
const WALK_BEACON_ANGULAR_RADIUS = 0.0015;
export const WALK_BEACON_MAX_RADIUS_M = 0.6;

type Nue = readonly [number, number, number];

/** What the scene shows for the focus. */
export interface WalkFocusCue {
  readonly id: string;
  /** The station's spot (NUE; its up part is ignored). */
  readonly at: Nue;
  /** The camera now (NUE): the ground is its height less `EYE_HEIGHT_M`. */
  readonly eye: Nue;
  /** The found radius, m: the ring's. */
  readonly foundM: number;
  /** The horizontal distance to it, m: the beacon's width. */
  readonly distanceM: number;
}

/** The beacon's radius at `distanceM` (see the constants). */
export function walkBeaconRadiusM(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM <= 0) {
    return WALK_BEACON_MIN_RADIUS_M;
  }
  return Math.min(
    WALK_BEACON_MAX_RADIUS_M,
    Math.max(WALK_BEACON_MIN_RADIUS_M, distanceM * WALK_BEACON_ANGULAR_RADIUS),
  );
}

export interface WalkFocusCues {
  /** Show the cues for `cue`, or take them away (null). Cheap per frame:
   *  it only moves and scales the meshes it keeps. */
  update(cue: WalkFocusCue | null): void;
}

/**
 * One beacon and one ring per page wiring, kept for the page's life like
 * the creator's ring (`station-ring.ts`): a session's end only takes them
 * away (`update(null)`), and the next session shows the same meshes.
 */
export function createWalkFocusCues(deps: {
  getScene(): Object3D | null;
}): WalkFocusCues {
  const ring: StationRing = createStationRing({
    colour: WALK_RADAR_COLOURS.accent,
    opacity: 0.55,
    name: WALK_FOCUS_RING_NAME,
  });
  // A unit cylinder, open at both ends, scaled to the radius in x and z.
  const height = WALK_BEACON_TO_M - WALK_BEACON_FROM_M;
  const geometry = new CylinderGeometry(1, 1, height, 6, 1, true);
  const material = new MeshBasicMaterial({
    color: WALK_RADAR_COLOURS.accent,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const beacon = new Mesh(geometry, material);
  beacon.name = WALK_BEACON_NAME;
  // Never what a tap picks.
  beacon.raycast = () => undefined;
  /** What the beacon was added to: removed through it (the e2e fakes'
   *  scene keeps no `parent` link). */
  let holder: Object3D | null = null;

  function takeAway(): void {
    ring.hide();
    holder?.remove(beacon);
    beacon.removeFromParent();
    holder = null;
  }

  return {
    update(cue) {
      const scene = cue === null ? null : deps.getScene();
      if (
        cue === null ||
        scene === null ||
        !cue.at.every(Number.isFinite) ||
        !cue.eye.every(Number.isFinite)
      ) {
        takeAway();
        return;
      }
      const ground = cue.eye[1] - EYE_HEIGHT_M;
      ring.show(scene, [cue.at[0], ground, cue.at[2]], cue.foundM);
      if (holder !== scene) {
        holder?.remove(beacon);
        beacon.removeFromParent();
        scene.add(beacon);
        holder = scene;
      }
      const r = walkBeaconRadiusM(cue.distanceM);
      beacon.scale.set(r, 1, r);
      beacon.position.set(
        cue.at[0],
        ground + WALK_BEACON_FROM_M + height / 2,
        cue.at[2],
      );
    },
  };
}
