/**
 * The below-surface diagnostic geometry, built away from the renderer.
 *
 * `BuildingView` needs a WebGL context to construct, so anything built inside
 * it can only be checked by an e2e — and an e2e can see that pink lines
 * appeared without being able to say whether they are transparent, at the right
 * depth, or whether a node became a tick rather than nothing at all. Those are
 * the invariants that have actually broken here, so they live somewhere a unit
 * test can reach.
 *
 * @see underground-lines.ts.md
 */

import * as THREE from "three";

import { RENDER_ORDER } from "./layer-order.js";
import { UNDERGROUND_COLOUR } from "./surface-colours.js";

/**
 * How far below the ENU origin plane the lines are drawn, in metres.
 *
 * A FIXED DEPTH, not the feature's real one. OSM's `layer` is an ordering and
 * `level` is a storey index; neither is a distance, so deriving metres from
 * them would be a fabricated elevation. This is an honest "this is underneath".
 */
export const UNDERGROUND_DEPTH_M = -6;

/**
 * Half-height of the vertical tick standing in for a below-surface NODE.
 *
 * A node has no outline, and drawing nothing hides a whole class of excluded
 * feature — bins, subway entrances, shafts — from the one view meant to reveal
 * them. A short vertical mark reads as "something is here" without claiming a
 * footprint the data does not have.
 */
export const NODE_TICK_M = 1.5;

/**
 * Packs ENU outlines into line-segment vertices.
 *
 * Each outline is x,y pairs already in ENU metres, because the frame lives in
 * the worker where every other piece of scene geometry is built — a page that
 * converted lat/lng itself would need a second copy of the frame and would go
 * stale on every recentre.
 *
 * Returns an empty array when there is nothing to draw, which the caller uses
 * to skip allocating a geometry at all.
 */
export function undergroundVertices(
  outlines: readonly Float32Array[],
): number[] {
  const positions: number[] = [];
  for (const outline of outlines) {
    // A LONE POINT IS A NODE, and it gets a tick rather than being skipped.
    // "A segment needs two ends" silently dropped a whole class of excluded
    // feature from the diagnostic whose job is showing what was silently
    // dropped. The corpus fixture's only below-surface feature is such a node.
    if (outline.length === 2) {
      const x = outline[0] ?? 0;
      const y = outline[1] ?? 0;
      positions.push(x, UNDERGROUND_DEPTH_M - NODE_TICK_M, -y);
      positions.push(x, UNDERGROUND_DEPTH_M + NODE_TICK_M, -y);
      continue;
    }
    for (let i = 0; i + 3 < outline.length; i += 2) {
      positions.push(
        outline[i] ?? 0,
        UNDERGROUND_DEPTH_M,
        -(outline[i + 1] ?? 0),
      );
      positions.push(
        outline[i + 2] ?? 0,
        UNDERGROUND_DEPTH_M,
        -(outline[i + 3] ?? 0),
      );
    }
  }
  return positions;
}

/**
 * The line material.
 *
 * **`transparent` is load-bearing, not cosmetic.** `WebGLRenderer` splits its
 * render list into opaque / transmissive / transparent and draws opaque first;
 * `renderOrder` only sorts WITHIN a list. Shipped opaque, these lines drew
 * before the translucent affordance slabs and cell surfaces, which then blended
 * over them — ranked above both in `RENDER_ORDER` and losing to both on screen.
 *
 * `depthTest` is off because the lines are drawn BELOW the terrain and would
 * otherwise be occluded by the very ground they exist to be seen under.
 */
export function undergroundMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: UNDERGROUND_COLOUR,
    depthTest: false,
    transparent: true,
  });
}

/**
 * The drawable, or `undefined` when there is nothing below the surface.
 *
 * `undefined` rather than an empty `LineSegments` so the caller does not add a
 * zero-vertex object to the scene on every refresh of a corpus that has no
 * excluded features — which is the common case.
 */
export function buildUndergroundLines(
  outlines: readonly Float32Array[],
):
  | THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  | undefined {
  const positions = undergroundVertices(outlines);
  if (positions.length === 0) return undefined;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  );
  const lines = new THREE.LineSegments(geometry, undergroundMaterial());
  lines.renderOrder = RENDER_ORDER.underground;
  return lines;
}
