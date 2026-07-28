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
 * Keeps the parts of a linestring near the box.
 *
 * Deliberately coarse: a vertex is kept when it is inside the box, and so is
 * one vertex either side of it, so the segments crossing the boundary survive
 * and the supercover rasteriser still fills them. Precise segment/box
 * intersection would be more exact and is not needed — over-keeping costs a few
 * cells outside the working set, which are then filtered; under-keeping would
 * lose road.
 */
function clipLine(positions: readonly LatLng[], bbox: Bbox): LatLng[] {
  const kept: LatLng[] = [];
  for (let i = 0; i < positions.length; i++) {
    const current = positions[i]!;
    const previous = positions[i - 1];
    const next = positions[i + 1];
    const relevant =
      containsPoint(bbox, current) ||
      (previous !== undefined && containsPoint(bbox, previous)) ||
      (next !== undefined && containsPoint(bbox, next));
    if (relevant) kept.push(current);
  }
  return kept;
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
