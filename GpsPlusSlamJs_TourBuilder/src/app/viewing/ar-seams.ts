/**
 * The AR runtime seams component 8 declares but deliberately does not own
 * (plan `plans/2026-08-14-viewing-composition-plan.md`, VC5/VC21).
 *
 * `createThreeSceneAdapter` takes `createAnchor`, `toWorld` and
 * `getUserWorldPos` as injected functions so the component can run on a
 * desktop with an identity anchor factory (its own demo, plan A23). This
 * module is the real implementation: the single geo -> world step §2.5.1
 * allows, expressed entirely through framework primitives — the same ones
 * `gps-anchor.ts` uses for its own steady-state target, so anchored content
 * and the trail window always land in one frame.
 *
 * Two field-fatal subtleties live here, both found in plan review:
 *
 * - **R1 — `skipBootstrap: true` is mandatory.** `getCurrentGpsPoint` is
 *   optional on `GpsAnchorOptions`, and when omitted the anchor bootstraps
 *   from the OBJECT's own pose and commits that median as its `gpsPoint`.
 *   AnchorStarter wants that (it is *placing* a new anchor); a tour already
 *   knows the coordinate, so bootstrapping would silently relocate the
 *   waypoint to wherever the mesh happened to sit.
 * - **R2 — `isFullyAnchored` must be re-derived.** A `skipBootstrap` anchor
 *   reports `isFullyAnchored === true` from frame one, while its object is
 *   still at the AR origin and no alignment matrix exists yet. Component 8
 *   feeds exactly the anchors reporting anchored to the proximity driver, so
 *   the raw flag would put every waypoint on top of the visitor at session
 *   entry — the whole tour activating (and being marked visited) in the first
 *   second. The wrapper below reports anchored only once the object has
 *   actually been committed to its computed target — and then keeps
 *   reporting it, because the anchor leaves smaller corrections unapplied.
 * - **Altitude is not consumed (contract D6).** GPS-world `y` is absolute
 *   altitude, so a stored altitude (one noisy fix) or a missing one (the
 *   ellipsoid, ~100 m underground) would hide the stop. Every stop is placed
 *   on the visitor's floor instead, refreshed each frame via `update()`.
 */

import { Matrix4, Vector3, type Camera, type Object3D } from "three";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
// Subpath imports, not the `visualization` barrel: that barrel also exports
// the Leaflet-based map overlay, which touches `window` at import time and
// would drag a DOM dependency into this framework-free-ish module (and into
// every Node test that touches it).
import { createGpsAnchor } from "gps-plus-slam-app-framework/visualization/gps-anchor";
import { nueToArLocal } from "gps-plus-slam-app-framework/visualization/frame-conversions";

import type { TourCoord } from "../../store/types.js";
import type { SceneAnchor } from "../../components/ar-scene/view/three-scene-adapter.js";

/**
 * How close the object must be to its computed target before it first counts
 * as anchored. The anchor's own move threshold is `2 m × (1 + distance/10)`,
 * so this is only checked until it passes once (see `placed` below).
 */
const ANCHORED_TOLERANCE_M = 2;

/** Floor changes smaller than this do not re-point the anchors. */
const FLOOR_REFRESH_TOLERANCE_M = 0.5;
/** The framework still multiplies this by (1 + 0.1 x distance in metres), so it
 *  stays tiny: 0.01 is ~0.3 m at 300 m. */
const ANCHOR_MOVE_THRESHOLD_M = 0.01;

/** The subset of `createGpsAnchor` this module calls (test seam). */
export type AnchorFactoryLike = (
  options: Parameters<typeof createGpsAnchor>[0],
) => AnchorLike;

/** The subset of the framework's `GpsAnchor` the wrapper delegates to. */
interface AnchorLike {
  readonly isFullyAnchored: boolean;
  readonly gpsPoint: { readonly lat: number; readonly lon: number };
  markMovedExternally(): void;
  setGpsPoint(point: TourCoord): void;
  dispose(): void;
}

export interface ArSeamsDeps {
  readonly getAlignmentMatrix: () => readonly number[] | null;
  readonly getGpsZeroRef: () => { lat: number; lon: number } | null;
  readonly getArWorldGroup: () => Object3D | null;
  readonly getCamera: () => Camera | null;
  /** Defaults to the framework's `createGpsAnchor`. */
  readonly createGpsAnchor?: AnchorFactoryLike;
  /** Defaults to `ANCHORED_TOLERANCE_M`. */
  readonly anchoredToleranceM?: number;
}

export interface ArSeams {
  /**
   * Anchors `object3D` to a tour coordinate. The returned anchor's
   * `isFullyAnchored` is this module's stricter gate (R2), never the
   * framework anchor's raw flag.
   */
  createAnchor(object3D: Object3D, coord: TourCoord): SceneAnchor;
  /** GPS-world NUE -> AR-local -> THREE world. `null` until the frame exists. */
  toWorld(coord: TourCoord): Vector3 | null;
  /** The visitor's world position, in the same frame as the anchors. */
  getUserWorldPos(): Vector3 | null;
  /**
   * Call once per frame, before the anchors tick: keeps every anchor on the
   * visitor's floor as the alignment's vertical estimate settles.
   */
  update?(): void;
}

/** A stop's coordinate with the given floor as its altitude (contract D6). */
function onFloor(coord: TourCoord, floor: number | null): TourCoord {
  return floor === null
    ? { lat: coord.lat, lon: coord.lon }
    : { lat: coord.lat, lon: coord.lon, altitude: floor };
}

