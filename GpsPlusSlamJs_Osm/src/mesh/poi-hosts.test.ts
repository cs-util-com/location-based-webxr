import { describe, expect, it } from "vitest";

import {
  annotatePoiHosts,
  dropHostedDuplicates,
  footprintAnchor,
  hostDerivedMarkers,
  hostMatches,
  hostScale,
  resolvePoiPlacement,
  type PoiHostAnchor,
  type PoiHostLayer,
} from "./poi-hosts.js";

/**
 * WHY THESE TESTS MATTER, and it is the inverse case that carries the weight.
 *
 * This rule DELETES AND MOVES MARKERS, so every way it can be wrong is a way to
 * make a real feature disappear from the scene with nothing reported — the
 * silent-absence failure this package keeps meeting. The obvious implementation
 * (drop any marker inside any polygon) looks perfectly correct on a fixture
 * where a building happens to exist, and empties every station concourse of its
 * benches on one where it does not.
 *
 * The layer cases are the other half. `plates` is OFF by default (DEC-R7b-5), so
 * a rule that suppressed against undrawn geometry would make a swimming pool
 * invisible under the shipped settings — which reads as a rendering bug rather
 * than a decision, and is exactly what DEC-S1 was written to prevent.
 */

const layers = (...on: PoiHostLayer[]): ReadonlySet<PoiHostLayer> =>
  new Set(on);

const host = (
  layer: PoiHostLayer,
  overrides: Partial<PoiHostAnchor> = {},
): PoiHostAnchor => ({
  layer,
  feature: "way/1",
  x: 10,
  y: 20,
  topM: 12,
  spanM: 24,
  ...overrides,
});

describe("resolvePoiPlacement", () => {
  it("leaves a marker at its node when it has no host at all", () => {
    // THE COMMON CASE BY FAR. Most POI nodes are street furniture with no
    // enclosing geometry of any kind, and this rule must be invisible to them.
    expect(
      resolvePoiPlacement({ kind: "amenity=bench" }, layers("buildings")),
    ).toEqual({ at: "node" });
    expect(
      resolvePoiPlacement(
        { kind: "amenity=cafe", hosts: [] },
        layers("buildings", "plates"),
      ),
    ).toEqual({ at: "node" });
  });

  it("moves a symbol kind onto its building's roof", () => {
    // THE FEATURE. A café inside a building stops being a marker in a wall and
    // becomes the label that building was missing.
    const placement = resolvePoiPlacement(
      { kind: "amenity=cafe", hosts: [host("buildings")] },
      layers("buildings"),
    );
    expect(placement.at).toBe("host");
    if (placement.at !== "host") return;
    expect(placement.host.topM).toBe(12);
    expect(placement.liftM).toBeGreaterThan(0);
  });

  it("SUPPRESSES an area kind whose own area is drawn", () => {
    // A pool marker over a drawn pool is the same fact twice — "das wäre ja
    // quasi doppelt". The area IS the thing, so nothing is added above it.
    const placement = resolvePoiPlacement(
      { kind: "leisure=swimming_pool", hosts: [host("plates")] },
      layers("plates"),
    );
    expect(placement.at).toBe("suppressed");
  });

  it("KEEPS that same marker when its layer is switched off", () => {
    // THE ASSERTION DEC-S1 EXISTS FOR, and the reason the rule is layer-aware at
    // all. `plates` is off by default, so suppressing on the DATA rather than on
    // what is DRAWN would make a swimming pool invisible under the shipped
    // settings — a data loss that looks like a rendering bug.
    const marker = {
      kind: "leisure=swimming_pool",
      hosts: [host("plates")],
    };
    expect(resolvePoiPlacement(marker, layers("buildings"))).toEqual({
      at: "node",
    });
    expect(resolvePoiPlacement(marker, layers())).toEqual({ at: "node" });
  });

  it("does not let a plate host a kind that is not an area kind", () => {
    // A café node inside a `landuse` plate is not a café that has been drawn
    // already, and the plate is not the café. Re-anchoring here would move the
    // symbol to the middle of a retail park — so the marker stays at its node.
    const placement = resolvePoiPlacement(
      { kind: "amenity=cafe", hosts: [host("plates")] },
      layers("plates"),
    );
    expect(placement.at).toBe("node");
  });

  it("does not let a building host an AREA kind", () => {
    // The asymmetry, from the other side (DEC-S7). A pool node inside a building
    // footprint is an indoor pool — the building is not the pool, and putting a
    // pool symbol on its roof would be a claim about the whole building.
    const placement = resolvePoiPlacement(
      { kind: "leisure=swimming_pool", hosts: [host("buildings")] },
      layers("buildings"),
    );
    expect(placement.at).toBe("node");
  });

  it("takes the first ENABLED host when a marker has several", () => {
    // A café can sit inside both a building and a landuse plate. The building is
    // resolved first by the worker, so it wins — but with buildings off, the
    // plate must still be considered rather than the whole marker giving up.
    const marker = {
      kind: "amenity=cafe",
      hosts: [
        host("buildings", { feature: "way/11" }),
        host("plates", { feature: "way/12" }),
      ],
    };
    const withBoth = resolvePoiPlacement(marker, layers("buildings", "plates"));
    expect(withBoth.at === "host" && withBoth.host.feature).toBe("way/11");
    // With buildings off, the plate is skipped rather than promoted: it cannot
    // host a café at all, so the marker falls back to its node.
    expect(resolvePoiPlacement(marker, layers("plates"))).toEqual({
      at: "node",
    });
  });
});

