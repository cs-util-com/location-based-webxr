import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildBuildings, type BuildingVolume } from "./buildings.js";
import { enuFrameAt } from "./enu.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { parseOverpassJson } from "../model/overpass-parser.js";

/**
 * Landmark churches measured against the Simple 3D Buildings roof shapes.
 *
 * WHY THIS FILE EXISTS. The synthetic tests in `s3db-roof-tags.test.ts` prove
 * each defect on a box. These prove that the same defects are what a person
 * sees on the buildings that carry the most careful 3D mapping: the Dresden
 * Frauenkirche stone dome, the Berliner Dom central dome, the domed caps of the
 * Munich Frauenkirche and a courtyard block under a giant gabled roof next to it.
 * Fixtures and their provenance: `../testdata/landmarks/README.md`.
 *
 * STATUS: written for the investigation of 2026-11-07 as failing proof of
 * bugs 6 and 7 in
 * `GpsPlusSlamJs_Docs/docs/2026-11-07-0920-osm-building-geometry-bugs-findings.md`;
 * green since the fix on branch r1104 (revolved domes, ridged roofs held over
 * their walls). A third test, on the Dresden Frauenkirche's flat lids, was left
 * out: it measured the east span of a part's top vertices, which a `round`
 * barrel's ridge legitimately has, so it failed nine correct barrels.
 * In the mesh, x is east, z is SOUTH and y is up.
 */

const LANDMARK_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "testdata",
  "landmarks",
);

interface Landmark {
  readonly features: readonly OsmFeature[];
  readonly volumes: BuildingVolume[];
}

function landmark(slug: string): Landmark {
  const fixture = JSON.parse(
    readFileSync(join(LANDMARK_DIR, `${slug}.json`), "utf8"),
  ) as { target: string; payload: unknown };
  const features = parseOverpassJson(fixture.payload).features;
  const target = features.find((f) => `${f.type}/${f.id}` === fixture.target);
  // A relation target (St Basil's) has no geometry of its own; any nearby
  // feature gives the frame its origin.
  const firstPoint = (f: OsmFeature | undefined) =>
    f?.type === "way" ? f.geometry[0] : undefined;
  const origin =
    firstPoint(target) ??
    firstPoint(features.find((f) => firstPoint(f) !== undefined));
  if (origin === undefined) throw new Error(`${slug}: no target geometry`);
  return {
    features,
    volumes: buildBuildings(features, { frame: enuFrameAt(origin) }),
  };
}

function tagsOf(
  features: readonly OsmFeature[],
  key: string,
): Record<string, string> {
  return features.find((f) => `${f.type}/${f.id}` === key)?.tags ?? {};
}

function shaped(lm: Landmark, shapes: readonly string[]): BuildingVolume[] {
  return lm.volumes.filter((v) => {
    const tags = tagsOf(lm.features, v.feature);
    return (
      shapes.includes(tags["roof:shape"] ?? "") &&
      Number.parseFloat(tags["roof:height"] ?? "0") > 0.5
    );
  });
}

/** Whether any vertex lies in the middle three fifths of the roof's rise. */
function hasMidRoofVertex(volume: BuildingVolume): boolean {
  const { eaveHeightM, totalHeightM } = volume.heights;
  const span = totalHeightM - eaveHeightM;
  const p = volume.mesh.positions;
  for (let i = 1; i < p.length; i += 3) {
    const y = p[i] ?? 0;
    if (y > eaveHeightM + 0.2 * span && y < totalHeightM - 0.2 * span) {
      return true;
    }
  }
  return false;
}

/** Furthest a vertex reaches outside the volume's own footprint, in metres. */
function overhangM(volume: BuildingVolume): number {
  const ring = volume.footprint;
  const inside = (x: number, y: number): boolean => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a === undefined || b === undefined) continue;
      if (
        a.y > y !== b.y > y &&
        x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
      ) {
        hit = !hit;
      }
    }
    return hit;
  };
  const toEdge = (x: number, y: number): number => {
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (a === undefined || b === undefined) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1),
        ),
      );
      best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
    }
    return best;
  };
  let worst = 0;
  const p = volume.mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] ?? 0;
    const north = -(p[i + 2] ?? 0);
    if (!inside(x, north)) worst = Math.max(worst, toEdge(x, north));
  }
  return worst;
}

describe("Berliner Dom (way/313670734) and Munich Frauenkirche (way/225698612)", () => {
  it("draws a dome with a curved profile, not as a pyramid", () => {
    // Why this test matters: `dome` was approximated by a pyramid (roof.ts.md
    // section 8.4): apex and eave only, so the central dome of the Berliner Dom and the caps of the
    // Munich towers are cones. A curved profile needs rings in between.
    const domes = [
      ...shaped(landmark("berlin-cathedral"), ["dome"]),
      ...shaped(landmark("munich-frauenkirche"), ["dome"]),
    ];
    expect(domes.length).toBeGreaterThan(1);
    const pointed = domes
      .filter((v) => !hasMidRoofVertex(v))
      .map((v) => v.feature);
    expect(pointed).toEqual([]);
  });
});

describe("ridged roofs on the landmark extracts", () => {
  it("keeps a gabled or hipped roof over its own footprint", () => {
    // Why this test matters: ridge roofs were built over the oriented bounding
    // rectangle, so on a
    // non-rectangular footprint the roof reaches over courtyards and streets.
    // The extracts are trimmed to each landmark's own elements, so the worst
    // case of the census (Polizeipraesidium Muenchen relation/301240, 58 m) is
    // not in them; this asks what remains. Swept in the findings doc at 0.25
    // to 4 m.
    const slugs = [
      "dresden-frauenkirche",
      "munich-frauenkirche",
      "ulm-minster",
      "berlin-cathedral",
      "moscow-st-basil",
    ];
    const over = slugs.flatMap((slug) =>
      landmark(slug)
        .volumes.filter(
          (v) =>
            v.heights.roofShape === "gabled" ||
            v.heights.roofShape === "hipped",
        )
        .map((v) => ({ feature: v.feature, overhangM: overhangM(v) }))
        .filter((r) => r.overhangM > 1),
    );
    expect(over).toEqual([]);
  });
});
