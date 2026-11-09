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
 * FIXED by the skeleton roof (M2 of
 * `GpsPlusSlamJs_Docs/docs/2026-11-07-2130-osm-skeleton-roof-and-geometry-review-fixes-plan.md`).
 * Until then the hip-over-outline fallback went flat at the eave where a hip
 * line would cross a wall, 29 volumes were short at 1 cm, and this was an
 * `it.fails` beside a pinned list of them. Every rung of the new fallback
 * ladder reaches the tagged top (the prism included), so the strict assertion
 * is a plain `it` and the list is gone.
 *
 * Empty meshes are left out: a degenerate footprint draws nothing, so it has no
 * drawn top to compare. The fixtures carry no terrain, so `rise` is 0 here and
 * the comparison is the roof alone.
 */

/** Drawn top and reported top agree to this, metres. */
const TOLERANCE_M = 0.01;

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

interface ShortVolume {
  /** `fixture feature`, the pinned identity. */
  readonly key: string;
  /** The key with the reported and drawn tops, for a readable failure. */
  readonly detail: string;
}

/** Every volume whose drawn top disagrees with its reported one. */
function shortVolumes(fixtures: readonly Fixture[]): ShortVolume[] {
  return fixtures.flatMap((fixture) =>
    fixture.volumes
      .filter((volume) => volume.mesh.triangleCount > 0)
      .filter(
        (volume) =>
          Math.abs(volume.topHeightM - drawnTop(volume)) > TOLERANCE_M,
      )
      .map((volume) => {
        const key = `${fixture.name} ${volume.feature}`;
        return {
          key,
          detail: `${key}: reported ${volume.topHeightM.toFixed(2)}, drawn ${drawnTop(volume).toFixed(2)}`,
        };
      }),
  );
}

describe("drawn top against reported top, over the 13 fixtures", () => {
  const fixtures = [...siteFixtures(), ...landmarkFixtures()];
  const short = shortVolumes(fixtures);

  it("covers all 13 fixtures", () => {
    // A fixture that silently drops out would make the test below pass on
    // less data than they claim.
    expect(fixtures).toHaveLength(13);
  });

  it("draws every volume up to its reported top", () => {
    expect(short.map((v) => v.detail)).toEqual([]);
  });
});