describe("hostMatches", () => {
  it("lets any building host a symbol kind", () => {
    // The ordinary case this feature exists for: a restaurant node inside a way
    // tagged only `building=yes`, which is most of real OSM. Strict tag equality
    // would miss it and the roof symbol would never appear.
    expect(hostMatches("amenity=restaurant", host("buildings"))).toBe(true);
  });

  it("refuses a building for an area kind", () => {
    expect(hostMatches("amenity=parking", host("buildings"))).toBe(false);
  });
});

describe("hostScale", () => {
  it("never shrinks a symbol below its authored size", () => {
    // A corner café keeps the size it was designed and picked at. Shrinking on a
    // small host would make the smallest hosts the hardest to read, which is
    // backwards.
    expect(hostScale(4)).toBe(1);
    expect(hostScale(24)).toBe(1);
  });

  it("grows a symbol over a large host, and stops", () => {
    // A 0.9 m symbol on a hospital roof is invisible from the orbit camera. An
    // UNCLAMPED scale is the opposite failure: a stadium would carry a
    // ten-metre knife and fork.
    expect(hostScale(48)).toBeCloseTo(2, 6);
    expect(hostScale(1000)).toBe(3);
  });

  it("returns 1 for a degenerate span rather than NaN or Infinity", () => {
    // One NaN in a transform removes the object from the scene with nothing
    // reported, and a zero-span host is a collapsed way — which real OSM has.
    expect(hostScale(0)).toBe(1);
    expect(hostScale(Number.NaN)).toBe(1);
    expect(hostScale(Infinity)).toBe(1);
  });
});

