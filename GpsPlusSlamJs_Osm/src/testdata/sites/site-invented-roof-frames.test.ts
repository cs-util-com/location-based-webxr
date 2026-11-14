import { describe, expect, it } from "vitest";

import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import { buildBuildings, type BuildingVolume } from "../../mesh/buildings.js";
import { enuFrameAt } from "../../mesh/enu.js";

/**
 * Invented roofs do not depend on where the frame is anchored.
 *
 * WHY THIS FILE MATTERS. The demo re-anchors its frame while the user walks,
 * the globe anchors one per delivery, and the obstacle index may plan in its
 * own. A roof is a fact about the ground, so the same features planned in two
 * frames must give the same roof: the same decision (roof or lid, its style,
 * its mesh's size) and the same heights. Before the planner worked in each
 * building's own coordinates, a shift of one centimetre changed ten roofs at
 * Meggen, so every frame below is checked, the tiny one included.
 */

const SITES = [
  "lucerne-meggen",
  "woodland-hinterzarten",
  "lucerne-reuss",
  "heidelberg-altstadt",
  "tokyo-shinjuku",
] as const;

/** Origins around the site centre, in degrees: east, north, both, and tiny. */
const SHIFTS = [
  { lat: 0, lng: 0.005 },
  { lat: 0.004, lng: 0 },
  { lat: -0.003, lng: -0.004 },
  { lat: 0, lng: 1e-7 },
] as const;

/**
 * What the planner decided for each building: whether its roof is invented,
 * the roof shape and the mesh size. Only invented buildings are compared: a
 * roof the map describes is the library's, not this planner's.
 */
function decisions(volumes: readonly BuildingVolume[]) {
  const out = new Map<string, { invented: boolean; key: string }>();
  for (const v of volumes) {
    if (v.parentFeature !== undefined) continue;
    out.set(v.feature, {
      invented: v.roofIsInvented,
      key: [
        v.roofIsInvented,
        v.heights.roofShape,
        v.mesh.positions.length,
      ].join("|"),
    });
  }
  return out;
}

/** The invented buildings whose decision differs between the two builds. */
function changed(
  a: ReturnType<typeof decisions>,
  b: ReturnType<typeof decisions>,
): string[] {
  const none = { invented: false, key: "missing" };
  return [...new Set([...a.keys(), ...b.keys()])].flatMap((key) => {
    const x = a.get(key) ?? none;
    const y = b.get(key) ?? none;
    const compared = x.invented || y.invented;
    return compared && x.key !== y.key ? [`${key}: ${x.key} -> ${y.key}`] : [];
  });
}

/** Eave and total height of every building, by key. */
function heights(volumes: readonly BuildingVolume[]) {
  return new Map(
    volumes.map((v) => [
      v.feature,
      [v.heights.eaveHeightM, v.heights.totalHeightM],
    ]),
  );
}

describe.each(SITES)("invented roofs in any frame at %s", (id) => {
  const site = loadSite(id);
  const features = parseOverpassJson(site.payload).features;
  const at = (shift: { lat: number; lng: number }) =>
    buildBuildings(features, {
      frame: enuFrameAt({
        lat: site.centre.lat + shift.lat,
        lng: site.centre.lng + shift.lng,
      }),
      inventedRoofs: true,
    });
  const base = at({ lat: 0, lng: 0 });

  it.each(SHIFTS)("decides the same with the origin moved by %o", (shift) => {
    const moved = at(shift);
    expect(changed(decisions(base), decisions(moved))).toEqual([]);
    const before = heights(base);
    for (const [key, [eave, total]] of heights(moved)) {
      const [eave0, total0] = before.get(key) ?? [NaN, NaN];
      expect(Math.abs((eave as number) - (eave0 as number)), key).toBeLessThan(
        0.01,
      );
      expect(
        Math.abs((total as number) - (total0 as number)),
        key,
      ).toBeLessThan(0.01);
    }
  });
});
