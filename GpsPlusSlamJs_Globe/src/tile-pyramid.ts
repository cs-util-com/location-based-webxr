/**
 * The EPSG:4326 XYZ tile pyramid the globe's imagery is cut to (globe plan
 * 2026-09-26-0539 §7.4): the layout of 3d-tiles-renderer's 4326 tiling with
 * a `{y}` URL template, so the committed tiles line up with the ellipsoid.
 *
 * Level z has 2·2^z columns and 2^z rows of (180 / 2^z)-degree tiles;
 * x counts east from 180°W, y counts SOUTH from 90°N (the library flips y
 * for a plain `{y}` template).
 *
 * @see tile-pyramid.ts.md
 */

export interface GeoBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface TileKey {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The tile's box in degrees.
 *
 * @throws RangeError for a level below 0 or a tile outside its level.
 */
export function tileBBox4326(x: number, y: number, z: number): GeoBox {
  if (!(Number.isInteger(z) && z >= 0)) {
    throw new RangeError(`level must be a non-negative integer, got ${z}`);
  }
  const rows = 2 ** z;
  const columns = 2 * rows;
  if (!(Number.isInteger(x) && x >= 0 && x < columns)) {
    throw new RangeError(
      `x must be in [0, ${columns}) at level ${z}, got ${x}`,
    );
  }
  if (!(Number.isInteger(y) && y >= 0 && y < rows)) {
    throw new RangeError(`y must be in [0, ${rows}) at level ${z}, got ${y}`);
  }
  const size = 180 / rows;
  return {
    west: -180 + x * size,
    south: 90 - (y + 1) * size,
    east: -180 + (x + 1) * size,
    north: 90 - y * size,
  };
}

/** The WMS 1.3.0 BBOX for EPSG:4326: latitude first (south,west,north,east). */
export function wmsBBox(box: GeoBox): string {
  return `${box.south},${box.west},${box.north},${box.east}`;
}

/** Every tile from level 0 to `maxLevel`, level by level. */
export function pyramidTiles(maxLevel: number): TileKey[] {
  const tiles: TileKey[] = [];
  for (let z = 0; z <= maxLevel; z++) {
    const rows = 2 ** z;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < 2 * rows; x++) tiles.push({ x, y, z });
    }
  }
  return tiles;
}
