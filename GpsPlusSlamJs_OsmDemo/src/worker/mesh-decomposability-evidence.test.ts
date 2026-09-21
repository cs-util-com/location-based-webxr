/**
 * Which mesh builders can be run over a DELTA, and which cannot.
 *
 * Why these tests matter:
 * The planned "incremental mesh rebuild" rests on one assumption - that the
 * per-feature builders are genuinely per-feature, so building `A` and `B`
 * separately and concatenating gives exactly what building `A ++ B` gives. If
 * that holds, an arriving tile costs only its own geometry instead of the whole
 * city's. **Two of the five builders violate it**, and this file is the
 * executable record of which, because the assumption is the kind that gets
 * re-made every time somebody reads "the mesh grows linearly with features".
 *
 * WHAT THIS COST, measured on devbox-win11 against a live res-7 Cologne tile
 * (32 261 features, 21.3 MB, 2026-09-21):
 *
 * - decomposable: trees 5 ms, roads 63 ms, plates 63 ms = **131 ms**
 * - NOT decomposable: buildings 250 ms, barriers 120 ms = **370 ms**
 * - global passes (POI hosts, chunking), never decomposable = 147 ms
 * - total 648 ms
 *
 * So an incremental rebuild could save at most **20.2%**, not the ~77% a
 * "per-feature passes dominate" reading predicts. That is what took the work
 * item off the build list; see the plan doc.
 *
 * HOW THE COMPARISON IS MADE, because two earlier versions of it were wrong in
 * opposite directions:
 *
 * - **Order-insensitive.** A first attempt summed vertex coordinates in array
 *   order and reported barriers as differing when a reordering would have
 *   explained it. Everything here is compared as a SORTED set of per-item
 *   lines.
 * - **Values, not just counts.** A count comparison would have called barriers
 *   decomposable: they come back with the same number of items and the same
 *   number of vertices, and differ only in where those vertices are.
 *
 * The fixtures are real captured extracts. A synthetic feature set would
 * exercise the concatenation and none of the geometry that makes concatenation
 * questionable - `building:part` inside an outline, gate openings, closed rings.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildAreaPlates,
  buildBarriers,
  buildBuildings,
  buildRoads,
  buildTrees,
  enuFrameAt,
  parseOverpassJson,
  type OsmFeature,
} from "gps-plus-slam-osm";

/**
 * The common shape of everything the builders return.
 *
 * `feature` is an `OsmFeatureKey` - `` `${type}/${id}` `` - and typing it as
 * such rather than as `unknown` is not cosmetic: `String(unknown)` is exactly
 * the stringification lint forbids, and it would silently turn a shape change
 * into "[object Object]" comparing equal to itself.
 */
interface Built {
  readonly feature?: string;
  readonly parentFeature?: string;
  readonly mesh?: { readonly positions: Float32Array };
}

function fixture(slug: string): {
  features: OsmFeature[];
  centre: { lat: number; lng: number };
} {
  const path = new URL(
    `../../../GpsPlusSlamJs_Osm/src/testdata/${slug}.json`,
    import.meta.url,
  );
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    payload: unknown;
    centre: { lat: number; lng: number };
  };
  const parsed = parseOverpassJson(raw.payload);
  // `parseOverpassJson` returns `{ features: [] }` rather than throwing when it
  // is handed the wrong shape, and a benchmark built on this same loader once
  // reported 0 ms for every phase because of it. An empty parse would make every
  // assertion below vacuously true.
  if (parsed.features.length === 0) {
    throw new Error(`fixture ${slug} parsed to no features`);
  }
  return { features: [...parsed.features], centre: raw.centre };
}

/** One sorted line per built item: identity, parent and every coordinate. */
function shape(items: readonly Built[]): string[] {
  return items
    .map((item) =>
      [
        item.feature ?? "?",
        item.parentFeature ?? "-",
        item.mesh === undefined
          ? "nomesh"
          : [...item.mesh.positions].map((x) => x.toFixed(4)).join(","),
      ].join("|"),
    )
    .sort();
}

/** Just the features present, so "different set" and "different geometry" differ. */
function featureSet(items: readonly Built[]): Set<string> {
  return new Set(items.map((item) => item.feature ?? "?"));
}

const SLUGS = ["park", "building-block", "street-corner"] as const;

