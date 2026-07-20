/**
 * Pure target feed for the wayfinding HUD (F2).
 *
 * Maps the app's single anchor marker to the HUD's `getTargets()` contract:
 * the marker's world position while it is visible, and no targets otherwise.
 * The visibility gate matters on the `?show=` cache-hit path — the marker
 * stays hidden (at the AR origin) until the first GPS alignment arrives, and
 * the HUD must not guide the user to that meaningless origin pose.
 */

import { Vector3 } from "three";
import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-hud";

/**
 * The structural slice of a marker the HUD feed needs. Matches both a real
 * `THREE.Object3D` and the duck-typed marker used by the e2e fakes.
 */
export interface HudTargetMarker {
  visible: boolean;
  getWorldPosition(out: Vector3): Vector3;
}

/** Stable per-target state key for the app's single anchor (the HUD keys
 * hysteresis state by id — 2026-07-20 per-target config plan). */
const ANCHOR_TARGET_ID = "anchor";

/**
 * Current HUD targets for the app's anchor marker.
 *
 * Returns one `WayfindingTarget` at the marker's world position while the
 * marker exists and is visible; an empty list otherwise (no marker yet, or
 * hidden awaiting the first alignment). Fresh literals per call are safe:
 * the constant id keeps the HUD's per-target hysteresis state stable.
 */
export function hudTargetsFromMarker(
  marker: HudTargetMarker | null,
): WayfindingTarget[] {
  if (!marker || !marker.visible) return [];
  return [
    { id: ANCHOR_TARGET_ID, position: marker.getWorldPosition(new Vector3()) },
  ];
}
