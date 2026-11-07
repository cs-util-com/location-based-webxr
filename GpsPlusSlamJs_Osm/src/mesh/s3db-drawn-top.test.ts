import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildBuildings, type BuildingVolume } from "./buildings.js";
import { enuFrameAt } from "./enu.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { CORPUS_SITES } from "../places/sites.js";
import { loadSite } from "../test-utils/load-fixtures.js";

/**
 * Every drawn volume reaches the top it reports, over all 13 fixtures.
 *
 * WHY THIS TEST MATTERS. `topHeightM` is the TAGGED top (`ground.lowest +
 * totalHeightM + rise`), and consumers stand markers on it (OsmDemo's POI
 * hosts). When a roof builder gives up and draws a lower roof, the number and
 * the mesh disagree and a marker floats over the roof - up to 14 m on the Ulm
 * Minster choir. The PR 862 milestone review found 28 volumes more than 0.5 m
 * short (none on main); measuring the number from the mesh instead would make
 * this check pass by definition, so the number stays the tagged top and the
 * mesh has to reach it.
 *
 * KNOWN FAILURE until the skeleton roof lands (M2 of
 * `GpsPlusSlamJs_Docs/docs/2026-11-07-2130-osm-skeleton-roof-and-geometry-review-fixes-plan.md`).
 * The hip-over-outline fallback goes flat at the eave where a hip line would
 * cross a wall. So the strict assertion is `it.fails`, and the count is pinned
 * beside it so it cannot grow unnoticed. M2 removes both: the strict test then
 * passes as a plain `it`.
 *
 * Empty meshes are left out: a degenerate footprint draws nothing, so it has no
 * drawn top to compare. The fixtures carry no terrain, so `rise` is 0 here and
 * the comparison is the roof alone.
 */

/** Drawn top and reported top agree to this, metres. */
const TOLERANCE_M = 0.01;

/**
 * Volumes short of their top on r1129 at 1 cm (29; 28 of them by more than
 * 0.5 m, the review's count). Lowered, never raised: a new short volume is a
 * new defect.
 */
const KNOWN_SHORT_VOLUMES = 29;

const LANDMARK_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "testdata",
  "landmarks",
);

interface Fixture {
  readonly name: string;
  readonly volumes: readonly BuildingVolume[];
}

function siteFixtures(): Fixture[] {
  return CORPUS_SITES.map((site) => ({
    name: site.id,
    volumes: buildBuildings(
      parseOverpassJson(loadSite(site.id).payload).features,
      {
        frame: enuFrameAt(site.position),
      },
    ),
  }));
}

function landmarkFixtures(): Fixture[] {
  return readdirSync(LANDMARK_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const fixture = JSON.parse(
        readFileSync(join(LANDMARK_DIR, name), "utf8"),
      ) as { payload: unknown };
      const features: readonly OsmFeature[] = parseOverpassJson(
        fixture.payload,
      ).features;
      const way = features.find((f) => f.type === "way");
      const origin = way?.type === "way" ? way.geometry[0] : undefined;
      if (origin === undefined) throw new Error(`${name}: no way geometry`);
      return {
        name,
        volumes: buildBuildings(features, { frame: enuFrameAt(origin) }),
      };
    });
}

function drawnTop(volume: BuildingVolume): number {
  let top = -Infinity;
  const positions = volume.mesh.positions;
  for (let i = 1; i < positions.length; i += 3) {
    top = Math.max(top, positions[i] as number);
  }
  return top;
}

/** `fixture volume: reported vs drawn` for every volume that disagrees. */
function shortVolumes(fixtures: readonly Fixture[]): string[] {
  return fixtures.flatMap((fixture) =>
    fixture.volumes
      .filter((volume) => volume.mesh.triangleCount > 0)
      .filter(
        (volume) =>
          Math.abs(volume.topHeightM - drawnTop(volume)) > TOLERANCE_M,
      )
      .map(
        (volume) =>
          `${fixture.name} ${volume.feature}: reported ${volume.topHeightM.toFixed(2)}, drawn ${drawnTop(volume).toFixed(2)}`,
      ),
  );
}

describe("drawn top against reported top, over the 13 fixtures", () => {
  const fixtures = [...siteFixtures(), ...landmarkFixtures()];
  const short = shortVolumes(fixtures);

  it("covers all 13 fixtures", () => {
    // A fixture that silently drops out would make both tests below pass on
    // less data than they claim.
    expect(fixtures).toHaveLength(13);
  });

  it.fails(
    "draws every volume up to its reported top (KNOWN FAILURE until M2)",
    () => {
      expect(short).toEqual([]);
    },
  );

  it("has exactly the known number of short volumes, so the defect cannot grow", () => {
    expect(short).toHaveLength(KNOWN_SHORT_VOLUMES);
  });
});
