/**
 * Per-instance POI variation: seeded yaw and scale (§4a, DEC-R6-18/R6-20).
 *
 * WHY THESE TESTS MATTER. Before this, every POI marker in the city was placed
 * by translation alone — so every bench faced exactly the same direction, every
 * hunting stand pointed the same way, and a street of markers read as a row of
 * clones. That is a louder repetition cue than any difference between two
 * models of the same kind, which is why it is fixed before the models are
 * rebuilt (DEC-R6-20).
 *
 * The whole risk is in the word DETERMINISTIC, and it has a specific failure:
 * the demo republishes the working set on every move, so a yaw drawn from
 * `Math.random()` would make a bench visibly rotate as the user walks past it.
 * These tests pin that the yaw is a pure function of the feature key, which is
 * the only thing that makes it stable across republishes, sessions and devices.
 *
 * The second thing pinned is that rotation is NOT universal. A car park or a
 * pitch is a ground marking whose orientation reads as meaningful, so a
 * randomly-spun one looks like a bug rather than like variety.
 */

import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { enuFrameAt } from "./enu.js";
import { buildPoiMarkers } from "./poi.js";
import { GROUND_ALIGNED_KINDS, POI_MODELS } from "./poi-models.js";
import { POI_SCALE_JITTER, unit } from "./stable-jitter.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const FRAME = enuFrameAt(COLOGNE);

function node(tags: Record<string, string>, id: number): OsmFeature {
  return {
    type: "node",
    id,
    position: COLOGNE,
    tags,
  } as unknown as OsmFeature;
}

describe("POI per-instance jitter", () => {
  it("gives the same feature the same yaw on every build", () => {
    // THE failure this exists to prevent: the demo rebuilds the working set on
    // every position change, so a non-deterministic yaw is a marker that spins
    // as the user walks. Two independent builds must agree exactly.
    const features = [node({ amenity: "bench" }, 1)];
    const first = buildPoiMarkers(features, { frame: FRAME });
    const second = buildPoiMarkers([node({ amenity: "bench" }, 1)], {
      frame: FRAME,
    });
    expect(first[0]?.rotationY).toBe(second[0]?.rotationY);
    expect(first[0]?.scale).toBe(second[0]?.scale);
  });

  it("gives different features different yaws", () => {
    // Determinism is worthless if it is constant: a stable yaw that is the same
    // for every marker is exactly the row of clones this replaces.
    const markers = buildPoiMarkers(
      [1, 2, 3, 4, 5, 6].map((id) => node({ amenity: "bench" }, id)),
      { frame: FRAME },
    );
    const yaws = new Set(markers.map((m) => m.rotationY));
    expect(markers).toHaveLength(6);
    expect(yaws.size).toBe(6);
  });

  it("spreads yaw over the whole circle rather than a sector", () => {
    // A hash that only ever lands in one quadrant would pass the two tests
    // above and still leave the street looking aligned. Four quadrants, each
    // occupied, over a corpus large enough that emptiness means bias.
    const markers = buildPoiMarkers(
      Array.from({ length: 200 }, (_, i) => node({ amenity: "bench" }, i + 1)),
      { frame: FRAME },
    );
    const quadrants = new Set(
      markers.map((m) => Math.floor((m.rotationY / (Math.PI / 2)) % 4)),
    );
    expect(quadrants.size).toBe(4);
    for (const marker of markers) {
      expect(marker.rotationY).toBeGreaterThanOrEqual(0);
      expect(marker.rotationY).toBeLessThan(Math.PI * 2);
    }
  });

  it("keeps ground-aligned kinds unrotated", () => {
    // A car park, a parking space or a pitch is a ground marking: its
    // orientation reads as meaningful, so a random spin reads as a defect
    // rather than as variety. These opt out by kind, not by instance.
    for (const kind of GROUND_ALIGNED_KINDS) {
      const [key, value] = kind.split("=") as [string, string];
      const markers = buildPoiMarkers([node({ [key]: value }, 7)], {
        frame: FRAME,
      });
      expect(markers).toHaveLength(1);
      expect(markers[0]?.kind).toBe(kind);
      expect(markers[0]?.rotationY).toBe(0);
    }
  });

  it("scales within a band tight enough to keep real-world dimensions", () => {
    // DEC-R6-8 keeps POI models at real-world scale, and a marker at its true
    // size is a check on the extruder. The jitter must therefore stay inside
    // tagging noise — a bench that is 30 % long stops being evidence.
    const markers = buildPoiMarkers(
      Array.from({ length: 100 }, (_, i) => node({ amenity: "bench" }, i + 1)),
      { frame: FRAME },
    );
    for (const marker of markers) {
      expect(marker.scale).toBeGreaterThanOrEqual(1 - POI_SCALE_JITTER);
      expect(marker.scale).toBeLessThanOrEqual(1 + POI_SCALE_JITTER);
    }
    expect(POI_SCALE_JITTER).toBeLessThanOrEqual(0.1);
    expect(new Set(markers.map((m) => m.scale)).size).toBeGreaterThan(50);
  });

  it("derives yaw from the feature key, not from input order", () => {
    // Order-dependence would reintroduce the republish problem by the back
    // door: the same bench would rotate whenever a neighbour appeared or left
    // the working set.
    const a = buildPoiMarkers(
      [node({ amenity: "bench" }, 1), node({ amenity: "bench" }, 2)],
      { frame: FRAME },
    );
    const b = buildPoiMarkers(
      [node({ amenity: "bench" }, 2), node({ amenity: "bench" }, 1)],
      { frame: FRAME },
    );
    const byKey = new Map(b.map((m) => [m.feature, m.rotationY]));
    for (const marker of a) {
      expect(byKey.get(marker.feature)).toBe(marker.rotationY);
    }
  });

  it("uses the same hash the trees already use", () => {
    // `trees.ts` has done exactly this since W6 (`unit(key, "r")`). Sharing the
    // function rather than writing a second one is what stops two hashes
    // drifting apart, and it is why §4a is a refactor rather than a feature.
    const markers = buildPoiMarkers([node({ amenity: "bench" }, 42)], {
      frame: FRAME,
    });
    const key = markers[0]?.feature ?? "";
    expect(markers[0]?.rotationY).toBeCloseTo(unit(key, "r") * Math.PI * 2, 12);
  });

  it("names only kinds that actually have a model as ground-aligned", () => {
    // A typo in the opt-out list is silent: the kind keeps rotating and nobody
    // finds out until a car park is seen spinning. This makes the typo fail.
    for (const kind of GROUND_ALIGNED_KINDS) {
      expect(POI_MODELS.has(kind)).toBe(true);
    }
  });
});
