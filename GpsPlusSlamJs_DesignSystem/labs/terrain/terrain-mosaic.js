/**
 * The terrain lab's tile set and mosaic (terrain plan 2026-09-27-0605 §4
 * "Data", §9 findings 5 and 15): which Terrarium tiles a region needs, and
 * one seamless elevation raster stitched from them.
 *
 * WHY A MOSAIC, not the Osm library's per-tile `TerrariumProvider`: that
 * provider samples each tile on its own and clamps at the tile's edge, so the
 * last half pixel before a boundary is flat and the next tile starts with a
 * step. Invisible at walking scale; at 250 km with the slope boost it is a
 * straight line across every ridge. Stitched first, a sample interpolates
 * across the boundary like anywhere else.
 *
 * Dependency-free on purpose (plan §9 finding 1): the Web Mercator maths is
 * the Osm library's `toWorldPixel`, INJECTED by the worker, so this file runs
 * under `node --test` and the formula exists once.
 *
 * @see terrain-mosaic.js.md
 */

/**
 * The tiles covering a set of world-pixel points, widened by one pixel: a
 * sample just inside a tile's edge interpolates with the neighbour's first
 * pixel centre, so the neighbour is needed too.
 *
 * @param {{ x: number, y: number }[]} points  world pixels at the tile zoom
 * @param {number} tileSize
 * @returns {{ x0: number, x1: number, y0: number, y1: number }} inclusive
 */
export function tileRangeFor(points, tileSize) {
  if (points.length === 0) throw new RangeError("no points to cover");
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError(`not a world pixel: ${x}, ${y}`);
    }
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {
    x0: Math.floor((minX - 1) / tileSize),
    x1: Math.floor((maxX + 1) / tileSize),
    y0: Math.floor((minY - 1) / tileSize),
    y1: Math.floor((maxY + 1) / tileSize),
  };
}

/**
 * Every tile a square field `±extentM` around the frame's origin needs, row
 * by row. The frame is equirectangular (the Osm library's `enuFrameAt`), so
 * the square's four corners bound it in Mercator too.
 *
 * @param {{ zoom: number, extentM: number, tileSize?: number }} spec
 * @param {{ toLatLng: (p: {x: number, y: number}) => {lat: number, lng: number},
 *   toWorldPixel: (p: {lat: number, lng: number}, zoom: number) => {x: number, y: number} }} geo
 * @returns {{ z: number, x: number, y: number }[]}
 */
export function regionTiles({ zoom, extentM, tileSize = 256 }, geo) {
  const corners = [
    [-extentM, -extentM],
    [extentM, -extentM],
    [-extentM, extentM],
    [extentM, extentM],
  ].map(([x, y]) => geo.toWorldPixel(geo.toLatLng({ x, y }), zoom));
  const range = tileRangeFor(corners, tileSize);
  const tiles = [];
  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) tiles.push({ z: zoom, x, y });
  }
  return tiles;
}

/**
 * One raster over the tile range; NaN where a tile did not arrive (no data,
 * never 0 m: sea level shaped like an outage reads as terrain).
 *
 * @param {{ x0: number, x1: number, y0: number, y1: number }} range
 * @param {{ x: number, y: number, size: number, samples: Float32Array }[]} tiles
 *   decoded tiles (`toElevationTile`'s shape); absent ones are the gaps
 * @param {number} tileSize
 */
export function createMosaic(range, tiles, tileSize) {
  const cols = range.x1 - range.x0 + 1;
  const rows = range.y1 - range.y0 + 1;
  const width = cols * tileSize;
  const height = rows * tileSize;
  const data = new Float32Array(width * height).fill(Number.NaN);
  const placed = new Set();
  for (const t of tiles) {
    if (t.size !== tileSize) {
      throw new RangeError(
        `tile ${t.x}/${t.y} is ${t.size} px, the mosaic expects ${tileSize}`,
      );
    }
    const col = t.x - range.x0;
    const row = t.y - range.y0;
    if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
    placed.add(`${col}/${row}`);
    for (let r = 0; r < tileSize; r++) {
      const from = r * tileSize;
      data.set(
        t.samples.subarray(from, from + tileSize),
        (row * tileSize + r) * width + col * tileSize,
      );
    }
  }
  return {
    /** The raster's top-left, in world pixels at the tile zoom. */
    originX: range.x0 * tileSize,
    originY: range.y0 * tileSize,
    width,
    height,
    data,
    missingTiles: cols * rows - placed.size,
  };
}

/**
 * Bilinear elevation at a world pixel, with each pixel's value at its CENTRE
 * (`i + 0.5`), or `undefined` where any of the four contributing pixels has
 * no data or the point lies outside the raster.
 *
 * @returns {number | undefined}
 */
export function sampleMosaic(mosaic, worldX, worldY) {
  const gx = worldX - mosaic.originX - 0.5;
  const gy = worldY - mosaic.originY - 0.5;
  if (!(
    gx >= 0 &&
    gy >= 0 &&
    gx <= mosaic.width - 1 &&
    gy <= mosaic.height - 1
  )) {
    return undefined;
  }
  const x0 = Math.min(mosaic.width - 2, Math.floor(gx));
  const y0 = Math.min(mosaic.height - 2, Math.floor(gy));
  const fx = gx - x0;
  const fy = gy - y0;
  const i = y0 * mosaic.width + x0;
  const d = mosaic.data;
  const top = d[i] * (1 - fx) + d[i + 1] * fx;
  const bottom = d[i + mosaic.width] * (1 - fx) + d[i + mosaic.width + 1] * fx;
  const value = top * (1 - fy) + bottom * fy;
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The mosaic as an elevation provider (the Osm library's `ElevationProvider`
 * shape), which is what OsmDemo's `buildHeightfieldData` reads: one batch
 * in, one batch out, `undefined` for no data.
 *
 * @param {ReturnType<typeof createMosaic>} mosaic
 * @param {(p: {lat: number, lng: number}) => {x: number, y: number}} toWorld
 *   lat/lng to world pixels at the mosaic's zoom
 */
export function mosaicProvider(mosaic, toWorld) {
  return {
    sourceId: "terrain-lab-mosaic",
    async elevationAt(positions) {
      return positions.map((p) => {
        const w = toWorld(p);
        return sampleMosaic(mosaic, w.x, w.y);
      });
    },
  };
}
