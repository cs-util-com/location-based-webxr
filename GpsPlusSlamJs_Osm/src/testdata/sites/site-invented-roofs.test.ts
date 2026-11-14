import { describe, expect, it } from "vitest";

import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import {
  buildBuildings,
  inventedRoofTotals,
  type BuildingVolume,
} from "../../mesh/buildings.js";
import { enuFrameAt } from "../../mesh/enu.js";

/**
 * Invented roofs on the captured sites.
 *
 * WHY THIS FILE MATTERS. The counts are the owner's verdict on the prototype
 * carried into the library: Meggen's village roofed, New York's blocks left
 * flat, and a regression in either shows here first. The other checks are
 * the promises every consumer leans on: a building the map describes is
 * drawn exactly as before, the drawn top is `topHeightM` (POI markers stand
 * on it), and the heights the obstacle index takes are the drawn ones.
 */

const SITES = [
  "heidelberg-altstadt",
  "lucerne-meggen",
  "nyc-park-slope",
  "berlin-alexanderplatz",
  "woodland-hinterzarten",
  "cologne-cathedral",
  "london-tower-bridge",
  "london-westminster",
  "manhattan-midtown",
  "sylt-westerland",
  "tokyo-shinjuku",
  "lucerne-reuss",
] as const;

function build(id: string) {
  const site = loadSite(id);
  const features = parseOverpassJson(site.payload).features;
  const frame = enuFrameAt(site.centre);
  return {
    features,
    frame,
    off: buildBuildings(features, { frame }),
    on: buildBuildings(features, { frame, inventedRoofs: true }),
  };
}

function maxY(volume: BuildingVolume): number {
  let top = -Infinity;
  const { positions } = volume.mesh;
  for (let i = 1; i < positions.length; i += 3) {
    top = Math.max(top, positions[i] as number);
  }
  return top;
}

describe("invented roofs: how many, per site", () => {
  it.each([
    ["lucerne-meggen", 225, 226],
    // 195 outline ways and 2 one-polygon relations.
    ["heidelberg-altstadt", 197, 396],
    ["manhattan-midtown", 0, 244],
    ["nyc-park-slope", 0, 1483],
  ] as const)("%s: %i roofed of %i volumes", (id, roofed, volumes) => {
    const { on } = build(id);
    expect(on).toHaveLength(volumes);
    expect(on.filter((v) => v.roofIsInvented)).toHaveLength(roofed);
  });
});

describe.each(SITES)("invented roofs at %s", (id) => {
  const { features, frame, off, on } = build(id);

  it("draws every other building exactly as with the option off", () => {
    // Only the buildings the planner took (a roof or a lid) may differ; any
    // other building, whatever its height, is drawn byte for byte as before.
    const planned = inventedRoofTotals(features, frame);
    expect(on.map((v) => v.feature)).toEqual(off.map((v) => v.feature));
    on.forEach((volume, i) => {
      const before = off[i] as BuildingVolume;
      expect(before.roofIsInvented).toBe(false);
      if (planned.has(volume.feature)) return;
      expect(volume.mesh.positions).toEqual(before.mesh.positions);
      expect(volume.mesh.indices).toEqual(before.mesh.indices);
    });
  });

  it("draws every invented roof's top at its topHeightM", () => {
    // 5 mm: the mesh is Float32 at up to ~900 m above sea level here, and the
    // skeleton nudges each corner by up to 0.5 mm; a real mismatch (a rise
    // drawn that the plan did not count) is decimetres.
    for (const volume of on.filter((v) => v.roofIsInvented)) {
      expect(Math.abs(maxY(volume) - volume.topHeightM)).toBeLessThan(5e-3);
    }
  });

  it("gives the obstacle index the drawn heights, from the same plans", () => {
    const totals = inventedRoofTotals(features, frame);
    const changed = on.filter(
      (v, i) => v.heights !== off[i]?.heights && totals.has(v.feature),
    );
    for (const volume of changed) {
      expect(totals.get(volume.feature)).toBe(volume.heights.totalHeightM);
    }
    // Every planned building is a drawn volume, and every drawn invented
    // roof is planned.
    const keys = new Set(on.map((v) => v.feature));
    for (const key of totals.keys()) expect(keys.has(key)).toBe(true);
    for (const v of on.filter((v) => v.roofIsInvented)) {
      expect(totals.has(v.feature)).toBe(true);
    }
  });
});
