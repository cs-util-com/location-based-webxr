import { describe, expect, it } from "vitest";

import { loadSite } from "../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { isClosedWay } from "../model/osm-feature.js";
import { toGeometry } from "../model/osm-geometry.js";
import type { OsmFeature, OsmWay } from "../model/osm-feature.js";

/**
 * How exposed are we to the `clipped` form's hazard? (F32's remaining half.)
 *
 * WHY THIS MATTERS NOW. `areal-only` is adopted and is 3.2x cheaper, but its
 * res7:res9 ratio is unmeasured — and §0.2 says the number that decides whether
 * §6's wider heat radius is affordable is whether payload tracks AREA.
 * `clipped-areal` is the only form measured to do that (21.0x), so it is the
 * remaining prize. Its blocker is this hazard, from §0.3:
 *
 * > a closed way clipped at a tile boundary is no longer closed. `toGeometry`
 * > decides area-vs-line by closure, so a landuse polygon crossing the boundary
 * > silently becomes a linestring and its affordance score changes from an area
 * > fraction to a line intersection. **This is a scoring correctness bug that
 * > produces no error and no visible artefact.**
 *
 * WHAT THIS TEST IS, AND WHAT IT IS NOT. It is an OFFLINE ESTIMATE of the
 * exposure, not a verification of Overpass's behaviour. It takes the fixture's
 * own ways, drops every coordinate outside the capture bbox, and counts how many
 * previously-closed ways stop being closed and change classification.
 *
 * **The approximation is deliberate and its limit is stated rather than hidden:**
 * Overpass's `out geom(bbox)` emits `null` entries for out-of-box nodes rather
 * than omitting them, so the real payload differs in shape from this simulation.
 * What the simulation gets right is the QUESTION — how many rings in a real tile
 * straddle its boundary — and that number is what decides whether `clipped` is
 * worth pursuing at all. A real clipped capture is the authoritative check and is
 * only worth taking if this says the exposure is small.
 */

const site = loadSite("cologne-cathedral");
const bbox = site.bbox;
const features = parseOverpassJson(site.payload).features;

const inside = (position: { lat: number; lng: number }): boolean =>
  position.lat >= bbox.south &&
  position.lat <= bbox.north &&
  position.lng >= bbox.west &&
  position.lng <= bbox.east;

/** The same way with every out-of-bbox coordinate removed. */
const clip = (way: OsmWay): OsmWay => ({
  ...way,
  geometry: way.geometry.filter(inside),
});

const ways = features.filter(
  (feature): feature is OsmWay & OsmFeature => feature.type === "way",
);

describe("how many rings would the `clipped` form break?", () => {
  it("reports the exposure, by counting rings that straddle the tile edge", () => {
    let closedBefore = 0;
    let brokenByClipping = 0;
    let classificationFlips = 0;
    const examples: string[] = [];

    for (const way of ways) {
      if (!isClosedWay(way)) continue;
      closedBefore += 1;
      const clipped = clip(way);
      if (isClosedWay(clipped)) continue;
      brokenByClipping += 1;

      // `toGeometry` returns a RESULT, not a geometry: `{ok, geometry}` or a
      // failure. Reading `.kind` off the result is always `undefined`, which
      // made the first version of this test report "0 flips" for every way in
      // the extract — the classification comparison was not running at all.
      const kindOf = (candidate: OsmWay): string => {
        const result = toGeometry(candidate);
        return result.ok ? result.geometry.kind : "failed";
      };
      const before = kindOf(way);
      const after = kindOf(clipped);
      if (before !== after) {
        classificationFlips += 1;
        if (examples.length < 10) {
          examples.push(
            `way/${String(way.id)} ${before} -> ${after} ` +
              `(${Object.entries(way.tags)
                .slice(0, 2)
                .map(([k, v]) => `${k}=${v}`)
                .join(",")})`,
          );
        }
      }
    }

    console.log(
      `clipped-form exposure @ cologne-cathedral (res ${site.captureRes}):\n` +
        `  ways in the extract:                 ${ways.length}\n` +
        `  closed rings:                        ${closedBefore}\n` +
        `  rings broken by clipping:            ${brokenByClipping}\n` +
        `  area -> line classification flips:   ${classificationFlips}`,
    );
    for (const example of examples) console.log(`    ${example}`);

    // REPORTED, NOT GATED. This measures a form we have NOT adopted, so a red
    // test here would be asserting something about a hypothetical. The number is
    // the evidence for whether `clipped-areal` is worth the follow-up capture.
    expect(closedBefore).toBeGreaterThan(0);
  });

  it("confirms the simulation can actually break a ring", () => {
    // THE GUARD THAT STOPS THE COUNT ABOVE BEING A COMFORTING ZERO FOR THE WRONG
    // REASON. If `inside` were wrong — a swapped lat/lng, a bbox read from the
    // wrong field — every coordinate would test as inside, nothing would clip,
    // and the exposure would report zero while measuring nothing at all.
    const ring: OsmWay = {
      type: "way",
      id: -1,
      tags: { landuse: "grass" },
      geometry: [
        { lat: bbox.south + 0.0001, lng: bbox.west + 0.0001 },
        { lat: bbox.south + 0.0001, lng: bbox.east + 1 },
        { lat: bbox.north + 1, lng: bbox.east + 1 },
        { lat: bbox.north + 1, lng: bbox.west + 0.0001 },
        { lat: bbox.south + 0.0001, lng: bbox.west + 0.0001 },
      ],
    };
    expect(isClosedWay(ring)).toBe(true);
    expect(isClosedWay(clip(ring))).toBe(false);

    // AND THAT THE CLASSIFICATION COMPARISON ITSELF RUNS. The first version of
    // this suite checked only the two lines above — the clipping worked, so the
    // guard passed — while `toGeometry(...)?.kind` was `undefined` for every way
    // in the extract and the headline count was measuring nothing. A guard that
    // only covers half the machinery reports success for the other half.
    const kindOf = (candidate: OsmWay): string => {
      const result = toGeometry(candidate);
      return result.ok ? result.geometry.kind : "failed";
    };
    expect(kindOf(ring)).toBe("polygon");
    expect(kindOf(clip(ring))).not.toBe("polygon");
  });
});
