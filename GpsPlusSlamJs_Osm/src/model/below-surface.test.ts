/**
 * WHY THESE TESTS MATTER.
 *
 * The scorer multiplies a factor per feature per tag and **`0` is absorbing**,
 * so ONE feature vetoes a whole cell. That is right for a wall and wrong for a
 * car park two levels underneath a plaza — which is the reported bug: something
 * mapped below the Domplatte makes the walkable surface above it score as not
 * walkable.
 *
 * The risk in fixing it is symmetric and worth stating: a predicate that is too
 * eager DELETES real walkable ground, which is the same defect in the opposite
 * direction and much harder to notice — nothing looks broken, there is simply
 * less map. So the exclusions below carry as much weight as the inclusions, and
 * each has its own test.
 *
 * @see below-surface.ts.md
 * @see GpsPlusSlamJs_Docs/docs/2026-08-05-0008-osm-below-surface-features-plan.md
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { isBelowSurface } from "./below-surface.js";
import type { OsmFeature } from "./osm-feature.js";

/** A feature carrying only tags — geometry is irrelevant to this predicate. */
const feature = (tags: Record<string, string>): OsmFeature => ({
  type: "way",
  id: 1,
  geometry: [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.001 },
    { lat: 0.001, lng: 0.001 },
    { lat: 0, lng: 0 },
  ],
  tags,
});

describe("isBelowSurface — what counts as under the ground being scored", () => {
  it("treats a negative `layer` as below surface", () => {
    // The reported case: `way/32555488` under the Domplatte.
    expect(isBelowSurface(feature({ layer: "-1", highway: "service" }))).toBe(
      true,
    );
    expect(isBelowSurface(feature({ layer: "-3" }))).toBe(true);
  });

  it("treats a negative `level` as below surface", () => {
    // The indoor-mapping analogue of `layer`. A basement corridor is under the
    // surface for the same reason a tunnel is.
    expect(isBelowSurface(feature({ level: "-1", indoor: "corridor" }))).toBe(
      true,
    );
  });

  it("treats `location=underground` as below surface", () => {
    expect(isBelowSurface(feature({ location: "underground" }))).toBe(true);
  });

  it("treats a tunnel as below surface", () => {
    expect(isBelowSurface(feature({ tunnel: "yes", highway: "primary" }))).toBe(
      true,
    );
    expect(isBelowSurface(feature({ tunnel: "culvert" }))).toBe(true);
  });
});

describe("isBelowSurface — what must NOT count, because deleting ground is the mirror bug", () => {
  it("does NOT treat `tunnel=building_passage` as below surface", () => {
    // AN ARCADE OR GATEWAY THROUGH A BUILDING, at ground level, and walkable.
    // Treating the `tunnel` KEY uniformly would delete exactly the kind of
    // covered pedestrian route a walkability map exists to find.
    expect(
      isBelowSurface(
        feature({ tunnel: "building_passage", highway: "footway" }),
      ),
    ).toBe(false);
  });

  it("does NOT treat `covered=yes` as below surface", () => {
    // A covered walkway is still ground you walk on.
    expect(
      isBelowSurface(feature({ covered: "yes", highway: "footway" })),
    ).toBe(false);
  });

  it("does NOT treat bare `indoor` as below surface", () => {
    // `indoor` carries NO vertical information — an indoor corridor is usually
    // at ground level. `level` is what says which floor, and it is tested above.
    expect(isBelowSurface(feature({ indoor: "yes" }))).toBe(false);
    expect(isBelowSurface(feature({ indoor: "corridor" }))).toBe(false);
  });

  it("does NOT treat a positive or zero layer as below surface", () => {
    // `layer > 0` is a BRIDGE, deliberately out of scope: a bridge deck and the
    // ground beneath it both score, which is wrong but benign, and deciding
    // which surface wins is its own piece of work. See F59.
    expect(isBelowSurface(feature({ layer: "1", highway: "primary" }))).toBe(
      false,
    );
    expect(isBelowSurface(feature({ layer: "0" }))).toBe(false);
  });

  it("treats an untagged feature as surface", () => {
    expect(isBelowSurface(feature({}))).toBe(false);
    expect(isBelowSurface(feature({ leisure: "park" }))).toBe(false);
  });
});

describe("isBelowSurface — defensive parsing, because OSM values are free text", () => {
  it("treats an unparseable layer as SURFACE, not below", () => {
    // THE SAFE DEFAULT, and the direction matters. Today everything scores as
    // surface, so an unparseable value keeping that behaviour changes nothing;
    // guessing "below" would silently delete ground on malformed data.
    //
    // `-1;0` is a real OSM form for a way spanning two layers — it TOUCHES the
    // surface, so surface is also the correct answer rather than merely the safe
    // one. `−1` uses U+2212, which `Number` does not accept.
    expect(isBelowSurface(feature({ layer: "-1;0" }))).toBe(false);
    expect(isBelowSurface(feature({ layer: "−1" }))).toBe(false);
    expect(isBelowSurface(feature({ layer: "" }))).toBe(false);
    expect(isBelowSurface(feature({ layer: "deep" }))).toBe(false);
  });

  it("never throws, whatever the tags contain (property)", () => {
    // This runs over merged OSM data from an unbounded tag space; a predicate
    // that throws takes the whole scoring pass down with it.
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.string(), { maxKeys: 6 }),
        (tags) => {
          expect(() => isBelowSurface(feature(tags))).not.toThrow();
          expect(typeof isBelowSurface(feature(tags))).toBe("boolean");
        },
      ),
    );
  });
});
