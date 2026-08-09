import { afterAll, bench, describe } from "vitest";
import Flatbush from "flatbush";

import { parseOverpassJson } from "../model/overpass-parser.js";
import { toGeometry } from "../model/osm-geometry.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { boundsOf } from "./clip.js";
import { polygonsOverlap } from "./ring-overlap.js";
import {
  geometryOverlaps,
  toPlanarGeometry,
  type PlanarGeometry,
} from "./geometry-overlap.js";
import { positionsOf } from "./clip.js";
import type { PlanarPoint } from "./point-in-ring.js";
import type { LatLng } from "../model/osm-feature.js";

/**
 * The spatial index's two open numbers, measured together.
 *
 * WHY THIS EXISTS. Every figure in the plan docs so far is about BUILDING an
 * index, while the requirement is *"queries answer in microseconds against the
 * resident structure"*. Query cost had never been measured at all, and the one
 * build number that was taken turned out to time geometry conversion rather than
 * the bbox pass it claimed. This is the harness for both, checked in — the last
 * one was thrown away, which is precisely why none of its conclusions were
 * falsifiable.
 *
 * WHAT `flatbush` IS DOING HERE. It is a **devDependency**, the pattern `earcut`
 * and `osmtogeojson` already establish in this package: a benchmark and an oracle
 * that never ships. It is measured rather than assumed because it is a packed
 * Hilbert R-tree whose entire index is one `ArrayBuffer` — which is exactly the
 * "flat typed arrays, transferable, implicit tree" the design settled on, so if
 * it fits there is nothing to hand-roll. Whether it ships is a separate decision,
 * taken after these numbers rather than before.
 *
 * THE THREE COSTS A FRAME QUERY PAYS, separated on purpose because they have
 * completely different shapes:
 *
 * 1. **Build** — once per resident-set change, not per frame.
 * 2. **Broad phase** — the tree's own bbox search. Should be microseconds.
 * 3. **Narrow phase** — `polygonsOverlap` per surviving candidate. This is the
 *    one nobody has priced, and it is where a 1 031-point ring would hurt.
 *
 * The measurement deliberately reports broad and narrow separately: a design that
 * passes on tree speed and fails on narrow-phase cost looks identical in a
 * combined number, and that is the distinction the whole funnel exists for.
 *
 * SCOPE, stated so the numbers are not over-read: the predicate answers for
 * POLYGONS only (see `ring-overlap.ts.md`), so this prices the areal features and
 * says nothing about points and lines — two thirds of the corpus — whose contract
 * does not exist yet.
 */

/** One indexable feature: its bbox, and the rings the narrow phase will test. */
interface Indexed {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly rings: readonly (readonly PlanarPoint[])[];
}

/** `x = lng, y = lat`, the convention every predicate here already uses. */
const toPlanar = (ring: readonly LatLng[]): PlanarPoint[] =>
  ring.map((p) => ({ x: p.lng, y: p.lat }));

/**
 * The areal features of the whole site corpus, prepared for indexing.
 *
 * Geometry conversion happens HERE, outside every timed region — the mistake the
 * retracted measurement made was leaving `toGeometry` inside the loop and then
 * calling the result a bounding-box cost. `chunk-cost.test.ts` sets the same
 * precedent of keeping parsing out of the timer.
 */
const SITES = [
  "london-westminster",
  "cologne-cathedral",
  "manhattan-midtown",
  "tokyo-shinjuku",
  "heidelberg-altstadt",
  "berlin-alexanderplatz",
  "sylt-westerland",
  "london-tower-bridge",
];

function corpus(): Indexed[] {
  const out: Indexed[] = [];
  for (const id of SITES) {
    for (const feature of parseOverpassJson(loadSite(id).payload).features) {
      const result = toGeometry(feature);
      if (!result.ok) continue;
      const geometry = result.geometry;
      const polygons =
        geometry.kind === "polygon"
          ? [geometry.rings]
          : geometry.kind === "multipolygon"
            ? geometry.polygons
            : [];
      for (const rings of polygons) {
        const outer = rings[0];
        if (outer === undefined || outer.length < 3) continue;
        const bbox = boundsOf(outer);
        if (bbox === undefined) continue;
        out.push({
          minX: bbox.west,
          minY: bbox.south,
          maxX: bbox.east,
          maxY: bbox.north,
          rings: rings.map(toPlanar),
        });
      }
    }
  }
  return out;
}

