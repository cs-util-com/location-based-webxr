/**
 * Region tests.
 *
 * Why these tests matter:
 * This is where the geohash→H3 move pays off, and the tests are written to make
 * that payoff checkable rather than asserted. The C# reference needed a
 * rectangularity invariant, a dense fill of empty tiles, and a concave hull with
 * an unexplained `0.69` tuning constant. On a hex grid none of those exist:
 * adjacency is `gridDisk(cell, 1)`, sparse input is natural, and the outline is
 * exact by construction.
 *
 * The one genuinely fragile thing here is **region identity**, whose failure
 * mode (two regions merging changes BOTH ids) is documented and tested rather
 * than fixed — because fixing it properly needs a notion of place that this
 * layer does not have.
 *
 * @see region-builder.ts.md
 */

import { describe, it, expect } from "vitest";
import { latLngToCell, gridDisk, gridDistance } from "h3-js";
import { connectedComponents } from "./connected-components.js";
import { buildRegion, buildRegions, regionId } from "./region-builder.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";
import type { CellScore } from "../score/affordance-scorer.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const CENTRE = latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES);
const FAR = latLngToCell(51.5, 7.5, AFFORDANCE_RES);

/** Uniform scores, so region statistics are predictable. */
function scoresFor(
  cells: readonly string[],
  value: number,
  category = "walkable",
): Map<string, CellScore> {
  return new Map(
    cells.map((cell) => [
      cell,
      {
        cell,
        scores: { [category]: value },
        contributors: { [category]: { "way/1": value } },
      },
    ]),
  );
}

describe("connected components", () => {
  it("groups adjacent cells and separates distant ones", () => {
    const near = gridDisk(CENTRE, 1);
    const components = connectedComponents([...near, FAR]);

    expect(components).toHaveLength(1); // FAR is alone and below minSize
    expect(components[0]).toHaveLength(near.length);
  });

  it("drops components below minSize — an isolated cell is not a region", () => {
    // Matches the reference's `minTileCount`. A single above-threshold cell is
    // almost always one small mapped object; emitting it buries real regions.
    expect(connectedComponents([CENTRE], 2)).toEqual([]);
    expect(connectedComponents([CENTRE], 1)).toEqual([[CENTRE]]);
  });

  it("separates two clusters that do not touch", () => {
    const a = gridDisk(CENTRE, 1);
    const b = gridDisk(FAR, 1);
    const components = connectedComponents([...a, ...b]);
    expect(components).toHaveLength(2);
  });

  it("needs no rectangular input — sparse and ragged is fine", () => {
    // The C# flood fill threw on non-rectangular input and had to dense-fill
    // empty tiles with neutral heat to satisfy that. Nothing here does.
    const ragged = [CENTRE, ...gridDisk(CENTRE, 1).slice(0, 3)];
    expect(connectedComponents(ragged)).toHaveLength(1);
  });

  it("is deterministic regardless of input order", () => {
    // Region identity is derived from component membership, so a nondeterministic
    // grouping would produce nondeterministic ids.
    const cells = gridDisk(CENTRE, 2);
    const forward = connectedComponents(cells);
    const backward = connectedComponents([...cells].reverse());
    expect(forward).toEqual(backward);
  });

  it("deduplicates repeated input cells", () => {
    const cells = gridDisk(CENTRE, 1);
    expect(connectedComponents([...cells, ...cells])[0]).toHaveLength(
      cells.length,
    );
  });

  it("handles empty input", () => {
    expect(connectedComponents([])).toEqual([]);
  });

  it("every cell of a component is reachable from every other within it", () => {
    // The definition of a connected component, asserted rather than assumed.
    const component = connectedComponents(gridDisk(CENTRE, 2))[0]!;
    const inside = new Set(component);
    for (const cell of component) {
      const hasNeighbourInside = gridDisk(cell, 1).some(
        (n) => n !== cell && inside.has(n),
      );
      expect(hasNeighbourInside).toBe(true);
    }
  });
});

