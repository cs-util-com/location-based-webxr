/**
 * The focus in the scene (the radar-and-list prototype's scene cues): a
 * thin orange beacon standing over the station the walk is about, so it
 * can be told from afar between roofs and trees, and a ring on the ground
 * at its found radius, so the visitor sees where it will be found. Both
 * follow the focus and go without one; the station guide says when
 * (`onFocusCue`: a focus, a heading, and a distance shown).
 *
 * In the session's GPS-world NUE. On the scene root, or, given an anchor
 * parent (the AR world group), both in one pose-free wrapper standing in
 * their focus station's deferred-anchor key (`station:<id>`, as the story
 * figure, `anchor-root.ts`): they share that station's matrix, so they
 * hold and land with its content and never stand apart from it; a beacon
 * in view holds its station's content too. A focus change stands them in
 * the new station's key, at its matrix; a null cue only hides them, kept
 * in their key, so a short gap is no new placement. The ground is the
 * phone's height less `EYE_HEIGHT_M`, as the breadcrumbs read it.
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
import { stationAnchorKey } from "./station-content.js";
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
  /** Show the cues for `cue`, or hide them (null; anchored, they stay in
   *  their key; on the scene, they leave it). Cheap per frame:
   *  it only moves and scales the meshes it keeps. */
  update(cue: WalkFocusCue | null): void;
  /** Where station `id`'s scene-root NUE spot stands as the cues show it:
   *  through their anchor's correction still waiting in view (the
   *  breadcrumbs aim at it); `nue` itself while they stand on the scene,
   *  or in another station's key (a focus change the cue has not reached
   *  yet, or a null cue that kept the old key). */
  shownAt(id: string, nue: Nue): Nue;
}

/**
 * One beacon and one ring per page wiring, kept for the page's life like
 * the creator's ring (`station-ring.ts`): a session's end only takes them
 * away (`update(null)`), and the next session shows the same meshes.
 */
export function createWalkFocusCues(deps: {
  getScene(): Object3D | null;
  /** Where they stand in their focus station's deferred-anchor key (the
   *  AR world group);
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
  /** Their wrapper while they stand as an anchor, and the focus whose
   *  station key it stands in. */
  let anchored: AnchoredRoot | null = null;
  let anchoredId: string | null = null;
  /** The anchor parent whose refusal was logged: asked again on each
   *  update (its binding may come later), quietly, until they are taken
   *  away. */
  let refused: Object3D | null = null;
  /** The radius the anchor's bounds were last read for. */
  let boundsFoundM = 0;

  function takeAway(): void {
    ring.hide();
    holder?.remove(beacon);
    beacon.removeFromParent();
    holder = null;
    anchored?.release();
    anchored = null;
    anchoredId = null;
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
    shownAt(id, nue) {
      const scene = deps.getScene();
      if (anchored === null || anchoredId !== id || scene === null) return nue;
      const p = new Vector3(nue[0], nue[1], nue[2]);
      anchored.root.updateWorldMatrix(true, false);
      anchored.root.localToWorld(p);
      scene.updateWorldMatrix(true, false);
      scene.worldToLocal(p);
      return [p.x, p.y, p.z];
    },
    update(cue) {
      const scene = deps.getScene();
      const valid =
        cue !== null &&
        cue.at.every(Number.isFinite) &&
        cue.eye.every(Number.isFinite);
      if (scene === null || !valid) {
        // Anchored: hidden, its key kept. Hidden counts as out of view,
        // so a correction lands unseen unless the station's content holds
        // the key in view.
        if (scene !== null && anchored !== null) anchored.root.visible = false;
        else takeAway();
        return;
      }
      const parent = deps.getAnchorParent?.() ?? null;
      if (
        anchored !== null &&
        (anchored.parent !== parent || anchoredId !== cue.id)
      ) {
        takeAway();
      }
      if (anchored !== null) {
        anchored.root.visible = true;
        place(anchored.root, cue);
        // A new ring mesh.
        if (cue.foundM !== boundsFoundM) anchored.boundsChanged();
        boundsFoundM = cue.foundM;
        return;
      }
      if (parent !== null) {
        // Placed in the wrapper first: the anchor's first bounds see both.
        const wrapper = new Group();
        wrapper.name = "walk-focus-anchor";
        place(wrapper, cue);
        anchored = anchorRoot(
          parent,
          stationAnchorKey(cue.id),
          wrapper,
          undefined,
          { warn: parent !== refused },
        );
        if (anchored !== null) {
          anchoredId = cue.id;
          boundsFoundM = cue.foundM;
          return;
        }
        refused = parent;
      }
      place(scene, cue);
    },
  };
}