const FEATURES = corpus();

function buildIndex(items: readonly Indexed[]): Flatbush {
  const index = new Flatbush(items.length);
  for (const item of items) {
    index.add(item.minX, item.minY, item.maxX, item.maxY);
  }
  index.finish();
  return index;
}

const INDEX = buildIndex(FEATURES);

/** Westminster: the densest site in the corpus, and the one every other measurement uses. */
const CENTRE: LatLng = loadSite("london-westminster").centre;

/**
 * A query polygon the size of a view frustum's ground footprint, at a REAL site.
 *
 * **Centred on one site's own centre, never on the corpus's mean.** The first
 * version of this averaged the feature centres of eight cities across three
 * continents, which lands in an ocean: every query returned **0 candidates** and
 * the benchmark reported microseconds for touching nothing. The candidate count
 * is printed in each bench name, and `assertHits` below turns a repeat of that
 * into a loud failure rather than a flattering number.
 */
function frustum(centre: LatLng, halfWidthDeg: number): PlanarPoint[] {
  const h = halfWidthDeg;
  return [
    { x: centre.lng - h, y: centre.lat - h },
    { x: centre.lng + h, y: centre.lat - h },
    { x: centre.lng + h, y: centre.lat + h },
    { x: centre.lng - h, y: centre.lat + h },
  ];
}

/**
 * The ACTUAL shape of a view frustum's ground footprint: a trapezoid, narrow at
 * the camera and widening to the far plane.
 *
 * **Why both shapes are measured.** The box above is the broad phase's own query
 * rectangle, so a narrow phase run against it can only ever reject features that
 * clip its edges — and over compact urban buildings it rejects *nothing*
 * (371/371, 1 239/1 239). That makes the box case a measurement of the narrow
 * phase's cost with none of its value, which would be a misleading number to
 * design against. The trapezoid is what a camera actually sees: its bounding box
 * is roughly twice its area, so the corners the broad phase hands over are real
 * false positives and the exact test earns its keep.
 *
 * 60° horizontal FOV, looking north, near plane at 5 % of the far distance.
 */
function frustumFootprint(centre: LatLng, farDeg: number): PlanarPoint[] {
  const halfFovTan = Math.tan(Math.PI / 6); // 60° FOV → 30° half-angle
  const near = farDeg * 0.05;
  const nearHalf = near * halfFovTan;
  const farHalf = farDeg * halfFovTan;
  return [
    { x: centre.lng - nearHalf, y: centre.lat + near },
    { x: centre.lng + nearHalf, y: centre.lat + near },
    { x: centre.lng + farHalf, y: centre.lat + farDeg },
    { x: centre.lng - farHalf, y: centre.lat + farDeg },
  ];
}

/** A query that finds nothing measures nothing. Fail loudly instead. */
function assertHits(label: string, candidates: readonly number[]): number[] {
  if (candidates.length === 0) {
    throw new Error(
      `spatial-query.bench: "${label}" matched 0 features — the query is not over the data, so any timing from it is meaningless.`,
    );
  }
  return [...candidates];
}

/**
 * Keeps the narrow phase's result observable so it cannot be optimised away,
 * and is reported at the end — a bench whose body the optimiser deleted would
 * show a suspiciously round zero here.
 */
let sink = 0;

afterAll(() => {
  console.log(`narrow-phase sink (overlap count across all runs): ${sink}`);
});

/** Broad phase only: what the tree answers, before any exact test. */
function broadPhase(query: PlanarPoint[]): number[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of query) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return INDEX.search(minX, minY, maxX, maxY);
}

describe("flatbush — build, over the corpus's areal features", () => {
  bench(`build (${FEATURES.length} features)`, () => {
    buildIndex(FEATURES);
  });
});

