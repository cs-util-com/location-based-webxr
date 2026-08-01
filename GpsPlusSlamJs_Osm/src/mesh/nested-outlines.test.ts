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
 * ONE RULE COVERS IT, and finding that out cost a wrong turn worth recording. A
 * second rule — "suppress any outline nested inside a larger outline that owns
 * parts" — was written alongside, on the belief that the tower owned no parts.
 * It owns one: the unnamed `way/207377042`. Measured on the corpus, the second
 * rule suppressed nothing the first had not already suppressed, cost 0.8-4.6 s
 * per build at res-7 scale, and deleted four legitimate buildings. It is gone.
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

  it("gives the tower the part that is actually inside it, which is what suppresses it", () => {
    // THE MECHANISM, pinned explicitly — and it is NOT the one this test claimed
    // when it was written. The first version asserted that the "Nordturm
    // (Sockel)" parts stay with the cathedral and concluded that a separate
    // containment rule was therefore doing the work. The first half is true and
    // the conclusion was wrong, because it was drawn from a search filtered on
    // the NAME "Nordturm" — and the part that matters is unnamed.
    //
    // `way/207377042` — no name, `height=157.38`, `min_height=71` — is the tower
    // shaft, and its representative point IS inside `way/645732604`. So the
    // smallest-container rule hands it to the tower, the tower becomes
    // `claimed`, and the pre-existing "an outline with parts is not extruded"
    // rule suppresses it. One rule, not two.
    //
    // Measured from this fixture, and still true:
    //   tower     way/645732604   2.970e-8 deg²
    //   Sockel    way/206020152   5.146e-8 deg²  ← wider than the tower, so it
    //   cathedral way/4532022     1.019e-6 deg²    correctly stays with the dom
    const shaft = volumes.find((volume) => volume.feature === "way/207377042");
    expect(shaft?.parentFeature).toBe(NORDTURM_KEY);

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
  // These exercise the smallest-container rule directly, without the fixture.
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

  it("suppresses a nested outline once a part lands inside IT rather than its host", () => {
    // The reported defect in miniature, and the mechanism named correctly: the
    // part's representative point falls inside the inner outline, so the inner
    // outline claims it and the pre-existing rule stops drawing the inner
    // outline. This test was originally titled "…that owns no parts at all",
    // which described a rule that has since been removed — and, on this fixture,
    // was never the rule doing the work.
    const features: OsmFeature[] = [
      wayAt(1, { building: "cathedral" }, ring(0.01)),
      wayAt(2, { building: "tower", height: "157" }, ring(0.004, 0.001)),
      wayAt(3, { "building:part": "yes", height: "20" }, ring(0.008, 0.0005)),
    ];
    const volumes = buildBuildings(features, {
      frame: enuFrameAt({ lat: 0, lng: 0 }),
    });
    expect(
      volumes.find((volume) => volume.feature === "way/3")?.parentFeature,
    ).toBe("way/2");
    const nested = volumes.filter(
      (volume) =>
        volume.feature === "way/2" && volume.parentFeature === undefined,
    );
    expect(nested).toEqual([]);
  });

  it("STILL DRAWS a nested outline that owns no part anywhere", () => {
    // THE DELIBERATE BEHAVIOUR CHANGE, pinned so it cannot drift back silently.
    // A rule suppressing every outline nested inside a modelled building was
    // written and removed: measured on the corpus it suppressed nothing the
    // smallest-container rule had not already suppressed, and it deleted four
    // real buildings — an `industrial` under Cologne Cathedral and three
    // Heidelberg `kiosk`s.
    //
    // Nesting does not imply duplication. A kiosk inside a station concourse is
    // a building, and the cost of drawing it is a small box that is genuinely
    // there; the cost of the rule was seconds per build plus four deletions.
    const features: OsmFeature[] = [
      wayAt(1, { building: "train_station" }, ring(0.01)),
      // A part of the BIG building only — nothing lands inside the kiosk.
      wayAt(2, { "building:part": "yes", height: "30" }, ring(0.009, 0.0005)),
      wayAt(3, { building: "kiosk", height: "3" }, ring(0.0004, 0.0002)),
    ];
    const volumes = buildBuildings(features, {
      frame: enuFrameAt({ lat: 0, lng: 0 }),
    });
    expect(
      volumes.some(
        (volume) =>
          volume.feature === "way/3" && volume.parentFeature === undefined,
      ),
    ).toBe(true);
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
