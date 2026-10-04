/**
 * A typed door to 3d-tiles-renderer's `GeneratedSurfacePlugin` (globe plan
 * 2026-09-26-0539 §7.1). Version 0.5.3 exports the plugin from its JS but
 * ships no `.d.ts` for it, so this module re-exports the runtime constructor
 * behind a local interface covering the options the globe uses. A test fails
 * if the runtime export disappears; drop this file when upstream ships
 * typings.
 *
 * @see generated-surface-plugin.ts.md
 */

import * as plugins from "3d-tiles-renderer/plugins";
import type { ImageOverlay } from "3d-tiles-renderer/plugins";

/** The options this design uses (the library documents more). */
export interface GeneratedSurfacePluginOptions {
  /** The tiling scheme comes from this overlay. */
  readonly overlay?: ImageOverlay | null;
  /** `'ellipsoid'` (default) draws the tiles on the WGS84 ellipsoid. */
  readonly projection?: "ellipsoid" | "source";
  /** Texture the generated meshes with the overlay (default false). */
  readonly applyOverlayTexture?: boolean;
  /** Apply the library's recommended renderer settings (default true). */
  readonly useRecommendedSettings?: boolean;
}

export interface GeneratedSurfacePluginInstance {
  readonly overlay: ImageOverlay | null;
  readonly projection: string;
}

export type GeneratedSurfacePluginConstructor = new (
  options?: GeneratedSurfacePluginOptions,
) => GeneratedSurfacePluginInstance;

const runtime: unknown = (plugins as Record<string, unknown>)[
  "GeneratedSurfacePlugin"
];
if (typeof runtime !== "function") {
  throw new Error(
    "3d-tiles-renderer no longer exports GeneratedSurfacePlugin from its plugins entry",
  );
}

export const GeneratedSurfacePlugin =
  runtime as GeneratedSurfacePluginConstructor;
