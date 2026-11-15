/**
 * The light dialog's measurement of the view as it stands: the lit-surface
 * brightness with the heat grid hidden, and the chroma the grid adds. The
 * order of renders, AO passes and readbacks lives here, apart from the
 * renderer, so its cost can be counted in a unit test.
 *
 * @see light-measure.ts.md
 */
import type * as THREE from "three";

import { litSurfaceLuma, meanChroma } from "./light-readouts.js";

/** The two calls of the view's ambient occlusion this measurement uses. */
interface LightMeasureAo {
  /** Computes the AO and multiplies it onto the frame just drawn. */
  render(): boolean;
  /** Multiplies the AO last computed onto the frame just drawn, or refuses. */
  reapply(): boolean;
}

export interface LightMeasureDeps {
  /** The heat grid's objects (its mesh, its outlines); hidden or absent ones are skipped. */
  readonly grid: readonly (THREE.Object3D | undefined)[];
  /** Whether to measure the grid's margin, which costs the second read. */
  readonly withMargin: boolean;
  /** Draws the scene to the canvas as a frame does, without the AO. */
  readonly drawScene: () => void;
  readonly ambientOcclusion: LightMeasureAo;
  /** Whether the AO's normal/depth pass leaves `object` out. */
  readonly hiddenFromAo: (object: THREE.Object3D) => boolean;
  /** Reads the frame just drawn, RGBA. */
  readonly readFrame: () => Uint8Array;
  /** Schedules a frame; called only when the canvas does not show the view as found. */
  readonly requestFrame: () => void;
}

export interface LightMeasurement {
  readonly litLuma: number;
  /** `null` when no grid is shown or the margin was not asked for. */
  readonly margin: number | null;
}

/** Whether any mesh under `root` is drawn into the AO's normal pass. */
function seenByAo(
  root: THREE.Object3D,
  hiddenFromAo: (object: THREE.Object3D) => boolean,
): boolean {
  let seen = false;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh === true && !hiddenFromAo(o)) seen = true;
  });
  return seen;
}

/**
 * Renders and reads the view without the grid, then (for the margin) with
 * it. The grid is restored as found, also when a render throws.
 */
export function measureLightReadouts(deps: LightMeasureDeps): LightMeasurement {
  const grid = deps.grid.filter(
    (o): o is THREE.Object3D => o !== undefined && o.visible,
  );
  const withMargin = deps.withMargin && grid.length > 0;
  // THE AO STAYS VALID ACROSS THE TOGGLE when its normal pass leaves every
  // grid object out (the shipped see-through faces and the outlines): the
  // second read then multiplies the same AO again instead of computing it.
  const aoUnchanged = !grid.some((o) => seenByAo(o, deps.hiddenFromAo));
  // Whether the canvas holds the view as found: set once the reads finished,
  // true when the last read drew the grid as it is restored or no grid is
  // shown. A read that threw leaves it false, so a frame is requested.
  let showsView = false;
  try {
    for (const o of grid) o.visible = false;
    deps.drawScene();
    deps.ambientOcclusion.render();
    const without = deps.readFrame();
    const litLuma = litSurfaceLuma(without);
    let margin: number | null = null;
    if (withMargin) {
      for (const o of grid) o.visible = true;
      deps.drawScene();
      if (!(aoUnchanged && deps.ambientOcclusion.reapply())) {
        deps.ambientOcclusion.render();
      }
      margin = meanChroma(deps.readFrame()) - meanChroma(without);
    }
    showsView = withMargin || grid.length === 0;
    return { litLuma, margin };
  } finally {
    for (const o of grid) o.visible = true;
    if (!showsView) deps.requestFrame();
  }
}