describe("footprintAnchor", () => {
  it("finds the middle and the diagonal of a footprint", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const anchor = footprintAnchor(square);
    expect(anchor.x).toBeCloseTo(5, 6);
    expect(anchor.y).toBeCloseTo(5, 6);
    expect(anchor.spanM).toBeCloseTo(Math.hypot(10, 10), 6);
  });

  it("survives an empty footprint rather than returning NaN", () => {
    // A collapsed way triangulates to nothing and can reach here. `0 / 0` is
    // NaN, and a NaN anchor would delete the marker it was meant to place.
    const anchor = footprintAnchor([]);
    expect(anchor.x).toBe(0);
    expect(anchor.y).toBe(0);
    expect(anchor.spanM).toBe(0);
    // Asserted field by field rather than with `toEqual` on the whole object,
    // because the anchor also carries the broad-phase bounds now and a
    // whole-object match would fail on every future field for no reason.
    expect(Number.isNaN(anchor.spanM)).toBe(false);
  });

  it("returns an INVERTED box for an empty footprint, so the broad phase rejects everything", () => {
    // Why this test matters: the bbox reject in `annotatePoiHosts` is only safe
    // because it can never discard a host `containsPoint` would have accepted.
    // For an empty footprint `containsPoint` accepts nothing, so the box must
    // reject everything — and `min = +Infinity, max = -Infinity` is what makes
    // that true for every point without a special case at the call site. A
    // degenerate `0,0,0,0` box would instead claim the origin, which is exactly
    // where a collapsed way's anchor sits.
    const anchor = footprintAnchor([]);
    expect(anchor.minX).toBe(Infinity);
    expect(anchor.maxX).toBe(-Infinity);
    expect(anchor.minY).toBe(Infinity);
    expect(anchor.maxY).toBe(-Infinity);
  });

  it("returns bounds that enclose every vertex, which is what makes the reject conservative", () => {
    // Why this test matters: if the bounds were ever tighter than the footprint,
    // `annotatePoiHosts` would silently drop real hosts — a marker would stop
    // being re-anchored onto its building and would look like a data error
    // rather than a pruning bug. This pins the enclosing property directly.
    const L = [
      { x: -3, y: 2 },
      { x: 7, y: 2 },
      { x: 7, y: 11 },
      { x: 4, y: 11 },
      { x: 4, y: 5 },
      { x: -3, y: 5 },
    ];
    const anchor = footprintAnchor(L);
    for (const point of L) {
      expect(point.x).toBeGreaterThanOrEqual(anchor.minX);
      expect(point.x).toBeLessThanOrEqual(anchor.maxX);
      expect(point.y).toBeGreaterThanOrEqual(anchor.minY);
      expect(point.y).toBeLessThanOrEqual(anchor.maxY);
    }
    expect(anchor.minX).toBe(-3);
    expect(anchor.maxX).toBe(7);
    expect(anchor.minY).toBe(2);
    expect(anchor.maxY).toBe(11);
  });

  it("uses the VERTEX mean, with the bias that implies", () => {
    // Stated rather than hidden: a footprint whose points bunch along one edge
    // pulls the anchor toward the dense side. Here five points on the left edge
    // and one on the right put the anchor left of the true middle — which is
    // still on the roof, and is the accepted cost of not computing an area
    // centroid that can fall outside an L-shaped building anyway.
    const biased = [
      { x: 0, y: 0 },
      { x: 0, y: 2 },
      { x: 0, y: 4 },
      { x: 0, y: 6 },
      { x: 0, y: 8 },
      { x: 20, y: 4 },
    ];
    expect(footprintAnchor(biased).x).toBeLessThan(10);
  });
});

