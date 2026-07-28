/**
 * Clipping geometry to a bounding box.
 *
 * **Why this exists, and it is not an optimisation.** Feature coverage is
 * computed at res 13 (4 m cells) but only ever *read* over a ~931-cell working
 * set. Without clipping, covering a feature costs time proportional to the
 * FEATURE's size rather than the working set's — and OSM contains features of
 * continental extent. The `beach` fixture is the proof: a single element, the
 * entire North Sea relation, whose res-13 coverage is on the order of 10^10
 * cells. Filtering that down to the working set afterwards is not slow, it is
 * non-terminating in any practical sense.
 *
 * So the area of interest is applied FIRST, to the geometry, and only the
 * clipped remainder is handed to H3.
 *
 * @see clip.ts.md
 */

import type { LatLng } from "../model/osm-feature.js";
import type { OsmGeometry } from "../model/osm-geometry.js";

export interface Bbox {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** The bounding box of a set of positions, or undefined if there are none. */
export function boundsOf(positions: Iterable<LatLng>): Bbox | undefined {
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let any = false;

  for (const { lat, lng } of positions) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    any = true;
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  return any ? { south, west, north, east } : undefined;
}

/** Every position a geometry contains. */
export function* positionsOf(geometry: OsmGeometry): Generator<LatLng> {
  switch (geometry.kind) {
    case "point":
      yield geometry.position;
      return;
    case "linestring":
      yield* geometry.positions;
      return;
    case "polygon":
      for (const ring of geometry.rings) yield* ring;
      return;
    case "multipolygon":
      for (const rings of geometry.polygons) {
        for (const ring of rings) yield* ring;
      }
  }
}

/** Grows a box by `margin` degrees on every side. */
export function padBbox(bbox: Bbox, margin: number): Bbox {
  return {
    south: bbox.south - margin,
    west: bbox.west - margin,
    north: bbox.north + margin,
    east: bbox.east + margin,
  };
}

export function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return (
    a.west <= b.east &&
    b.west <= a.east &&
    a.south <= b.north &&
    b.south <= a.north
  );
}

/**
 * Clips a geometry to `bbox`, returning `undefined` when nothing remains.
 *
 * Points and linestrings are handled by rejection and segment splitting;
 * polygons by Sutherland–Hodgman against each of the four edges.
 *
 * **Sutherland–Hodgman is convex-clip-only, which is exactly this case** (a
 * bbox is convex). It can produce degenerate "seams" for concave subjects — an
 * artefact that matters for rendering and does not matter here, because the
 * result is immediately rasterised to cells and a zero-width seam covers the
 * cells its neighbours already cover.
 */
export function clipToBbox(
  geometry: OsmGeometry,
  bbox: Bbox,
): OsmGeometry | undefined {
  switch (geometry.kind) {
    case "point":
      return containsPoint(bbox, geometry.position) ? geometry : undefined;

    case "linestring": {
      const positions = clipLine(geometry.positions, bbox);
      return positions.length === 0
        ? undefined
        : { kind: "linestring", positions };
    }

    case "polygon": {
      const rings = clipRings(geometry.rings, bbox);
      return rings === undefined ? undefined : { kind: "polygon", rings };
    }

    case "multipolygon": {
      const polygons = geometry.polygons
        .map((rings) => clipRings(rings, bbox))
        .filter((rings): rings is LatLng[][] => rings !== undefined);
      return polygons.length === 0
        ? undefined
        : { kind: "multipolygon", polygons };
    }
  }
}

function containsPoint(bbox: Bbox, p: LatLng): boolean {
  return (
    p.lat >= bbox.south &&
    p.lat <= bbox.north &&
    p.lng >= bbox.west &&
    p.lng <= bbox.east
  );
}

/**
 * Keeps the parts of a linestring that touch the box.
 *
 * **A SEGMENT test, not a vertex test — and the difference is a silent scoring
 * hole.** The original version kept a vertex only when it, its predecessor or
 * its successor lay *inside* the box. For a segment straddling the box with
 * both endpoints outside, none of those holds, so the entire way was dropped
 * and contributed no cells at all.
 *
 * That is not an exotic case: `cell-coverage.ts` documents long straight ways
 * between distant nodes as the OSM norm, and the working-set box is only a few
 * hundred metres across. A motorway, railway, river or power line crossing the
 * user's area would score the multiplicative identity — indistinguishable from
 * unmapped ground.
 *
 * Deliberately still coarse: when a segment touches the box, BOTH its endpoints
 * are kept rather than the exact intersection points. Over-keeping costs a few
 * cells outside the working set, which are filtered downstream anyway;
 * under-keeping loses road. The supercover rasteriser then fills the crossing.
 */
