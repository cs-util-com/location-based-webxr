/**
 * Which affordance cells does a geometry touch?
 *
 * The bridge between OSM geometry and the H3 grid, and the hot path: the whole
 * scoring pipeline is "for each feature, for each cell it covers, multiply".
 *
 * **Semantics: TOUCHED, not contained.** A cell a building merely clips is
 * exactly the case that must be vetoed — an affordance index that dropped
 * partially-covered cells would report the ground under a building's edge as
 * walkable. This matches the C# reference's binary-overlap behaviour, which is
 * what keeps its published oracle values valid.
 *
 * @see cell-coverage.ts.md
 */

import {
  latLngToCell,
  polygonToCellsExperimental,
  POLYGON_TO_CELLS_FLAGS,
  gridDisk,
  gridPathCells,
  cellToLatLng,
} from "h3-js";
import type { LatLng } from "../model/osm-feature.js";
import type { OsmGeometry } from "../model/osm-geometry.js";
import { AFFORDANCE_RES } from "./resolutions.js";

/** One cell a feature touches, with how much of it the feature covers. */
export interface CellCoverage {
  readonly cell: string;
  /**
   * Share of the cell covered, in `(0, 1]`.
   *
   * **Hardcoded to `1.0` in v1 — this is NOT a computed value.** The C#
   * reference's overlap is binary (a 4 m cell grazed by a 1 cm corner is vetoed
   * exactly as hard as one entirely inside), and carrying that flaw forward is
   * what keeps its published oracle values usable as a test oracle. The field
   * exists and is populated so a coverage-weighted mode can arrive later
   * without a data-model change.
   *
   * Stated explicitly here rather than implied, so the next reader does not
   * mistake `1` for a measurement.
   */
  readonly fraction: number;
}

/**
 * The cells a geometry touches.
 *
 * Returns cells in no particular order and with no duplicates. An empty result
 * is possible and legitimate — a degenerate ring, or a linestring of one point
 * that h3 places outside the grid.
 */
export function coverCells(
  geometry: OsmGeometry,
  resolution: number = AFFORDANCE_RES,
): CellCoverage[] {
  const cells = new Set<string>();

  switch (geometry.kind) {
    case "point":
      addPoint(cells, geometry.position, resolution);
      break;
    case "linestring":
      addLineString(cells, geometry.positions, resolution);
      break;
    case "multilinestring":
      // Each run is covered SEPARATELY and the results unioned. Covering them
      // as one sequence would supercover the gap between runs, which is the
      // fabricated coverage `clip.ts` splits the runs to avoid in the first
      // place — the bug would simply move one module downstream.
      for (const line of geometry.lines) addLineString(cells, line, resolution);
      break;
    case "polygon":
      addPolygon(cells, geometry.rings, resolution);
      break;
    case "multipolygon":
      for (const rings of geometry.polygons)
        addPolygon(cells, rings, resolution);
      break;
  }

  return [...cells].map((cell) => ({ cell, fraction: 1 }));
}

function addPoint(cells: Set<string>, position: LatLng, res: number): void {
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return;
  cells.add(latLngToCell(position.lat, position.lng, res));
}

/**
 * Polygon coverage via `polygonToCellsExperimental`.
 *
 * **`containmentOverlapping`, not plain `polygonToCells`.** The stable
 * `polygonToCells` is centre-containment only, so a cell a building clips
 * through — but whose centre falls outside — is silently dropped. That is
 * precisely the cell an affordance index must veto.
 *
 * The function is marked *experimental* upstream, which is why it is wrapped
 * here and pinned by our own semantics test rather than trusted to keep its
 * name and behaviour. h3-js `>= 4.2.1` is the floor that has it.
 *
 * Holes are subtracted: h3's polygon format takes `[outer, ...holes]` and
 * honours them, so a courtyard inside a building is correctly not covered by
 * the building.
 */
