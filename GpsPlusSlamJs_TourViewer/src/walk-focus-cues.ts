/**
 * The focus in the scene (the radar-and-list prototype's scene cues): a
 * thin orange beacon standing over the station the walk is about, so it
 * can be told from afar between roofs and trees, and a ring on the ground
 * at its found radius, so the visitor sees where it will be found. Both
 * follow the focus and go without one; the station guide says when
 * (`onFocusCue`: a focus, a heading, and a distance shown).
 *
 * In the session's GPS-world NUE. On the scene root, or, given an anchor
 * parent (the AR world group), both in one pose-free wrapper standing as a
 * deferred anchor of their own (key `walk-focus`, `anchor-root.ts`): like
 * a station, they hold their place while in view and land once looked
 * away from, so they never slide against a station that waits. A focus
 * change moves them inside their key. The ground is the phone's height
 * less `EYE_HEIGHT_M`, as the breadcrumbs read it.
 *
 * @see walk-focus-cues.ts.md
 */

import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Object3D,
} from "three";

import { anchorRoot, type AnchoredRoot } from "./anchor-root.js";
import { EYE_HEIGHT_M } from "./breadcrumbs.js";
import { createStationRing, type StationRing } from "./station-ring.js";
import { WALK_RADAR_COLOURS } from "./walk-radar.js";

/** How tests find the beacon in the scene. */
export const WALK_BEACON_NAME = "walk-focus-beacon";
/** How tests find the focus's ring in the scene. */
export const WALK_FOCUS_RING_NAME = "walk-focus-ring";
/** The beacon's and ring's deferred-anchor key. */
const WALK_FOCUS_ANCHOR_KEY = "walk-focus";

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
  /** Where a scene-root NUE point stands as the cues show it: through
   *  their anchor's correction still waiting in view (the breadcrumbs aim
   *  at it); `nue` itself while they stand on the scene, or none shows. */
  shownAt(nue: Nue): Nue;
}

/**
 * One beacon and one ring per page wiring, kept for the page's life like
 * the creator's ring (`station-ring.ts`): a session's end only takes them
 * away (`update(null)`), and the next session shows the same meshes.
 */
export function createWalkFocusCues(deps: {
  getScene(): Object3D | null;
  /** Where they stand as their own deferred anchor (the AR world group);
   *  read on each update. Absent or null: on the scene. */
  getAnchorParent?(): Object3D | null;
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
  /** Their wrapper while they stand as an anchor. */
  let anchored: AnchoredRoot | null = null;
  /** The anchor parent that refused them: not asked again (each update
   *  would log) until they are taken away. */
  let refused: Object3D | null = null;
  /** The focus and radius the anchor's bounds were last read for. */
  let boundsFor = "";

  function takeAway(): void {
    ring.hide();
    holder?.remove(beacon);
    beacon.removeFromParent();
    holder = null;
    anchored?.release();
    anchored = null;
    refused = null;
  }

  /** Stand both in `into`, at the cue. */
  function place(into: Object3D, cue: WalkFocusCue): void {
    const ground = cue.eye[1] - EYE_HEIGHT_M;
    ring.show(into, [cue.at[0], ground, cue.at[2]], cue.foundM);
    if (holder !== into) {
      holder?.remove(beacon);
      beacon.removeFromParent();
      into.add(beacon);
      holder = into;
    }
    const r = walkBeaconRadiusM(cue.distanceM);
    beacon.scale.set(r, 1, r);
    beacon.position.set(
      cue.at[0],
      ground + WALK_BEACON_FROM_M + height / 2,
      cue.at[2],
    );
  }

  return {
    shownAt(nue) {
      const scene = deps.getScene();
      if (anchored === null || scene === null) return nue;
      const p = new Vector3(nue[0], nue[1], nue[2]);
      anchored.root.updateWorldMatrix(true, false);
      anchored.root.localToWorld(p);
      scene.updateWorldMatrix(true, false);
      scene.worldToLocal(p);
      return [p.x, p.y, p.z];
    },
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
      const parent = deps.getAnchorParent?.() ?? null;
      if (anchored !== null && anchored.parent !== parent) takeAway();
      const bounds = `${cue.id} ${String(cue.foundM)}`;
      if (anchored !== null) {
        place(anchored.root, cue);
        // A new ring mesh, or the beacon far off at a new focus.
        if (bounds !== boundsFor) anchored.boundsChanged();
        boundsFor = bounds;
        return;
      }
      if (parent !== null && parent !== refused) {
        // Placed in the wrapper first: the anchor's first bounds see both.
        const wrapper = new Group();
        wrapper.name = "walk-focus-anchor";
        place(wrapper, cue);
        anchored = anchorRoot(parent, WALK_FOCUS_ANCHOR_KEY, wrapper);
        boundsFor = bounds;
        if (anchored !== null) return;
        refused = parent;
      }
      place(scene, cue);
    },
  };
}
