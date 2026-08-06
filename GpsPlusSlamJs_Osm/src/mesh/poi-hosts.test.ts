import { describe, expect, it } from "vitest";

import {
  footprintAnchor,
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
    // A café node inside a `landuse` plate is not a café that has already been
    // drawn. Only the four area kinds are self-describing; everything else needs
    // its symbol.
    const placement = resolvePoiPlacement(
      { kind: "amenity=cafe", hosts: [host("plates")] },
      layers("plates"),
    );
    expect(placement.at).toBe("host");
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
        host("buildings", { feature: "way/b" }),
        host("plates", { feature: "way/p" }),
      ],
    };
    const withBoth = resolvePoiPlacement(marker, layers("buildings", "plates"));
    expect(withBoth.at === "host" && withBoth.host.feature).toBe("way/b");
    const platesOnly = resolvePoiPlacement(marker, layers("plates"));
    expect(platesOnly.at === "host" && platesOnly.host.feature).toBe("way/p");
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
    expect(footprintAnchor([])).toEqual({ x: 0, y: 0, spanM: 0 });
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