export function createArSeams(deps: ArSeamsDeps): ArSeams {
  const anchorFactory: AnchorFactoryLike =
    deps.createGpsAnchor ?? ((options) => createGpsAnchor(options));
  const tolerance = deps.anchoredToleranceM ?? ANCHORED_TOLERANCE_M;
  // `getUserWorldPos` and `floorAltitude` run every frame; `toWorld` only when
  // the trail re-windows (4 Hz), so only the former need reused scratch.
  const userScratch = new Vector3();
  const floorScratch = new Vector3();
  const alignmentScratch = new Matrix4();
  const floorRefreshers = new Set<(floor: number) => void>();

  /**
   * The visitor's floor as a GPS-world altitude (GPS-world `y` is absolute).
   * Contract D6: stored altitudes are not consumed, so every stop stands on the
   * visitor's floor. That floor is the AR frame's own (`y = 0` of the
   * `local-floor` reference space), mapped through the alignment — not a
   * guess from how high the phone is held. Uses the target alignment rather
   * than the group's mid-lerp matrix, so it agrees with what the anchors solve
   * against.
   */
  function floorAltitude(): number | null {
    const alignment = deps.getAlignmentMatrix();
    const arWorldGroup = deps.getArWorldGroup();
    const camera = deps.getCamera();
    if (alignment === null || arWorldGroup === null || camera === null) {
      return null;
    }
    const arLocal = arWorldGroup.worldToLocal(
      camera.getWorldPosition(floorScratch),
    );
    arLocal.y = 0;
    return arLocal.applyMatrix4(alignmentScratch.fromArray(alignment)).y;
  }

  function toWorld(coord: TourCoord): Vector3 | null {
    const zero = deps.getGpsZeroRef();
    const alignment = deps.getAlignmentMatrix();
    const arWorldGroup = deps.getArWorldGroup();
    const floor = floorAltitude();
    // Any of these missing means there is no GPS-registered frame yet. A
    // position computed anyway would be expressed in the wrong frame — the
    // exact bug class `gps-anchor.ts`'s sidecar warns about — so report
    // "not known yet" instead.
    if (
      zero === null ||
      alignment === null ||
      arWorldGroup === null ||
      floor === null
    ) {
      return null;
    }

    const nue = calcRelativeCoordsInMeters(zero, coord, floor, 0);
    const local = nueToArLocal(alignment, [nue[0], nue[1], nue[2]]);
    arWorldGroup.updateWorldMatrix(true, false);
    return arWorldGroup.localToWorld(local);
  }

  function getUserWorldPos(): Vector3 | null {
    const camera = deps.getCamera();
    if (camera === null) return null;
    return camera.getWorldPosition(userScratch);
  }

  function createAnchor(object3D: Object3D, coord: TourCoord): SceneAnchor {
    const arWorldGroup = deps.getArWorldGroup();
    if (arWorldGroup === null) {
      throw new Error("Cannot anchor content before the AR session exists");
    }
    const camera = deps.getCamera();
    if (camera === null) {
      throw new Error("Cannot anchor content before the AR camera exists");
    }

    let requested: TourCoord = coord;
    let floorUsed = floorAltitude();
    const anchor = anchorFactory({
      object3D,
      arWorldGroup,
      camera,
      gpsPoint: onFloor(coord, floorUsed),
      // R1 — the authored coordinate is the truth; never re-derive it from
      // where the mesh currently sits.
      skipBootstrap: true,
      // Track the current alignment closely. The framework default gates a
      // correction on 2 m x (1 + 0.1 x distance), so a far stop kept a stale
      // position after a heading refinement (8 deg at 300 m = ~42 m) while the
      // trail (`toWorld`) followed the new one. The alignment is already
      // lerped on `arWorldGroup`, so per-frame re-solving does not visibly jump.
      distanceThreshold: ANCHOR_MOVE_THRESHOLD_M,
      mode: "snap-every-tick",
      getAlignmentMatrix: deps.getAlignmentMatrix,
      getGpsZeroRef: deps.getGpsZeroRef,
    });

    const objectScratch = new Vector3();
    // Once placed, stay anchored: later corrections between the tolerance and
    // the anchor's distance-scaled move threshold are never applied, so
    // re-checking every frame would freeze the waypoint's zone.
    let placed = false;

    const refreshFloor = (floor: number): void => {
      if (
        floorUsed !== null &&
        Math.abs(floor - floorUsed) < FLOOR_REFRESH_TOLERANCE_M
      ) {
        return;
      }
      floorUsed = floor;
      anchor.setGpsPoint(onFloor(requested, floor));
    };
    floorRefreshers.add(refreshFloor);

    return {
      // R2 — the gate. Anchored means: the framework anchor is past its own
      // bootstrap, a GPS-registered frame exists, AND the object has actually
      // been moved to where that frame says it belongs. Reading the anchor's
      // CURRENT `gpsPoint` (not the construction coord) keeps recycled
      // breadcrumb orbs, which are re-pointed via `setGpsPoint`, honest.
      get isFullyAnchored(): boolean {
        if (!anchor.isFullyAnchored) return false;
        const target = toWorld(anchor.gpsPoint);
        if (target === null) return false;
        if (placed) return true;
        object3D.updateWorldMatrix(true, false);
        placed =
          object3D.getWorldPosition(objectScratch).distanceTo(target) <=
          tolerance;
        return placed;
      },
      setGpsPoint(point: TourCoord): void {
        requested = point;
        placed = false;
        anchor.setGpsPoint(onFloor(point, floorUsed));
      },
      markMovedExternally(): void {
        anchor.markMovedExternally();
      },
      dispose(): void {
        floorRefreshers.delete(refreshFloor);
        anchor.dispose();
      },
    };
  }

  function update(): void {
    const floor = floorAltitude();
    if (floor === null) return;
    for (const refresh of floorRefreshers) refresh(floor);
  }

  return { createAnchor, toWorld, getUserWorldPos, update };
}
