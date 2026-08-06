/**
 * Where a POI marker actually goes when the thing it names is already drawn
 * (DEC-S1, DEC-S2, DEC-S6, DEC-S7 — stage 1).
 *
 * THE PROBLEM, IN THE OWNER'S WORDS. _"Wenn jetzt hier eh schon eine Geometrie
 * ist, die das gleiche Label hat … dann ist es ja viel sinnvoller, dass diese
 * geschlossene Fläche entsprechend eingefärbt wird und der POI überhaupt nicht
 * als 3D-Modell angezeigt wird."_ A restaurant node inside a restaurant building
 * is the same fact twice; drawing both puts a marker inside a wall.
 *
 * AND THE BETTER HALF OF THE SAME IDEA, which is what this is really for:
 * _"…wo man dann auf dem Restaurant oben drauf so ein Symbol machen würde, was
 * über dem Restaurant fliegt … dadurch versteht derjenige sofort: ah okay, das
 * Gebäude ist ein Restaurant."_ The marker does not vanish — it moves onto the
 * roof, and the building gains the label it was missing.
 *
 * WHY THIS IS A PURE FUNCTION OVER PRE-RESOLVED HOSTS, and not a lookup. Two
 * facts about the pipeline force it, and both were found by reading the code
 * rather than assumed:
 *
 *  - **A layer toggle does NOT re-run the worker.** `main.ts` rebuilds three.js
 *    objects from the CACHED worker payload precisely so that switching a layer
 *    is cheap. So a rule that must know whether `plates` is on cannot live in
 *    the worker, where the geometry is — it would read a stale layer set.
 *  - **Plates are CLIPPED to the rendered extent and built AFTER the markers.**
 *    "A pool way exists in the features" and "a pool plate is drawn" are
 *    different claims: a pool near the tile edge is clipped away entirely. A
 *    resolver matching against features rather than against drawn geometry would
 *    delete the marker and draw nothing — exactly the data loss DEC-S1 exists to
 *    prevent, arriving through the back door.
 *
 * So the worker resolves candidate hosts ONCE PER HOST LAYER and annotates each
 * marker; this function picks between them given the layers actually enabled.
 * That is also what makes the rule testable without a worker, a fetch, or a GPU.
 *
 * @see poi-hosts.ts.md
 */

import type { EnuPoint } from "./enu.js";

/** The layers that can host a marker. Named, because the policy differs. */
export type PoiHostLayer = "buildings" | "plates";

/** A candidate host: geometry already drawn that names the same thing. */
export interface PoiHostAnchor {
  readonly layer: PoiHostLayer;
  /** The way or relation that matched, for the pick table. */
  readonly feature: string;
  /**
   * The host's centroid, ENU metres — x east, **y NORTH**.
   *
   * NOT scene coordinates. The `+y north → -z` reflection belongs to
   * `poiMarkerPosition` in the demo, which owns it for every marker and
   * documents why getting it wrong fails silently: a symbol 50 m north of its
   * building renders 50 m south of it, labelled correctly, looking like a data
   * error rather than a frame error. A `z` on this payload would be a second,
   * disagreeing convention crossing the same wire.
   */
  readonly x: number;
  readonly y: number;
  /** The host's highest point, in the same frame as a marker's ground height. */
  readonly topM: number;
  /** Footprint diagonal, metres — how big the thing being labelled is. */
  readonly spanM: number;
}

/** A marker as this rule needs to see it. */
export interface HostableMarker {
  readonly kind: string;
  readonly hosts?: readonly PoiHostAnchor[];
}

/** Where a marker ends up once its hosts are known. */
export type PoiPlacement =
  | { readonly at: "node" }
  | {
      readonly at: "host";
      readonly host: PoiHostAnchor;
      /** Metres above the host's top. */
      readonly liftM: number;
      /** Uniform scale for the symbol, so it reads over a large building. */
      readonly scale: number;
    }
  | { readonly at: "suppressed"; readonly host: PoiHostAnchor };

/**
 * Kinds whose host geometry says everything the marker would (DEC-S1).
 *
 * A pool, a pitch, a car park: the drawn AREA is the thing. A symbol floating
 * over it would be a second statement of one fact, and the owner said so
 * directly — _"das wäre ja quasi doppelt"_.
 *
 * **These are AREA kinds only.** A building-shaped host never suppresses,
 * because a building is not self-describing: a grey box does not say
 * "restaurant" and the symbol above it is the only thing that does.
 */