describe("annotatePoiHosts", () => {
  const square = (size: number, cx = 0, cy = 0): { x: number; y: number }[] => {
    const h = size / 2;
    return [
      { x: cx - h, y: cy - h },
      { x: cx + h, y: cy - h },
      { x: cx + h, y: cy + h },
      { x: cx - h, y: cy + h },
    ];
  };

  it("annotates a marker with the geometry that contains it", () => {
    const [annotated] = annotatePoiHosts(
      [{ kind: "amenity=cafe", position: { x: 0, y: 0 } }],
      [
        {
          layer: "buildings",
          feature: "way/7",
          footprint: square(40),
          topM: 14,
        },
      ],
    );
    expect(annotated?.hosts).toHaveLength(1);
    expect(annotated?.hosts[0]?.feature).toBe("way/7");
    expect(annotated?.hosts[0]?.topM).toBe(14);
  });

  it("leaves a marker OUTSIDE every footprint with no hosts", () => {
    // The common case, and the one a bounding-box test would get wrong most
    // often. An empty list is what makes `resolvePoiPlacement` return `node`.
    const [annotated] = annotatePoiHosts(
      [{ kind: "amenity=cafe", position: { x: 500, y: 500 } }],
      [
        {
          layer: "buildings",
          feature: "way/7",
          footprint: square(40),
          topM: 14,
        },
      ],
    );
    expect(annotated?.hosts).toEqual([]);
  });

  it("does not confuse a bounding-box hit with containment", () => {
    // THE CASE OWED BY `poi-building-overlap.test.ts`, now with a real subject.
    // An L-shape: the marker sits in the notch, inside the box and outside the
    // polygon. A bbox test would move its symbol onto a roof it is not under.
    const lShape = [
      { x: -20, y: -20 },
      { x: 20, y: -20 },
      { x: 20, y: -10 },
      { x: -10, y: -10 },
      { x: -10, y: 20 },
      { x: -20, y: 20 },
    ];
    const [annotated] = annotatePoiHosts(
      [{ kind: "amenity=cafe", position: { x: 10, y: 10 } }],
      [{ layer: "buildings", feature: "way/13", footprint: lShape, topM: 9 }],
    );
    expect(annotated?.hosts).toEqual([]);
  });

  it("skips a candidate whose layer cannot host that kind", () => {
    // The asymmetry applied at annotation time as well, so a building never even
    // becomes a candidate host for a pool. Cheaper, and it keeps the two halves
    // of DEC-S7 from drifting apart.
    const [annotated] = annotatePoiHosts(
      [{ kind: "leisure=swimming_pool", position: { x: 0, y: 0 } }],
      [
        {
          layer: "buildings",
          feature: "way/7",
          footprint: square(40),
          topM: 14,
        },
      ],
    );
    expect(annotated?.hosts).toEqual([]);
  });

  it("keeps candidate order, so the caller's priority survives", () => {
    // `resolvePoiPlacement` takes the first ENABLED host, so the order this
    // returns IS the priority. Two plates can both contain a pool node — a pool
    // inside a leisure complex — and the smaller, more specific one is passed
    // first by the caller.
    const [annotated] = annotatePoiHosts(
      [{ kind: "leisure=swimming_pool", position: { x: 0, y: 0 } }],
      [
        {
          layer: "plates",
          feature: "way/14",
          footprint: square(40),
          topM: 0,
        },
        {
          layer: "plates",
          feature: "way/15",
          footprint: square(200),
          topM: 0,
        },
      ],
    );
    expect(annotated?.hosts.map((host) => host.feature)).toEqual([
      "way/14",
      "way/15",
    ]);
  });

  it("gives a marker BOTH layers' hosts when both can host its kind", () => {
    // The layer-aware pick only means something if the annotation kept more
    // than one candidate. A symbol kind can only be hosted by buildings and an
    // area kind only by plates, so this is the case where a marker legitimately
    // carries two candidates of the same layer and the enabled set still
    // decides — asserted so a future narrowing of the match rule cannot quietly
    // collapse every marker to a single host.
    const [annotated] = annotatePoiHosts(
      [{ kind: "amenity=cafe", position: { x: 0, y: 0 } }],
      [
        {
          layer: "buildings",
          feature: "way/16",
          footprint: square(40),
          topM: 9,
        },
        {
          layer: "buildings",
          feature: "way/17",
          footprint: square(90),
          topM: 20,
        },
        { layer: "plates", feature: "way/12", footprint: square(300), topM: 0 },
      ],
    );
    expect(annotated?.hosts.map((host) => host.feature)).toEqual([
      "way/16",
      "way/17",
    ]);
  });

  it("preserves marker order, which the pick table depends on", () => {
    // The consumer indexes marker identity by position in this array, so
    // reordering makes every pick after the first name the wrong feature.
    const markers = [
      { kind: "amenity=bench", position: { x: 0, y: 0 } },
      { kind: "amenity=cafe", position: { x: 1, y: 1 } },
      { kind: "amenity=fountain", position: { x: 2, y: 2 } },
    ];
    const annotated = annotatePoiHosts(markers, []);
    expect(annotated.map((marker) => marker.kind)).toEqual(
      markers.map((marker) => marker.kind),
    );
  });
});