/** Every way of cutting a feature list that the tests below try. */
function splitsOf(
  features: readonly OsmFeature[],
): Record<string, OsmFeature[][]> {
  const third = Math.floor(features.length / 3);
  const half = Math.floor(features.length / 2);
  return {
    "two uneven pieces": [features.slice(0, third), features.slice(third)],
    "three pieces": [
      features.slice(0, third),
      features.slice(third, third * 2),
      features.slice(third * 2),
    ],
    "two even pieces": [features.slice(0, half), features.slice(half)],
  };
}

describe("builders that CAN be run over a delta", () => {
  for (const slug of SLUGS) {
    const { features, centre } = fixture(slug);
    const options = { frame: enuFrameAt(centre) };
    const clipTo = {
      south: centre.lat - 0.05,
      north: centre.lat + 0.05,
      west: centre.lng - 0.05,
      east: centre.lng + 0.05,
    };
    const builders: Record<
      string,
      (f: readonly OsmFeature[]) => readonly Built[]
    > = {
      trees: (f) => buildTrees(f, options),
      roads: (f) => buildRoads(f, options),
      plates: (f) => buildAreaPlates(f, { ...options, clipTo }),
    };

    for (const [name, build] of Object.entries(builders)) {
      for (const [how, pieces] of Object.entries(splitsOf(features))) {
        it(`${slug}: ${name} is identical when built in ${how}`, () => {
          const whole = build(features);
          const joined = pieces.flatMap((piece) => [...build(piece)]);

          expect(shape(joined)).toEqual(shape(whole));
        });
      }
    }

    it(`${slug}: those builders produce something, so the equalities are not empty`, () => {
      // THE GUARD ON EVERY EQUALITY ABOVE. `expect([]).toEqual([])` passes for a
      // builder that has quietly stopped producing anything.
      const built = Object.values(builders).reduce(
        (sum, build) => sum + build(features).length,
        0,
      );
      expect(built).toBeGreaterThan(0);
    });
  }
});

describe("builders that CANNOT, and exactly how each one breaks", () => {
  it("buildBuildings emits EXTRA volumes when a part is split from its outline", () => {
    // THE MECHANISM: `buildBuildings` groups `building:part` areas under the
    // outline that geometrically CONTAINS them, and a part with no containing
    // outline in the same call is built standalone - deliberately, because a
    // tile boundary can deliver a part without its parent and dropping it would
    // erase the building. Split the feature list and some parts lose their
    // parent, so the split produces MORE volumes than the whole.
    //
    // This is why a delta cannot simply be "the features that arrived": closing
    // it would need point-in-polygon tests against every outline already held,
    // which is the global pass the whole exercise was trying to avoid.
    const { features, centre } = fixture("building-block");
    const options = { frame: enuFrameAt(centre) };

    const whole = buildBuildings(features, options);
    const third = Math.floor(features.length / 3);
    const inThree = [
      ...buildBuildings(features.slice(0, third), options),
      ...buildBuildings(features.slice(third, third * 2), options),
      ...buildBuildings(features.slice(third * 2), options),
    ];

    expect(inThree.length).toBeGreaterThan(whole.length);
    // And it is a genuinely different SET, not a reordering.
    expect(featureSet(inThree)).not.toEqual(featureSet(whole));
  });

  it("buildBarriers keeps every feature but MOVES their vertices", () => {
    // THE MECHANISM, and the reason a count-based check would have missed it:
    // the same barriers come back, with the same number of vertices, in
    // different places. Barriers share a ground height across the group they
    // are built with, so splitting the group changes the height each one sits
    // at. A wall that floats or cuts into the ground is precisely the artefact
    // this codebase has repeatedly engineered away, so "the difference is only
    // millimetres" is not a licence to concatenate.
    const { features, centre } = fixture("street-corner");
    const options = { frame: enuFrameAt(centre) };

    const whole = buildBarriers(features, options);
    const half = Math.floor(features.length / 2);
    const inTwo = [
      ...buildBarriers(features.slice(0, half), options),
      ...buildBarriers(features.slice(half), options),
    ];

    expect(whole.length).toBeGreaterThan(0);
    // Same features...
    expect(featureSet(inTwo)).toEqual(featureSet(whole));
    // ...different geometry.
    expect(shape(inTwo)).not.toEqual(shape(whole));
  });
});
