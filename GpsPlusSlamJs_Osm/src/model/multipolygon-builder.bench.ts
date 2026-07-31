import { bench, describe } from "vitest";
import { stitchRings } from "./multipolygon-builder.js";
import { toGeometry } from "./osm-geometry.js";
import { parseOverpassJson } from "./overpass-parser.js";
import { loadFixture } from "../test-utils/load-fixtures.js";
import type { LatLng, OsmRelation } from "./osm-feature.js";

/**
 * Benchmark for ring stitching — `stitchRings` and the `toGeometry` path above
 * it.
 *
 * Why this bench matters (2026-07-31 perf loop, OSM iteration 2). Iteration 1
 * left `buildFeatureIndex` with `restrictTo` as the head of the ranked list
 * (55 / 54 / 21 / 113 ms across the four fixtures) and noted it had never been
 * profiled from the inside. Profiling it split the time into two buckets:
 *
 * - `cell-coverage:addPolygon` — 69 %, essentially all of it inside h3-js's
 *   `polygonToCellsExperimental`. Not ours to speed up.
 * - `model:relationToGeometry` — 16 %, and **`attach` is the single largest
 *   own-code frame in the entire profile** (9.6 % of all sampled time).
 *
 * The second bucket is what this file measures, because it is the one that is
 * ours and algorithmic rather than a library's constant.
 *
 * THE SIDECAR PREDICTED THIS CASE AND PREDICTED IT WOULD NOT HAPPEN: "Real
 * relations have tens of members, not thousands ... if a pathological relation
 * ever shows up, the fix is an endpoint hash map." Measurement disagrees about
 * the frequency. The `building-block` fixture is one ordinary Cologne city
 * block, and it contains a 316-member / 26,778-point boundary relation costing
 * 32.8 ms on its own; `beach` contains a 217-member / 20,135-point one at
 * 13.9 ms. Those are not pathological, they are what Overpass returns for a
 * bbox that happens to clip an administrative boundary — which any city bbox
 * does.
 *
 * The `synthetic scaling` block exists to keep the growth curve honest: the
 * quadratic term is invisible at the sizes the property tests use (≤ 5 pieces),
 * so only a size sweep can show whether a change fixed the shape of the curve
 * or merely shaved its constant.
 */

/** The member geometries a relation would hand to `stitchRings`. */
function segmentsOf(relation: OsmRelation): LatLng[][] {
  return relation.members
    .map((member) => member.geometry ?? [])
    .filter((geometry) => geometry.length >= 2)
    .map((geometry) => [...geometry]);
}

/** The single most expensive relation in a fixture, by member count. */
function biggestRelation(slug: string): OsmRelation | undefined {
  const parsed = parseOverpassJson(loadFixture(slug).payload);
  let best: OsmRelation | undefined;
  for (const feature of parsed.features) {
    if (feature.type !== "relation") continue;
    if (best === undefined || feature.members.length > best.members.length) {
      best = feature;
    }
  }
  return best;
}

describe("stitchRings — the real relations the fixtures contain", () => {
  for (const slug of ["building-block", "beach"]) {
    const relation = biggestRelation(slug);
    if (relation === undefined) continue;
    const segments = segmentsOf(relation);
    const points = segments.reduce((sum, s) => sum + s.length, 0);

    bench(`${slug} (${segments.length} segments, ${points} points)`, () => {
      stitchRings(segments);
    });
  }
});

describe("toGeometry — stitching in its production caller", () => {
  for (const slug of ["building-block", "beach"]) {
    const relation = biggestRelation(slug);
    if (relation === undefined) continue;

    // The caller `buildFeatureIndex` actually uses. Kept alongside the bare
    // `stitchRings` case so a win there can be checked to survive the work
    // around it (hole grouping, area comparison) rather than being swallowed.
    bench(`${slug}`, () => {
      toGeometry(relation);
    });
  }
});

/** A closed ring of `n * k` points, handed over as `n` open segments. */
function splitRing(n: number, k = 64): LatLng[][] {
  const total = n * k;
  const points: LatLng[] = [];
  for (let i = 0; i < total; i++) {
    const angle = (2 * Math.PI * i) / total;
    points.push({
      lat: 50 + 0.01 * Math.cos(angle),
      lng: 7 + 0.01 * Math.sin(angle),
    });
  }
  points.push(points[0]!);

  const segments: LatLng[][] = [];
  for (let i = 0; i < n; i++) segments.push(points.slice(i * k, i * k + k + 1));

  // SHUFFLED DELIBERATELY. Handed over in ring order, a linear scan finds its
  // next segment on the first probe and the quadratic scan term never shows.
  // Real relations arrive in whatever order the members were added over the
  // years, which is not ring order.
  let seed = 12345;
  const next = (): number =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = segments.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [segments[i], segments[j]] = [segments[j]!, segments[i]!];
  }
  return segments;
}

describe("stitchRings — synthetic scaling, 64 points per segment", () => {
  for (const n of [50, 200, 800]) {
    const segments = splitRing(n);
    bench(`${n} segments`, () => {
      stitchRings(segments);
    });
  }
});