function clipLine(positions: readonly LatLng[], bbox: Bbox): LatLng[] {
  if (positions.length === 1) {
    return containsPoint(bbox, positions[0]!) ? [positions[0]!] : [];
  }

  const keep = new Set<number>();
  for (let i = 0; i + 1 < positions.length; i++) {
    if (segmentTouchesBbox(positions[i]!, positions[i + 1]!, bbox)) {
      keep.add(i);
      keep.add(i + 1);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => positions[i]!);
}

/**
 * Cohen–Sutherland region codes, for the segment/box test below.
 *
 * Plain numeric constants rather than an enum: these are combined with bitwise
 * `|` and `&`, which a TS enum type makes awkward to express without either
 * casts or `no-unsafe-enum-comparison` complaints. A bitmask is not really an
 * enumeration.
 */
const OUTCODE_INSIDE = 0;
const OUTCODE_WEST = 1;
const OUTCODE_EAST = 2;
const OUTCODE_SOUTH = 4;
const OUTCODE_NORTH = 8;

function outcodeOf(lat: number, lng: number, bbox: Bbox): number {
  let code = OUTCODE_INSIDE;
  if (lng < bbox.west) code |= OUTCODE_WEST;
  else if (lng > bbox.east) code |= OUTCODE_EAST;
  if (lat < bbox.south) code |= OUTCODE_SOUTH;
  else if (lat > bbox.north) code |= OUTCODE_NORTH;
  return code;
}

/**
 * Does the segment `a`–`b` intersect the box at all?
 *
 * Cohen–Sutherland: if both endpoints share an outside region the segment is
 * trivially rejected; if either is inside it is trivially accepted; otherwise
 * the segment is clipped against one violated edge and retested. Terminates
 * because each iteration moves an endpoint onto a boundary, strictly reducing
 * the set of violated edges.
 */
function segmentTouchesBbox(a: LatLng, b: LatLng, bbox: Bbox): boolean {
  let ax = a.lng;
  let ay = a.lat;
  let bx = b.lng;
  let by = b.lat;
  let codeA = outcodeOf(ay, ax, bbox);
  let codeB = outcodeOf(by, bx, bbox);

  // Bounded iteration: at most one clip per edge, plus slack for float noise.
  for (let guard = 0; guard < 8; guard++) {
    if ((codeA | codeB) === OUTCODE_INSIDE) return true; // both inside
    if ((codeA & codeB) !== 0) return false; // both beyond the same edge

    const outside = codeA !== OUTCODE_INSIDE ? codeA : codeB;
    const clipped = clipEndpointToEdge(outside, ax, ay, bx, by, bbox);
    if (clipped === undefined) return false;

    if (outside === codeA) {
      ax = clipped.lng;
      ay = clipped.lat;
      codeA = outcodeOf(ay, ax, bbox);
    } else {
      bx = clipped.lng;
      by = clipped.lat;
      codeB = outcodeOf(by, bx, bbox);
    }
  }
  // Degenerate input the loop could not settle. Keeping the segment is the safe
  // direction: an extra cell is filtered downstream, a lost one is invisible.
  return true;
}

/**
 * Moves the endpoint that violates `outside` onto the corresponding box edge.
 *
 * Returns `undefined` when the intersection is not finite — a vertical segment
 * tested against a horizontal edge, or coordinates that are already NaN. Callers
 * treat that as "no intersection", which is correct: a segment we cannot
 * intersect with an edge does not cross it.
 */
function clipEndpointToEdge(
  outside: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  bbox: Bbox,
): LatLng | undefined {
  let lng: number;
  let lat: number;

  if ((outside & OUTCODE_NORTH) !== 0) {
    lng = ax + ((bx - ax) * (bbox.north - ay)) / (by - ay);
    lat = bbox.north;
  } else if ((outside & OUTCODE_SOUTH) !== 0) {
    lng = ax + ((bx - ax) * (bbox.south - ay)) / (by - ay);
    lat = bbox.south;
  } else if ((outside & OUTCODE_EAST) !== 0) {
    lat = ay + ((by - ay) * (bbox.east - ax)) / (bx - ax);
    lng = bbox.east;
  } else {
    lat = ay + ((by - ay) * (bbox.west - ax)) / (bx - ax);
    lng = bbox.west;
  }

  return Number.isFinite(lng) && Number.isFinite(lat)
    ? { lat, lng }
    : undefined;
}

function clipRings(
  rings: readonly (readonly LatLng[])[],
  bbox: Bbox,
): LatLng[][] | undefined {
  const outer = rings[0];
  if (outer === undefined) return undefined;

  const clippedOuter = clipRing(outer, bbox);
  if (clippedOuter.length < 3) return undefined;

  const holes = rings
    .slice(1)
    .map((ring) => clipRing(ring, bbox))
    .filter((ring) => ring.length >= 3);

  return [clippedOuter, ...holes];
}

/** Sutherland–Hodgman against the four edges of the box. */
function clipRing(ring: readonly LatLng[], bbox: Bbox): LatLng[] {
  let output: LatLng[] = [...ring];
  const edges: ((p: LatLng) => boolean)[] = [
    (p) => p.lng >= bbox.west,
    (p) => p.lng <= bbox.east,
    (p) => p.lat >= bbox.south,
    (p) => p.lat <= bbox.north,
  ];
  const intersectors: ((a: LatLng, b: LatLng) => LatLng)[] = [
    (a, b) => atLng(a, b, bbox.west),
    (a, b) => atLng(a, b, bbox.east),
    (a, b) => atLat(a, b, bbox.south),
    (a, b) => atLat(a, b, bbox.north),
  ];

  for (let e = 0; e < edges.length && output.length > 0; e++) {
    const inside = edges[e]!;
    const intersect = intersectors[e]!;
    const input = output;
    output = [];

    for (let i = 0; i < input.length; i++) {
      const current = input[i]!;
      const previous = input[(i - 1 + input.length) % input.length]!;
      const currentIn = inside(current);
      const previousIn = inside(previous);

      if (currentIn) {
        if (!previousIn) output.push(intersect(previous, current));
        output.push(current);
      } else if (previousIn) {
        output.push(intersect(previous, current));
      }
    }
  }
  return output;
}

function atLng(a: LatLng, b: LatLng, lng: number): LatLng {
  const t = (lng - a.lng) / (b.lng - a.lng);
  return { lat: a.lat + t * (b.lat - a.lat), lng };
}

function atLat(a: LatLng, b: LatLng, lat: number): LatLng {
  const t = (lat - a.lat) / (b.lat - a.lat);
  return { lat, lng: a.lng + t * (b.lng - a.lng) };
}