function addPolygon(
  cells: Set<string>,
  rings: readonly (readonly LatLng[])[],
  res: number,
): void {
  const outer = rings[0];
  if (outer === undefined || outer.length < 3) return;

  // h3-js wants [lat, lng] pairs, outer ring first, holes after.
  const polygon = rings
    .filter((ring) => ring.length >= 3)
    .map((ring) => ring.map((p) => [p.lat, p.lng] as [number, number]));

  const before = cells.size;
  for (const cell of polygonToCellsExperimental(
    polygon,
    res,
    POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
  )) {
    cells.add(cell);
  }

  // Belt-and-braces: guarantee a small feature is never invisible — a 2 m kiosk
  // must still veto the cell it stands in.
  //
  // **Measured, this never fires.** `containmentOverlapping` returns at least
  // one cell for any valid ring, down to a 1 mm square (pinned by test). The
  // fallback survives because `polygonToCellsExperimental` is an EXPERIMENTAL
  // upstream API: if its small-polygon behaviour ever changes, this is what
  // stops the change from silently deleting features, and the pinning test is
  // what makes the change visible.
  //
  // Compared against THIS polygon's contribution (`before`), not the shared
  // accumulator. `cells` is threaded through every ring of a multipolygon, so a
  // `cells.size === 0` test could only ever be true while the FIRST part was
  // being processed — meaning a sub-cell second part would get no fallback,
  // which is exactly the silent drop the guard exists to prevent.
  if (cells.size === before) {
    for (const point of outer) addPoint(cells, point, res);
  }
}

/**
 * Supercover rasterisation of a linestring.
 *
 * Every cell the line passes through, not merely the cells its vertices land
 * in. A road sampled only at its vertices would leave gaps wherever the vertex
 * spacing exceeds the cell size — and OSM ways are frequently mapped as long
 * straight segments between distant nodes, so the gaps would be the norm rather
 * than the exception. A 200 m straight road between two nodes covers ~49 res-13
 * cells and would otherwise register as 2.
 *
 * `gridPathCells` gives the H3 line between two cells, which is the grid
 * equivalent of a supercover: contiguous, and passing through every cell the
 * segment crosses.
 */
function addLineString(
  cells: Set<string>,
  positions: readonly LatLng[],
  res: number,
): void {
  const vertexCells: string[] = [];
  for (const position of positions) {
    if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
      continue;
    }
    vertexCells.push(latLngToCell(position.lat, position.lng, res));
  }

  for (const cell of vertexCells) cells.add(cell);

  for (let i = 1; i < vertexCells.length; i++) {
    const from = vertexCells[i - 1]!;
    const to = vertexCells[i]!;
    if (from === to) continue;
    try {
      for (const cell of gridPathCells(from, to)) cells.add(cell);
    } catch {
      // gridPathCells throws when the endpoints are too far apart for h3 to
      // path between them (it fails across pentagon distortion and at very long
      // distances). Falling back to the endpoints keeps the feature visible
      // rather than dropping a whole way — and the gap is bounded by the segment
      // length, which is exactly the case a supercover would have filled.
      cells.add(from);
      cells.add(to);
    }
  }
}

/**
 * The cells within `rings` grid steps of any cell in `cells`.
 *
 * Used to grow a coverage set when a feature should influence its surroundings
 * rather than only what it overlaps. Not used by v1 scoring — the C# oracle is
 * strict overlap — but the reference declares an unread
 * `DISTANCE_FOR_CLOSE_BY_SURFACE_CATEGORY_CHECKS = 15`, so the capability is
 * likely to be wanted.
 */
export function dilate(cells: readonly string[], rings: number): string[] {
  if (rings <= 0) return [...new Set(cells)];
  const grown = new Set<string>();
  for (const cell of cells) {
    for (const neighbour of gridDisk(cell, rings)) grown.add(neighbour);
  }
  return [...grown];
}

/** Centre of a cell, as the `LatLng` this package uses everywhere else. */
export function cellCentre(cell: string): LatLng {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}