/** The query set: both shapes, both sizes, so the funnel is visible in each. */
const QUERIES = [
  ["box ~200 m", frustum(CENTRE, 0.001)],
  ["box ~2 km", frustum(CENTRE, 0.01)],
  ["frustum ~200 m", frustumFootprint(CENTRE, 0.002)],
  ["frustum ~2 km", frustumFootprint(CENTRE, 0.02)],
] as const;

describe("broad phase — the tree's own bbox search", () => {
  for (const [label, query] of QUERIES) {
    const candidates = assertHits(label, broadPhase(query));
    bench(`${label} (${candidates.length} candidates)`, () => {
      broadPhase(query);
    });
  }
});

describe("narrow phase — polygonsOverlap over the broad phase's survivors", () => {
  for (const [label, query] of QUERIES) {
    const candidates = assertHits(label, broadPhase(query));
    const queryPolygon = [query];
    // Reported alongside the candidate count because the RATIO is the number
    // §13.2 turns on: the predicate costs a flat ~0.3 µs per candidate, so the
    // only lever on query cost is how many of them the broad phase lets past.
    const overlapping = candidates.filter((i) => {
      const item = FEATURES[i];
      return item !== undefined && polygonsOverlap(item.rings, queryPolygon);
    }).length;

    bench(
      `${label} query (${candidates.length} candidates, ${overlapping} overlap)`,
      () => {
        let hits = 0;
        for (const i of candidates) {
          const item = FEATURES[i];
          if (item === undefined) continue;
          if (polygonsOverlap(item.rings, queryPolygon)) hits++;
        }
        // Parked in a module-scope sink rather than returned: `bench` bodies must
        // be `void`, and without SOME escape the whole loop is dead code the
        // optimiser may delete — which would measure an empty function.
        sink += hits;
      },
    );
  }
});

/**
 * THE ASYMMETRY, measured rather than asserted.
 *
 * The frustum query costs 3.75× the box query while handing the predicate a
 * THIRD as many candidates — 101 at 4.9 µs each against 371 at 0.35 µs each.
 * The hypothesis that explains it: a candidate that DOES overlap exits early on
 * the first witness that fires, while one that does not must exhaust all three,
 * and the third is the O(n·m) edge-crossing scan over every edge pair. The box
 * query rejects nothing, so it never pays that; the frustum rejects half.
 *
 * If the hypothesis holds, the design consequence is concrete and is the
 * opposite of the obvious one: **making the broad phase more selective makes
 * the narrow phase more expensive per candidate**, because what it filters out
 * are the cheap positives, leaving the costly negatives behind. The fix is a
 * bbox-vs-bbox reject INSIDE the narrow phase, which answers most negatives in
 * a few comparisons instead of thousands.
 */
describe("narrow phase — the cost of a YES against the cost of a NO", () => {
  const query = frustumFootprint(CENTRE, 0.002);
  const queryPolygon = [query];
  const candidates = assertHits("frustum ~200 m", broadPhase(query));

  const positives: number[] = [];
  const negatives: number[] = [];
  for (const i of candidates) {
    const item = FEATURES[i];
    if (item === undefined) continue;
    (polygonsOverlap(item.rings, queryPolygon) ? positives : negatives).push(i);
  }

  for (const [label, subset] of [
    ["overlapping (YES)", positives],
    ["rejected (NO)", negatives],
  ] as const) {
    bench(`${label} — ${subset.length} candidates`, () => {
      let hits = 0;
      for (const i of subset) {
        const item = FEATURES[i];
        if (item === undefined) continue;
        if (polygonsOverlap(item.rings, queryPolygon)) hits++;
      }
      sink += hits;
    });
  }
});