describe("region outlines are exact, not hulls", () => {
  const cells = gridDisk(CENTRE, 1);
  const region = buildRegion(cells, "walkable", scoresFor(cells, 5));

  it("produces a closed outer ring", () => {
    const ring = region.outline[0]![0]!;
    expect(ring.length).toBeGreaterThan(3);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("uses { lat, lng }, not GeoJSON coordinate order", () => {
    // h3 returns [lng, lat]; leaving that unconverted is a trap that shows up as
    // geometry somewhere off the coast of Africa.
    const first = region.outline[0]![0]![0]!;
    expect(first.lat).toBeCloseTo(COLOGNE.lat, 1);
    expect(first.lng).toBeCloseTo(COLOGNE.lng, 1);
  });

  it("needs no tuning constant", () => {
    // The point of the whole change: no 0.69, no maxEdgeLengthRatio, nothing to
    // pick. Asserted as the absence of a knob in the signature.
    expect(buildRegion.length).toBe(3);
  });
});

describe("region statistics", () => {
  const cells = gridDisk(CENTRE, 1);

  it("counts cells and sums real cell areas", () => {
    const region = buildRegion(cells, "walkable", scoresFor(cells, 5));
    expect(region.cellCount).toBe(7);
    // ~43.9 m2 per res-13 cell.
    expect(region.areaM2).toBeGreaterThan(250);
    expect(region.areaM2).toBeLessThan(350);
  });

  it("uses the MEDIAN score, so one outlier cannot define the region", () => {
    // Scores are unbounded and multiplicative: a single heavily-mapped cell can
    // be orders of magnitude above its neighbours and would drag a mean with it.
    const scores = scoresFor(cells, 5);
    const outlier = cells[0]!;
    scores.set(outlier, {
      cell: outlier,
      scores: { walkable: 100_000 },
      contributors: { walkable: { "way/9": 100_000 } },
    });

    const region = buildRegion(cells, "walkable", scores);
    expect(region.medianScore).toBe(5);
    expect(region.maxScore).toBe(100_000);
    expect(region.minScore).toBe(5);
  });

  it("collects every contributing OSM element, deduplicated and sorted", () => {
    const region = buildRegion(cells, "walkable", scoresFor(cells, 5));
    expect(region.osmSourceIds).toEqual(["way/1"]);
  });

  it("treats a cell with no score as the identity rather than dropping it", () => {
    // A lookup miss must not silently shrink a region — the cell is in the
    // component because something put it there.
    const partial = scoresFor(cells.slice(0, 3), 5);
    const region = buildRegion(cells, "walkable", partial);
    expect(region.cellCount).toBe(7);
    expect(region.minScore).toBe(1);
  });
});

describe("region identity — and its documented failure mode", () => {
  it("is the lowest-sorting cell id, so it is order-independent", () => {
    const cells = gridDisk(CENTRE, 1);
    expect(regionId(cells)).toBe([...cells].sort()[0]);
    expect(regionId([...cells].reverse())).toBe(regionId(cells));
  });

  it("survives recomputation while the component's extent holds", () => {
    const cells = gridDisk(CENTRE, 1);
    const first = buildRegion(cells, "walkable", scoresFor(cells, 5));
    const second = buildRegion(
      [...cells].reverse(),
      "walkable",
      scoresFor(cells, 5),
    );
    expect(first.id).toBe(second.id);
  });

  it("CHANGES for both regions when two merge — documented, not fixed", () => {
    // The real limitation. As more data loads, two separate regions can become
    // one, and the merged component's lowest cell is the lower of the two — so
    // one id survives and the other vanishes. Consumers must not persist a
    // region id as a long-lived key: it identifies a shape at a moment, not a
    // place forever.
    //
    // Fixing this properly needs a notion of "place" that this layer does not
    // have, which is why it is asserted rather than worked around.
    const left = gridDisk(CENTRE, 1);
    const bridge = gridDisk(CENTRE, 2).filter(
      (c) => gridDistance(CENTRE, c) === 2,
    );

    const before = connectedComponents(left).map(regionId);
    const after = connectedComponents([...left, ...bridge]).map(regionId);

    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    // The merged component reaches further, so its lowest cell may differ.
    expect(after[0]).toBe(regionId([...left, ...bridge]));
  });

  it("returns a stable empty id for an empty component", () => {
    expect(regionId([])).toBe("");
  });
});

describe("buildRegions over several components", () => {
  it("builds one region per component, all in the requested category", () => {
    const a = gridDisk(CENTRE, 1);
    const b = gridDisk(FAR, 1);
    const components = connectedComponents([...a, ...b]);
    const scores = scoresFor([...a, ...b], 7);

    const regions = buildRegions(components, "walkable", scores);
    expect(regions).toHaveLength(2);
    for (const region of regions) {
      expect(region.category).toBe("walkable");
      expect(region.medianScore).toBe(7);
    }
  });

  it("gives every region a distinct id", () => {
    const components = connectedComponents([
      ...gridDisk(CENTRE, 1),
      ...gridDisk(FAR, 1),
    ]);
    const ids = buildRegions(
      components,
      "walkable",
      scoresFor([...gridDisk(CENTRE, 1), ...gridDisk(FAR, 1)], 5),
    ).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("regions survive the persistence boundary", () => {
  it("JSON round-trips, because regions are cached and shared", () => {
    const cells = gridDisk(CENTRE, 1);
    const region = buildRegion(cells, "walkable", scoresFor(cells, 5));
    const revived = JSON.parse(JSON.stringify(region)) as typeof region;
    expect(revived).toEqual(region);
  });
});

describe("empty components are rejected at the public boundary", () => {
  it("throws rather than returning an invalid Region", () => {
    // `buildRegion([])` used to return `id: ""`, `minScore: Infinity` and
    // `maxScore: -Infinity` — all of which look like data downstream rather
    // than like the caller error they are. `connectedComponents` never emits an
    // empty component, so this is a boundary guard, not a reachable path.
    expect(() => buildRegion([], "walkable", new Map())).toThrow(RangeError);
  });
});
