/**
 * Non-building tall structures — F34, closed by §5 step 3.
 *
 * WHAT THIS IS ABOUT. Cologne Cathedral has two 157 m towers and only one of
 * them draws. The fixture says exactly why:
 *
 * - `way/645732604` "Nordturm" — `building=tower` AND `man_made=tower`.
 * - `way/645732603` "Südturm" — `man_made=tower` ONLY, no `building` tag.
 *
 * `isBuilding` keys off `building`, so the Nordturm is extruded and the Südturm
 * is not. The visible result is a cathedral with one tower, which reads as a
 * failed fetch rather than as a tagging distinction — and the general case is
 * chimneys, masts, silos and storage tanks, none of which draw either.
 *
 * **THIS IS OUR OWN DESIGN, NOT A PORT.** §5.2 checked streets-gl and it has no
 * `man_made` branch at all, so its Südturm is missing too. No reference supplies
 * the tag list or the height conventions, which is why the list is small and
 * explicit and why the tests below spend most of their effort on what must NOT
 * be drawn.
 *
 * THE ASSERTION THAT WILL ACTUALLY CATCH A MISTAKE is the Nordturm one. The
 * obvious implementation adds a second selector without excluding what
 * `isBuilding` already claims, and the symptom is a tower extruded twice in the
 * same place — invisible until something z-fights, and by then the cause is
 * three commits back.
 */

import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { isBuilding } from "./building-heights.js";
import {
  TALL_STRUCTURE_KINDS,
  isTallStructure,
  tallStructureHeightM,
} from "./tall-structures.js";

function way(tags: Record<string, string>): OsmFeature {
  return {
    type: "way",
    id: 1,
    tags,
    geometry: [],
  } as unknown as OsmFeature;
}

describe("isTallStructure", () => {
  it("selects the Südturm's tagging: man_made=tower with no building tag", () => {
    const südturm = way({ man_made: "tower", name: "Südturm", height: "157" });
    expect(isTallStructure(südturm)).toBe(true);
  });

  it("REFUSES the Nordturm, because `building=tower` already claims it", () => {
    // THE TEST THAT MATTERS. Without this exclusion the Nordturm is extruded
    // once by `buildings.ts` and once here — two coincident 157 m prisms, which
    // is invisible until it z-fights.
    const nordturm = way({
      building: "tower",
      man_made: "tower",
      name: "Nordturm",
      height: "157",
    });
    expect(isBuilding(nordturm)).toBe(true);
    expect(isTallStructure(nordturm)).toBe(false);
  });

  it("refuses a building:part, which its own outline already owns", () => {
    // The five `Südturm (Sockel)` parts reach 70.95 m and are drawn by the part
    // path. Claiming them here would double them too.
    expect(
      isTallStructure(way({ "building:part": "yes", man_made: "tower" })),
    ).toBe(false);
  });

  it("refuses `man_made` values that are not on the list", () => {
    // A PERMISSIVE RULE IS THE HAZARD. `man_made` covers surveillance cameras,
    // street cabinets, pipelines and water wells — the Cologne fixture has 36
    // `man_made=surveillance` alone. Extruding those would fill the street with
    // furniture-sized boxes and look like a data bug.
    for (const value of [
      "surveillance",
      "street_cabinet",
      "pipeline",
      "water_well",
      "yes",
      "column",
    ]) {
      expect(isTallStructure(way({ man_made: value }))).toBe(false);
    }
  });

  it("selects the rest of the family", () => {
    for (const kind of TALL_STRUCTURE_KINDS) {
      expect(isTallStructure(way({ man_made: kind }))).toBe(true);
    }
  });

  it("refuses a node, because these are areas", () => {
    // POI markers own nodes. Two builders drawing the same feature is the
    // defect every builder in this package has had to get right.
    const node = { type: "node", id: 1, tags: { man_made: "tower" } };
    expect(isTallStructure(node as unknown as OsmFeature)).toBe(false);
  });

  it("refuses an underground structure", () => {
    expect(
      isTallStructure(way({ man_made: "tower", location: "underground" })),
    ).toBe(false);
  });
});

describe("tallStructureHeightM", () => {
  it("reads the Südturm's 157 m", () => {
    expect(
      tallStructureHeightM(way({ man_made: "tower", height: "157" })),
    ).toBeCloseTo(157, 6);
  });

  it("reads a height with units, which OSM writes freely", () => {
    expect(
      tallStructureHeightM(way({ man_made: "tower", height: "40 m" })),
    ).toBeCloseTo(40, 6);
  });

  it("returns undefined rather than a guess when nothing says", () => {
    // DELIBERATE, and the opposite of what `building-heights.ts` does. A
    // building with no height is still a building and 6 m is a reasonable
    // stand-in; a `man_made=tower` with no height could be a 5 m viewing
    // platform or a 300 m transmitter, and a wrong guess at that scale is a
    // landmark-sized lie. Drawing nothing is the honest failure.
    expect(tallStructureHeightM(way({ man_made: "tower" }))).toBeUndefined();
  });

  it("ignores a non-positive or unparseable height", () => {
    for (const height of ["0", "-5", "tall", ""]) {
      expect(
        tallStructureHeightM(way({ man_made: "tower", height })),
      ).toBeUndefined();
    }
  });
});
