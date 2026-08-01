import { describe, expect, it } from "vitest";

import { buildBuildings, type BuildingVolume } from "./buildings.js";
import { enuFrameAt } from "./enu.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { CORPUS_SITES } from "../places/sites.js";

/**
 * NESTED building outlines (R5-7, DEC-R5-2).
 *
 * WHY THESE TESTS MATTER. `buildings.ts` already implements the Simple 3D
 * Buildings rule for the FLAT case — an outline with parts is not extruded,
 * because "every detailed building gets a box drawn through it" is the most
 * visible S3DB mistake there is. It got the NESTED case wrong in a way three
 * rounds of testing reported as a symptom and nobody traced:
 *
 * `assignPartsToOutlines` gave each part to `outlines.find(...)` — the FIRST
 * outline containing it. Cologne Cathedral is `way/4532022` (`building=
 * cathedral`) with `way/645732604` (`building=tower`, "Nordturm", height 157)
 * nested inside it. The cathedral sorts first, so it claimed the Nordturm's own
 * `building:part` volumes, the tower outline was left holding NOTHING, and
 * nothing suppressed it. It drew as a solid 157 m prism through the detailed
 * model — which is the reported screenshot exactly.
 *
 * The asymmetry in the report is the confirming detail: `way/645732603`
 * ("Südturm") carries `man_made=tower` with NO `building` tag, so `isBuilding`
 * is false and it is not extruded at all. One tower boxed, one tower missing,
 * from the same cause — see the follow-up on `man_made` (N4/DEC-R5-13) for the
 * missing half, which is deliberately NOT fixed here.
 *
 * Two rules cover it, and they are tested SEPARATELY on purpose: a green suite
 * that merged them would not say which one is load-bearing, and the Sockel
 * parts may legitimately fall outside the tower ring they belong to.
 */

const CATHEDRAL = CORPUS_SITES.find((site) => site.id === "cologne-cathedral");

/** `building=tower` + `man_made=tower`, height 157, name "Nordturm". */
const NORDTURM_KEY = "way/645732604";
/** The cathedral outline the Nordturm is nested inside. */
const CATHEDRAL_KEY = "way/4532022";

function cathedralFeatures(): readonly OsmFeature[] {
  if (CATHEDRAL === undefined) {
    throw new Error("cologne-cathedral is missing from CORPUS_SITES");
  }
  return parseOverpassJson(loadSite(CATHEDRAL.id).payload).features;
}

function buildCathedral(features: readonly OsmFeature[]): BuildingVolume[] {
  if (CATHEDRAL === undefined) {
    throw new Error("cologne-cathedral is missing from CORPUS_SITES");
  }
  return buildBuildings(features, { frame: enuFrameAt(CATHEDRAL.position) });
}

describe("nested building outlines", () => {
  const features = cathedralFeatures();
  const volumes = buildCathedral(features);

  it("does not extrude the Nordturm tower outline through the cathedral", () => {
    // THE REPORTED DEFECT. A 157 m prism standing in the middle of a modelled
    // cathedral. This is the assertion that must fail before the fix.
    const nordturm = volumes.filter(
      (volume) =>
        volume.feature === NORDTURM_KEY && volume.parentFeature === undefined,
    );
    expect(nordturm).toEqual([]);
  });

  it("keeps the Nordturm Sockel with the cathedral, because the Sockel is WIDER than the tower", () => {
    // THE ASSIGNMENT HALF, separate from the suppression half, and it records a
    // measurement that decides which of DEC-R5-2's two rules actually fixes
    // Cologne. The plan left this open: if the Sockel's representative point
    // falls inside `way/645732604`'s ring, the smallest-container rule claims
    // the tower and suppresses it; if not, the containment rule does.
    //
    // MEASURED FROM THIS FIXTURE — the Sockel is the larger footprint:
    //   tower  way/645732604   2.970e-8 deg²
    //   Sockel way/206020152   5.146e-8 deg²   ← wider, and its centroid is
    //   cathedral way/4532022  1.019e-6 deg²      OUTSIDE the tower ring
    //
    // So a tower base genuinely IS wider than the tower above it, the Sockel is
    // not inside the tower at all, and assigning it there would be wrong. The
    // CONTAINMENT rule is what is load-bearing here; the smallest-container rule
    // is exercised by the synthetic tests below. Asserting the two together
    // would have hidden this entirely.
    const sockel = volumes.find((volume) => volume.feature === "way/206020152");
    expect(sockel?.parentFeature).toBe(CATHEDRAL_KEY);
  });

  it("still builds the cathedral itself as parts rather than as a box", () => {
    // THE GUARD AGAINST OVER-SUPPRESSING. A rule that suppressed too much would
    // make this test the only thing standing between a fix and an empty
    // cathedral — every other assertion here is about something NOT being drawn.
    const cathedralParts = volumes.filter(
      (volume) => volume.parentFeature === CATHEDRAL_KEY,
    );
    expect(cathedralParts.length).toBeGreaterThan(0);
    const cathedralItself = volumes.filter(
      (volume) =>
        volume.feature === CATHEDRAL_KEY && volume.parentFeature === undefined,
    );
    expect(cathedralItself).toEqual([]);
  });

  it("keeps every tower volume below the tagged tower height", () => {
    // The Nordturm's parts top out at 71 m; the tower way claims 157. A volume
    // at 157 m means the outline came back by another route.
    const towerish = volumes.filter(
      (volume) => volume.feature === NORDTURM_KEY,
    );
    for (const volume of towerish) {
      expect(volume.heights.totalHeightM).toBeLessThan(157);
    }
  });
});

