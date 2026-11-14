import { describe, expect, it } from "vitest";

import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import {
  buildBuildings,
  inventedRoofTotals,
  type BuildingVolume,
} from "../../mesh/buildings.js";
import { enuFrameAt } from "../../mesh/enu.js";
import {
  featureKey,
  type LatLng,
  type OsmFeature,
} from "../../model/osm-feature.js";
import { bboxesIntersect, boundsOf, type Bbox } from "../../spatial/clip.js";

/**
 * Invented roofs while a city loads in stages: a building planned from the
 * first rings (part of its neighbourhood missing) against the same building
 * planned from all of it, on all 12 sites, with the staged box at 0.3, 0.5
 * and 0.7 of the buildings' extent.
 *
 * WHY THIS FILE MATTERS. The prior and the shared walls read neighbours, so
 * a staged delivery can plan a building differently from the full one. The
 * owner accepted that as TRANSIENT: a flip is allowed while loading, never
 * after. So this file pins (1) how many flips there are, as shape (roof or
 * flat, which shape) and height only, so a planner change that makes loading
 * jumpier shows here as a number; and (2) that they are transient: the full
 * delivery plans every building exactly as a one-shot build of all the data,
 * whatever was delivered before (no plan is carried between deliveries).
 */

function pointsOf(f: OsmFeature): LatLng[] {
  if (f.type === "node") return [f.position];
  if (f.type === "way") return [...f.geometry];
  return f.members.flatMap((m) => [
    ...(m.geometry ?? []),
    ...(m.position === undefined ? [] : [m.position]),
  ]);
}

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

function shrink(b: Bbox, f: number): Bbox {
  const cy = (b.south + b.north) / 2;
  const cx = (b.west + b.east) / 2;
  const hy = ((b.north - b.south) / 2) * f;
  const hx = ((b.east - b.west) / 2) * f;
  return { south: cy - hy, north: cy + hy, west: cx - hx, east: cx + hx };
}

function inside(inner: Bbox, b: Bbox): boolean {
  return (
    b.south >= inner.south &&
    b.north <= inner.north &&
    b.west >= inner.west &&
    b.east <= inner.east
  );
}

interface Seen {
  shape: string;
  total: number;
  invented: boolean;
}

function seen(volumes: readonly BuildingVolume[]): Map<string, Seen> {
  const out = new Map<string, Seen>();
  for (const v of volumes) {
    if (v.parentFeature !== undefined) continue;
    const prev = out.get(v.feature);
    const shape = `${v.roofIsInvented}|${v.heights.roofShape}`;
    out.set(v.feature, {
      shape: prev === undefined ? shape : `${prev.shape};${shape}`,
      total: Math.max(prev?.total ?? 0, v.heights.totalHeightM),
      invented: (prev?.invented ?? false) || v.roofIsInvented,
    });
  }
  return out;
}

/** The box of every building's bounds. */
function buildingsBox(
  features: readonly OsmFeature[],
  boundsBy: ReadonlyMap<OsmFeature, Bbox | undefined>,
): Bbox | undefined {
  return boundsOf(
    features
      .filter((f) => f.tags["building"] !== undefined)
      .flatMap((f) => {
        const b = boundsBy.get(f);
        return b === undefined
          ? []
          : [
              { lat: b.south, lng: b.west },
              { lat: b.north, lng: b.east },
            ];
      }),
  );
}

interface Flips {
  candidates: number;
  shape: number;
  height1cm: number;
  height50cm: number;
}

/** Adds one planned building, full against staged, to the counts. */
function countFlip(
  flips: Flips,
  a: Seen | undefined,
  c: Seen | undefined,
): void {
  if (a === undefined || c === undefined) return;
  flips.candidates += 1;
  if (a.shape !== c.shape) {
    flips.shape += 1;
    return;
  }
  const d = Math.abs(a.total - c.total);
  if (d > 0.01) flips.height1cm += 1;
  if (d > 0.5) flips.height50cm += 1;
}

function stagedFlips(fraction: number): {
  flips: Flips;
  transient: boolean;
} {
  const flips: Flips = { candidates: 0, shape: 0, height1cm: 0, height50cm: 0 };
  let transient = true;
  for (const id of SITES) {
    const site = loadSite(id);
    const features = parseOverpassJson(site.payload).features;
    const frame = enuFrameAt(site.centre);
    const boundsBy = new Map(features.map((f) => [f, boundsOf(pointsOf(f))]));
    const all = buildingsBox(features, boundsBy);
    if (all === undefined) continue;
    const full = seen(buildBuildings(features, { frame, inventedRoofs: true }));
    const fullPlanned = inventedRoofTotals(features, frame);
    const inner = shrink(all, fraction);
    const subset = features.filter((x) => {
      const b = boundsBy.get(x);
      return b !== undefined && bboxesIntersect(b, inner);
    });
    const part = seen(buildBuildings(subset, { frame, inventedRoofs: true }));
    const partPlanned = inventedRoofTotals(subset, frame);
    for (const x of subset) {
      const b = boundsBy.get(x);
      if (b === undefined || !inside(inner, b)) continue;
      const key = featureKey(x);
      if (!fullPlanned.has(key) && !partPlanned.has(key)) continue;
      countFlip(flips, full.get(key), part.get(key));
    }
    // The full delivery after the staged one: the same as a one-shot build.
    const again = seen(
      buildBuildings(features, { frame, inventedRoofs: true }),
    );
    if (JSON.stringify([...again]) !== JSON.stringify([...full])) {
      transient = false;
    }
  }
  return { flips, transient };
}

describe("invented roofs while a city loads in stages", () => {
  it.each([
    [0.3, { candidates: 147, shape: 0, height1cm: 2, height50cm: 2 }],
    [0.5, { candidates: 503, shape: 13, height1cm: 5, height50cm: 4 }],
    [0.7, { candidates: 1122, shape: 22, height1cm: 28, height50cm: 10 }],
  ] as const)(
    "staged box %f: flips pinned, and none survives the full delivery",
    (fraction, expected) => {
      const { flips, transient } = stagedFlips(fraction);
      expect(flips).toEqual(expected);
      expect(transient).toBe(true);
    },
  );
});