/**
 * THE MISSING TWO THIRDS: points and lines.
 *
 * Everything above prices AREAL features, because until `geometry-overlap.ts`
 * landed there was no predicate for anything else. That made every figure in the
 * plan a LOWER BOUND on a real query rather than an estimate of one — over the
 * corpus, 3 316 of 10 335 elements are nodes and most of the 6 777 ways are open,
 * so the kinds that had never been measured are the majority of the map.
 *
 * The question this answers is not "are points fast" — a point test is one ray
 * cast and obviously is. It is whether the REJECTION asymmetry found above
 * (37×, and the reason the whole funnel is shaped the way it is) holds for the
 * other kinds, or whether it is a property of polygon-vs-polygon alone. The two
 * answers imply different designs: if lines reject as expensively as polygons,
 * they need the same bounding-box guard; if they do not, they can go straight
 * into the narrow phase.
 */

/** One indexable feature of ANY kind, with the bbox its broad phase uses. */
interface IndexedAny {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly geometry: PlanarGeometry;
  readonly kind: PlanarGeometry["kind"];
}

/** Every feature of the corpus, of every kind, converted once. */
function corpusOfAllKinds(): IndexedAny[] {
  const out: IndexedAny[] = [];
  for (const id of SITES) {
    for (const feature of parseOverpassJson(loadSite(id).payload).features) {
      const result = toGeometry(feature);
      if (!result.ok) continue;
      const bbox = boundsOf(positionsOf(result.geometry));
      if (bbox === undefined) continue;
      out.push({
        minX: bbox.west,
        minY: bbox.south,
        maxX: bbox.east,
        maxY: bbox.north,
        geometry: toPlanarGeometry(result.geometry),
        kind: result.geometry.kind,
      });
    }
  }
  return out;
}

const ALL = corpusOfAllKinds();

const ALL_INDEX = (() => {
  const index = new Flatbush(ALL.length);
  for (const item of ALL) index.add(item.minX, item.minY, item.maxX, item.maxY);
  index.finish();
  return index;
})();

/** Candidates of one kind, for a query centred on real data. */
function candidatesOfKind(
  query: PlanarPoint[],
  kinds: readonly PlanarGeometry["kind"][],
): number[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of query) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return ALL_INDEX.search(minX, minY, maxX, maxY).filter((i) => {
    const item = ALL[i];
    return item !== undefined && kinds.includes(item.kind);
  });
}

describe("narrow phase by KIND — the two thirds never priced", () => {
  const query = frustumFootprint(CENTRE, 0.002);
  const queryPolygon = [query];

  for (const [label, kinds] of [
    ["points", ["point"]],
    ["lines", ["linestring", "multilinestring"]],
    ["areas", ["polygon", "multipolygon"]],
  ] as const) {
    const candidates = assertHits(label, candidatesOfKind(query, kinds));
    const hits = candidates.filter((i) => {
      const item = ALL[i];
      return (
        item !== undefined && geometryOverlaps(item.geometry, queryPolygon)
      );
    }).length;

    bench(`${label} (${candidates.length} cand → ${hits} overlap)`, () => {
      let n = 0;
      for (const i of candidates) {
        const item = ALL[i];
        if (item === undefined) continue;
        if (geometryOverlaps(item.geometry, queryPolygon)) n++;
      }
      sink += n;
    });
  }
});

describe("narrow phase by kind — YES against NO, for lines", () => {
  // The asymmetry is the finding this whole file turns on. If it holds for lines
  // too, they need the same bounding-box guard areas got; if it does not, they
  // can go straight into the narrow phase and the guard is wasted work.
  const query = frustumFootprint(CENTRE, 0.002);
  const queryPolygon = [query];
  const candidates = candidatesOfKind(query, ["linestring", "multilinestring"]);

  const positives: number[] = [];
  const negatives: number[] = [];
  for (const i of candidates) {
    const item = ALL[i];
    if (item === undefined) continue;
    (geometryOverlaps(item.geometry, queryPolygon)
      ? positives
      : negatives
    ).push(i);
  }

  for (const [label, subset] of [
    ["lines overlapping (YES)", positives],
    ["lines rejected (NO)", negatives],
  ] as const) {
    if (subset.length === 0) continue;
    bench(`${label} — ${subset.length} candidates`, () => {
      let n = 0;
      for (const i of subset) {
        const item = ALL[i];
        if (item === undefined) continue;
        if (geometryOverlaps(item.geometry, queryPolygon)) n++;
      }
      sink += n;
    });
  }
});