describe("nested outlines, synthetic", () => {
  // Cologne only exercises TWO levels. The rule is written for the general case,
  // so the general case needs a test that does not depend on a 1.1 MB fixture.
  const ring = (size: number, offset = 0): [number, number][] => [
    [offset, offset],
    [offset + size, offset],
    [offset + size, offset + size],
    [offset, offset + size],
    [offset, offset],
  ];

  const wayAt = (
    id: number,
    tags: Record<string, string>,
    coords: [number, number][],
  ): OsmFeature => ({
    type: "way",
    id,
    tags,
    geometry: coords.map(([lat, lon]) => ({ lat, lng: lon })),
  });

  it("assigns a part to the innermost outline containing it", () => {
    // outline (big) contains outline (medium) contains part (small).
    const features: OsmFeature[] = [
      wayAt(1, { building: "yes" }, ring(0.01)),
      wayAt(2, { building: "tower" }, ring(0.004, 0.001)),
      wayAt(3, { "building:part": "yes", height: "20" }, ring(0.002, 0.0015)),
    ];
    const volumes = buildBuildings(features, {
      frame: enuFrameAt({ lat: 0, lng: 0 }),
    });
    const part = volumes.find((volume) => volume.feature === "way/3");
    expect(part?.parentFeature).toBe("way/2");
  });

  it("suppresses a nested outline that owns no parts at all", () => {
    // The reported defect in miniature: a small `building=*` outline sitting
    // inside a big one that is modelled with parts. Drawing it puts a box
    // through the model.
    const features: OsmFeature[] = [
      wayAt(1, { building: "cathedral" }, ring(0.01)),
      wayAt(2, { building: "tower", height: "157" }, ring(0.004, 0.001)),
      wayAt(3, { "building:part": "yes", height: "20" }, ring(0.008, 0.0005)),
    ];
    const volumes = buildBuildings(features, {
      frame: enuFrameAt({ lat: 0, lng: 0 }),
    });
    const nested = volumes.filter(
      (volume) =>
        volume.feature === "way/2" && volume.parentFeature === undefined,
    );
    expect(nested).toEqual([]);
  });

  it("still draws a standalone building that contains nothing and is inside nothing", () => {
    // The everyday case, which must not become collateral damage: an ordinary
    // untouched `building=yes` with no parts anywhere near it.
    const features: OsmFeature[] = [
      wayAt(1, { building: "yes", height: "12" }, ring(0.001)),
    ];
    const volumes = buildBuildings(features, {
      frame: enuFrameAt({ lat: 0, lng: 0 }),
    });
    expect(volumes).toHaveLength(1);
    expect(volumes[0]?.feature).toBe("way/1");
  });

  it("keeps a part that shares an edge with its outline", () => {
    // `assignPartsToOutlines` tests a REPRESENTATIVE POINT precisely because
    // parts routinely share an edge with their outline and an all-vertices test
    // fails on a floating-point tie. A smallest-AREA rule must not reintroduce
    // that: the part below is flush with two edges of its outline.
    const features: OsmFeature[] = [
      wayAt(1, { building: "yes" }, ring(0.004)),
      wayAt(2, { "building:part": "yes", height: "9" }, ring(0.002)),
    ];
    const volumes = buildBuildings(features, {
      frame: enuFrameAt({ lat: 0, lng: 0 }),
    });
    const part = volumes.find((volume) => volume.feature === "way/2");
    expect(part?.parentFeature).toBe("way/1");
  });
});