const AREA_KINDS: ReadonlySet<string> = new Set([
  "leisure=swimming_pool",
  "leisure=pitch",
  "amenity=parking",
  "amenity=parking_space",
]);

/** Clearance above a host's top, metres. Roofs are pitched; contact is not. */
export const HOST_CLEARANCE_M = 0.6;

/**
 * How far a symbol may grow over a large host (DEC-S6).
 *
 * A 0.9 m symbol on a 60 m hospital roof is invisible from the orbit camera,
 * which defeats the whole point. The scale is derived from the host's span
 * against a reference, and CLAMPED at both ends: never shrunk, never more than
 * tripled. Unclamped, a stadium would carry a ten-metre knife and fork.
 *
 * **The bounds are a guess and are the item most likely to look wrong first.**
 * They are cheap to change and worth looking at specifically in the first
 * review.
 */
const REFERENCE_SPAN_M = 24;
const MAX_HOST_SCALE = 3;

/**
 * Whether a host's kind is close enough to the marker's to be the same thing
 * (DEC-S7).
 *
 * **THE ASYMMETRY IS THE DECISION.** Strict tag equality for area kinds, where a
 * wrong match DELETES a marker; any building for symbol kinds, where a wrong
 * match only MOVES one onto a roof. The aggressive rule is used exactly where
 * being wrong is cheap.
 *
 * The strict reading alone would miss the ordinary case this feature exists
 * for — a restaurant node inside a way tagged only `building=yes`, which is
 * most of real OSM.
 */
export function hostMatches(kind: string, host: PoiHostAnchor): boolean {
  if (host.layer === "plates") return true;
  return !AREA_KINDS.has(kind);
}

/**
 * Where one marker goes, given the hosts resolved for it and the layers on.
 *
 * `enabledLayers` is what the CALLER is actually drawing. A host on a disabled
 * layer is not a host: suppressing against geometry nobody can see is the data
 * loss DEC-S1 was written to avoid, and it is why the plates default being off
 * (DEC-R7b-5) turned this from a tidy rule into a real problem.
 */
export function resolvePoiPlacement(
  marker: HostableMarker,
  enabledLayers: ReadonlySet<PoiHostLayer>,
): PoiPlacement {
  const hosts = marker.hosts ?? [];
  for (const host of hosts) {
    if (!enabledLayers.has(host.layer)) continue;
    if (!hostMatches(marker.kind, host)) continue;
    if (host.layer === "plates" && AREA_KINDS.has(marker.kind)) {
      return { at: "suppressed", host };
    }
    return {
      at: "host",
      host,
      liftM: HOST_CLEARANCE_M,
      scale: hostScale(host.spanM),
    };
  }
  return { at: "node" };
}

/** The symbol's scale over a host of this span, clamped at both ends. */
export function hostScale(spanM: number): number {
  if (!Number.isFinite(spanM) || !(spanM > 0)) return 1;
  return Math.min(MAX_HOST_SCALE, Math.max(1, spanM / REFERENCE_SPAN_M));
}

/**
 * The centroid and span of a footprint, for building an anchor.
 *
 * THE CENTROID IS THE VERTEX MEAN, not the area centroid, and that is a
 * deliberate simplification with a stated failure mode: on a footprint whose
 * vertices bunch along one edge — a curved frontage traced with many points —
 * the mean pulls toward the dense side. It is still inside the polygon for any
 * convex-ish building, and a symbol 2 m off the middle of a roof is not a defect
 * anyone can see. An L-shaped building is where it is worst, and there the true
 * area centroid can fall OUTSIDE the polygon anyway, so neither is right.
 */
export function footprintAnchor(footprint: readonly EnuPoint[]): {
  x: number;
  y: number;
  spanM: number;
} {
  if (footprint.length === 0) return { x: 0, y: 0, spanM: 0 };
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of footprint) {
    sumX += point.x;
    sumY += point.y;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: sumX / footprint.length,
    y: sumY / footprint.length,
    spanM: Math.hypot(maxX - minX, maxY - minY),
  };
}
