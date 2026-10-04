/**
 * The terrain lab's data chain, decoded tiles to the metric grid (terrain
 * plan 2026-09-27-0605 §4 "Data", §9 finding 5): stitch the tiles
 * (`terrain-mosaic.js`), resample onto the ENU grid with OsmDemo's
 * `buildHeightfieldData`, make it datum-relative with OsmDemo's
 * `terrainTextureFrom`, and mark the posts that had no data.
 *
 * WHY THE DEPENDENCIES ARE INJECTED: the worker loads them from served
 * routes (`/osm-lib/`, `/osm/`), which Node cannot resolve; the test loads
 * the same TypeScript sources from the repo and passes them in, so the
 * chain tested is the chain that runs (review of T0/T1, finding 6).
 *
 * @see terrain-pipeline.js.md
 */
import { createMosaic, mosaicProvider } from "./terrain-mosaic.js";

const TILE_SIZE = 256;

/**
 * @param {{ decoded: { x: number, y: number, size: number, samples: Float32Array }[],
 *   range: { x0: number, x1: number, y0: number, y1: number },
 *   spec: { centre: {lat: number, lng: number}, zoom: number, extentM: number,
 *     spacingM: number, side: number },
 *   deps: { toWorldPixel: Function, enuFrameAt: Function,
 *     buildHeightfieldData: Function, terrainTextureFrom: Function } }} input
 * @returns {Promise<{ side: number, height: Float32Array, valid: Uint8Array,
 *   datum: number, hasData: boolean, missing: number, total: number,
 *   reliefM: number, missingTiles: number }>}
 *   `height` is datum-relative, row 0 at the SOUTH edge; `valid` is 1 where
 *   the post is data, 0 where the heightfield filled it.
 */
export async function reliefField({ decoded, range, spec, deps }) {
  const mosaic = createMosaic(range, decoded, TILE_SIZE);
  const inner = mosaicProvider(mosaic, (p) => deps.toWorldPixel(p, spec.zoom));
  // The heightfield fills a missing post from the mean of the rest (never
  // 0 m). The raw answers are kept to mark those posts as no data.
  let raw = [];
  const provider = {
    sourceId: inner.sourceId,
    async elevationAt(positions, signal) {
      raw = await inner.elevationAt(positions, signal);
      return raw;
    },
  };
  const field = await deps.buildHeightfieldData(provider, {
    frame: deps.enuFrameAt(spec.centre),
    extentM: spec.extentM,
    spacingM: spec.spacingM,
  });
  const side = spec.side;
  const n = side * side;
  // The page allocates its textures from `spec.side`: a field of another
  // side would be read with the wrong row stride (review finding 4).
  if (field.hasData && field.side !== side) {
    throw new Error(
      `heightfield side ${field.side} is not the spec's ${side}; the grid would be misread`,
    );
  }
  const valid = new Uint8Array(n);
  // Datum-relative, as OsmDemo's GPU terrain stores it: small values keep
  // half floats precise (1 m steps up to 2 km of relief).
  const height = field.hasData
    ? deps.terrainTextureFrom(field).data
    : new Float32Array(n);
  if (field.hasData) {
    for (let i = 0; i < n; i++) valid[i] = raw[i] === undefined ? 0 : 1;
  }
  return {
    side,
    height,
    valid,
    datum: field.datum,
    hasData: field.hasData,
    missing: field.missing,
    total: field.total,
    reliefM: field.reliefM,
    missingTiles: mosaic.missingTiles,
  };
}