describe("way-derived markers (stage 2)", () => {
  const square = (size: number, cx = 0, cy = 0): { x: number; y: number }[] => {
    const h = size / 2;
    return [
      { x: cx - h, y: cy - h },
      { x: cx + h, y: cy - h },
      { x: cx + h, y: cy + h },
      { x: cx - h, y: cy + h },
    ];
  };
  const eligible = (kind: string): boolean =>
    ["amenity=restaurant", "amenity=cafe", "amenity=hospital"].includes(kind);

  it("gives a building tagged as a place its own symbol", () => {
    // THE OWNER'S HEADLINE CASE, and the one stage 1 cannot reach: a restaurant
    // mapped ONLY as a building way has no node, so nothing exists to re-anchor.
    // Tagging the building without a separate node is ordinary practice, so
    // this is most of the case rather than an edge of it.
    const derived = hostDerivedMarkers(
      [
        {
          layer: "buildings",
          feature: "way/5",
          footprint: square(30),
          topM: 11,
        },
      ],
      () => "amenity=restaurant",
      eligible,
    );
    expect(derived).toHaveLength(1);
    expect(derived[0]?.host.topM).toBe(11);
    expect(derived[0]?.host.x).toBeCloseTo(0, 6);
  });

  it("ignores a building whose kind is not on the allow-list", () => {
    // THE ALLOW-LIST IS WHAT KEEPS THIS OUT OF `plates.ts`'s territory. Its keys
    // OVERLAP the POI keys rather than being disjoint, so a "not a plate"
    // deny-list would let a car park through — a restaurant building way and a
    // car-park way both carry `amenity`.
    const derived = hostDerivedMarkers(
      [
        {
          layer: "buildings",
          feature: "way/5",
          footprint: square(30),
          topM: 11,
        },
      ],
      () => "amenity=parking",
      eligible,
    );
    expect(derived).toEqual([]);
  });

  it("ignores plates entirely", () => {
    // A landuse polygon is not a place with a roof to put a symbol on. Only
    // buildings derive markers.
    const derived = hostDerivedMarkers(
      [{ layer: "plates", feature: "way/9", footprint: square(80), topM: 0 }],
      () => "amenity=cafe",
      eligible,
    );
    expect(derived).toEqual([]);
  });

  it("skips a collapsed footprint rather than anchoring it at the origin", () => {
    // Real OSM contains collapsed ways. A zero-span footprint anchors at (0, 0)
    // — the frame origin, which is the user's own position — so a degenerate
    // building would drop a symbol on the camera.
    const derived = hostDerivedMarkers(
      [{ layer: "buildings", feature: "way/98", footprint: [], topM: 4 }],
      () => "amenity=cafe",
      eligible,
    );
    expect(derived).toEqual([]);
  });

  it("DROPS a way-derived marker whose way already has a node marker", () => {
    // THE ASSERTION STAGE 2 EXISTS FOR. A restaurant mapped as node AND way is
    // one restaurant. Without this it grows a second symbol in the same place —
    // which does not read as a duplicate but as a slightly wrong colour where
    // the two z-fight.
    const derived = hostDerivedMarkers(
      [
        {
          layer: "buildings",
          feature: "way/5",
          footprint: square(30),
          topM: 11,
        },
      ],
      () => "amenity=restaurant",
      eligible,
    );
    const kept = dropHostedDuplicates(derived, [
      {
        kind: "amenity=restaurant",
        hosts: [
          {
            layer: "buildings",
            feature: "way/5",
            x: 0,
            y: 0,
            topM: 11,
            spanM: 42,
          },
        ],
      },
    ]);
    expect(kept).toEqual([]);
  });

  it("keeps it when the node is inside a DIFFERENT building", () => {
    // The dedup is keyed on the HOST's feature, not on kind or position: "this
    // way is spoken for" is the precise claim. A café next door must not
    // silence this building's own symbol.
    const derived = hostDerivedMarkers(
      [
        {
          layer: "buildings",
          feature: "way/5",
          footprint: square(30),
          topM: 11,
        },
      ],
      () => "amenity=restaurant",
      eligible,
    );
    const kept = dropHostedDuplicates(derived, [
      {
        kind: "amenity=cafe",
        hosts: [
          {
            layer: "buildings",
            feature: "way/99",
            x: 90,
            y: 90,
            topM: 8,
            spanM: 20,
          },
        ],
      },
    ]);
    expect(kept).toHaveLength(1);
  });
});

describe("a kind with no symbol to float", () => {
  it("STAYS AT ITS NODE inside a building, however tempting the host", () => {
    // THE BUG THIS TEST WAS WRITTEN TO CATCH, and it was live for one commit.
    // `hostMatches` said any non-area kind may be hosted by a building, so an
    // atrium BENCH acquired a host and was re-anchored — a park bench flying
    // onto a roof, at the centroid of a building it happens to stand inside.
    //
    // Family L has no symbol: there is nothing to float, and the marker IS the
    // thing rather than a label for it. Only a kind with a `symbol` can be
    // re-anchored, and the rule asks the registry rather than trusting a caller
    // to remember — a caller that forgets moves benches onto roofs, silently.
    const placement = resolvePoiPlacement(
      {
        kind: "amenity=bench",
        hosts: [
          {
            layer: "buildings",
            feature: "way/21",
            x: 10,
            y: 10,
            topM: 30,
            spanM: 40,
          },
        ],
      },
      new Set<PoiHostLayer>(["buildings"]),
    );
    expect(placement).toEqual({ at: "node" });
  });

  it("still lets a kind WITH a symbol be hosted", () => {
    // The other side, so the guard above cannot be satisfied by refusing
    // everything.
    const placement = resolvePoiPlacement(
      {
        kind: "amenity=cafe",
        hosts: [
          {
            layer: "buildings",
            feature: "way/22",
            x: 10,
            y: 10,
            topM: 30,
            spanM: 40,
          },
        ],
      },
      new Set<PoiHostLayer>(["buildings"]),
    );
    expect(placement.at).toBe("host");
  });
});
