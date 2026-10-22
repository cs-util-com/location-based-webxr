/**
 * An imagery for the relief that draws none: every terrain tile wears its
 * template material's own colour. For a caller that wants the relief's
 * shape and its own overlays (the OSM map near the camera) without the
 * globe's whole-Earth imagery, whose files only the globe's own pages
 * serve.
 *
 * @see globe-plain-imagery.ts.md
 */
import type { TerrainImagery } from "./globe-terrain.js";

/**
 * The plain imagery: plate carree (as the terrain requires), one level, no
 * content anywhere, so the terrain plugin never locks or reads a texture.
 * A texture asked for anyway is an Error (a caller bug, never a blank).
 */
export function plainImagery(): TerrainImagery {
  return {
    tiling: Object.freeze({
      maxLevel: 0,
      projection: Object.freeze({ scheme: "EPSG:4326" }),
    }),
    init: () => Promise.resolve(),
    hasContent: () => false,
    lockTexture: () => Promise.resolve(null),
    getTexture: () => {
      throw new Error("the plain imagery has no texture");
    },
    releaseTexture: () => {},
  };
}
