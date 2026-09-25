/**
 * The single "walk here next" guide (plan 2026-09-17-breadcrumb-wayfinding).
 *
 * Owns one `createWayfindingHud` instance (the framework's arrow/ring/label
 * presenter) pointed at exactly one target at a time: the current nearest
 * unvisited breadcrumb, re-pointed as the orchestrator advances it. The
 * target's world position tracks the same GPS anchor + alignment machinery
 * `breadcrumb-orbs.ts` uses for the orb trail (not a one-shot `toWorld`
 * snapshot) — a visitor can spend 10-30 s walking toward a target, during
 * which the alignment lerper keeps adjusting, and the target must drift
 * with it exactly like every other anchored object in the scene.
 *
 * `autoRegisterFrameUpdate: false` — ticked manually via `update()` from
 * `SceneAdapter.update()`, which every host (real AR, desktop preview,
 * replay) already calls deterministically once per orchestrator tick.
 *
 * A fresh `id: \`bc-${index}\`` is given on every swap so the framework's
 * per-target hysteresis state never carries over from the previous, unrelated
 * breadcrumb (see plans/2026-09-17-breadcrumb-wayfinding-implementation-plan.md,
 * Task 4).
 */

import { Object3D, Vector3 } from "three";
import type { PerspectiveCamera } from "three";
import {
  createWayfindingHud,
  type WayfindingHud,
} from "gps-plus-slam-app-framework/visualization";

import type { TourCoord } from "../../../store/types.js";
import type { WayfindingTarget } from "../runtime/scene-adapter.js";
import type { OrbAnchor } from "./breadcrumb-orbs.js";

/** Fresh per-target id, distinct across kinds so a waypoint target never
 *  reuses a breadcrumb index's hysteresis state, or vice versa. */
function targetKey(target: WayfindingTarget): string {
  return target.kind === "breadcrumb"
    ? `bc-${target.index}`
    : `wp-${target.id}`;
}

type AnchorFactory = (object3D: Object3D, coord: TourCoord) => OrbAnchor;

export interface BreadcrumbGuideOptions {
  readonly parent: Object3D;
  readonly camera: PerspectiveCamera;
  readonly anchorFactory: AnchorFactory;
  readonly distanceMinM: number;
  readonly distanceMaxM: number;
}

export interface BreadcrumbGuide {
  setTarget(target: WayfindingTarget | null): void;
  /**
   * World positions of every currently-ACTIVE waypoint. While any of them
   * is roughly in front of the camera, the indicator is suppressed — its
   * picture/model is up close and the guide's fixed ring would otherwise
   * float in front of it. Not tied to the ACTIVE zone's whole lifetime: a
   * waypoint that stays ACTIVE but falls out of view (the visitor walked
   * past and turned away) no longer suppresses anything.
   */
  setActiveWaypointPositions(positions: readonly Vector3[]): void;
  update(dtSeconds: number): void;
  dispose(): void;
}

/** Generous margin over the camera's own vertical half-FOV — content just
 *  at the edge of view still counts as "in the way", not only dead centre. */
const IN_VIEW_HALF_ANGLE_FACTOR = 1.3;

function isActiveContentInView(
  camera: PerspectiveCamera,
  activePositions: readonly Vector3[],
): boolean {
  if (activePositions.length === 0) return false;
  const camPos = camera.getWorldPosition(new Vector3());
  const forward = camera.getWorldDirection(new Vector3());
  const halfFovRad = (camera.fov / 2) * (Math.PI / 180);
  const cosThreshold = Math.cos(halfFovRad * IN_VIEW_HALF_ANGLE_FACTOR);
  return activePositions.some((p) => {
    const dir = p.clone().sub(camPos);
    if (dir.lengthSq() === 0) return true;
    return dir.normalize().dot(forward) > cosThreshold;
  });
}

export function createBreadcrumbGuide(
  options: BreadcrumbGuideOptions,
): BreadcrumbGuide {
  const marker = new Object3D();
  options.parent.add(marker);

  let anchor: OrbAnchor | null = null;
  let currentKey: string | null = null;
  let currentCoord: TourCoord | null = null;
  let activeWaypointPositions: readonly Vector3[] = [];

  const hud: WayfindingHud = createWayfindingHud({
    camera: options.camera,
    getTargets: () => {
      if (currentKey === null) return [];
      if (isActiveContentInView(options.camera, activeWaypointPositions)) {
        return [];
      }
      // The anchor may have moved `marker` since the last render tick (real
      // AR mode updates it via the alignment lerp loop, which runs before
      // this, but nothing guarantees that ordering in every host) — force
      // the world matrix current rather than reading a stale one.
      marker.updateWorldMatrix(true, false);
      return [
        {
          id: currentKey,
          position: marker.getWorldPosition(new Vector3()),
        },
      ];
    },
    distanceMin: options.distanceMinM,
    distanceMax: options.distanceMaxM,
    autoRegisterFrameUpdate: false,
  });

  return {
    setActiveWaypointPositions(positions: readonly Vector3[]): void {
      activeWaypointPositions = positions;
    },

    setTarget(target: WayfindingTarget | null): void {
      if (target === null) {
        currentKey = null;
        currentCoord = null;
        return;
      }
      const key = targetKey(target);
      if (currentKey === key && currentCoord === target.coord) {
        return; // already pointed here
      }
      currentKey = key;
      currentCoord = target.coord;
      if (anchor === null) {
        anchor = options.anchorFactory(marker, target.coord);
      } else {
        anchor.setGpsPoint(target.coord);
        anchor.markMovedExternally();
      }
    },

    update(dtSeconds: number): void {
      hud.update(dtSeconds);
    },

    dispose(): void {
      hud.dispose();
      anchor?.dispose();
      marker.removeFromParent();
    },
  };
}
