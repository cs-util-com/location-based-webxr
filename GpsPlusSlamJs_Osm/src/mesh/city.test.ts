import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { buildCity, cityGround } from "./city.js";
import { enuFrameAt } from "./enu.js";
import { buildingColour } from "./feature-colours.js";

/**
 * `buildCity` is the city a renderer draws: buildings (with their parts and
 * the barriers drawn among them), coloured per feature, chunked, and trees.
 * It was assembled inline in OsmDemo's worker until the globe became the
 * library's second consumer (globe city plan 2026-10-05-0040 §14 L3), so
 * these tests pin what both apps now share.
 */
const ORIGIN = { lat: 50.9413, lng: 6.9583 };
const frame = enuFrameAt(ORIGIN);

function outline(colour: string): OsmFeature {
  return {
    type: "way",
    id: 1,
    tags: { building: "cathedral", "building:colour": colour },
    geometry: [
      { lat: 50.9413, lng: 6.9583 },
      { lat: 50.9413, lng: 6.9593 },
      { lat: 50.9418, lng: 6.9593 },
      { lat: 50.9418, lng: 6.9583 },
      { lat: 50.9413, lng: 6.9583 },
    ],
  };
}

function tower(tags: Record<string, string> = {}): OsmFeature {
  return {
    type: "way",
    id: 2,
    tags: { "building:part": "yes", height: "157", ...tags },
    geometry: [
      { lat: 50.94145, lng: 6.95845 },
      { lat: 50.94145, lng: 6.95865 },
      { lat: 50.94165, lng: 6.95865 },
      { lat: 50.94165, lng: 6.95845 },
      { lat: 50.94145, lng: 6.95845 },
    ],
  };
}

const WALL: OsmFeature = {
  type: "way",
  id: 3,
  tags: { barrier: "wall", height: "3" },
  geometry: [
    { lat: 50.9411, lng: 6.9581 },
    { lat: 50.9411, lng: 6.9586 },
  ],
};

const TREE: OsmFeature = {
  type: "node",
  id: 4,
  tags: { natural: "tree" },
  position: { lat: 50.9409, lng: 6.959 },
};

const colours = (city: ReturnType<typeof buildCity>) =>
  [...city.buildings.flatMap((c) => [...(c.colors ?? [])])].slice(0, 3);

/** A packed 0xrrggbb as the chunk stores it: 0-1 per channel. */
const unpacked = (c: number) =>
  [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff].map((v) =>
    Math.fround(v / 255),
  );

describe("buildCity", () => {
  it("builds the volumes, the barriers among them and the trees", () => {
    const city = buildCity([outline("#cc2200"), tower(), WALL, TREE], {
      frame,
    });
    // The outline with a part is drawn through its part only.
    expect(city.volumes.map((v) => v.feature)).toEqual(["way/2"]);
    expect(city.barriers).toHaveLength(1);
    expect(city.trees).toHaveLength(1);
    expect(city.buildings.length).toBeGreaterThan(0);
  });

  // WHY: a `building:part` takes its PARENT's colour (the parts of one
  // building are one building; colouring them separately stripes a cathedral
  // by whichever part carried a tag). OsmDemo's worker did this inline.
  it("colours a part by its parent", () => {
    const underRed = colours(
      buildCity([outline("#cc2200"), tower()], { frame }),
    );
    const underBlue = colours(
      buildCity([outline("#0044cc"), tower()], { frame }),
    );
    // Exactly the parent's colour (its type counts too, not only its tag).
    expect(underRed).toEqual(unpacked(buildingColour(outline("#cc2200").tags)));
    expect(underRed).not.toEqual(underBlue);
  });

  it("stands on the ground it is given", () => {
    const city = buildCity([outline("#cc2200"), tower()], {
      frame,
      groundHeightM: () => 500,
    });
    let minY = Infinity;
    for (const chunk of city.buildings) {
      const p = chunk.mesh.positions;
      for (let i = 1; i < p.length; i += 3) minY = Math.min(minY, p[i]!);
    }
    expect(minY).toBeCloseTo(500, 3);
  });

  // WHY: the AR shell shader's phase per feature must not re-shuffle on a
  // rebuild, or the city visibly re-randomises whenever a tile loads.
  it("gives each feature a stable shell phase in [0, 1)", () => {
    const a = buildCity([outline("#cc2200"), tower(), WALL], { frame });
    const b = buildCity([outline("#cc2200"), tower(), WALL], { frame });
    const ra = a.buildings.flatMap((c) => [...(c.featureRand ?? [])]);
    const rb = b.buildings.flatMap((c) => [...(c.featureRand ?? [])]);
    expect(ra.length).toBeGreaterThan(0);
    expect(ra).toEqual(rb);
    for (const r of ra) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });

  it("builds nothing from nothing", () => {
    const city = buildCity([], { frame });
    expect(city.volumes).toEqual([]);
    expect(city.buildings).toEqual([]);
    expect(city.trees).toEqual([]);
  });
});

describe("cityGround", () => {
  it("is flat (no sampler) without a field", () => {
    const ground = cityGround(frame, undefined);
    expect(ground.frame).toBe(frame);
    expect(ground.groundHeightM).toBeUndefined();
  });

  // WHY: the ground sampler is the field read at the frame's ENU position of
  // a lat/lng; deriving it twice is how two layers ended up on two surfaces.
  it("reads the field at the position's ENU metres", () => {
    const seen: { x: number; y: number }[] = [];
    const ground = cityGround(frame, {
      heightAt: (p) => {
        seen.push(p);
        return 42;
      },
    });
    const there = { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng };
    expect(ground.groundHeightM?.(there)).toBe(42);
    expect(seen[0]?.y).toBeCloseTo(frame.toEnu(there).y, 9);
  });
});

// WHY (globe city plan 2026-10-05-0040 §12.4 R12): a city's heights are
// sampled in a window around its origin (2.4 km in each direction), and
// outside it the field clamps the edge heights outward, so a building there
// stands on made-up ground. OsmDemo hides it with its far plane; the globe
// sees it from 30 km. `withinM` keeps only what stands inside the window.
describe("buildCity within a window", () => {
  const near = outline("#cc2200");
  // About 3.3 km north of the origin.
  const far: OsmFeature = {
    type: "way",
    id: 9,
    tags: { building: "house" },
    geometry: [
      { lat: 50.9713, lng: 6.9583 },
      { lat: 50.9713, lng: 6.9585 },
      { lat: 50.9715, lng: 6.9585 },
      { lat: 50.9715, lng: 6.9583 },
      { lat: 50.9713, lng: 6.9583 },
    ],
  };
  const farTree: OsmFeature = {
    type: "node",
    id: 8,
    tags: { natural: "tree" },
    position: { lat: 50.9713, lng: 6.959 },
  };

  it("drops volumes and trees whose position lies outside the window", () => {
    const city = buildCity(
      [near, far, TREE, farTree],
      { frame },
      { withinM: 2400 },
    );
    expect(city.volumes.map((v) => v.feature)).toEqual(["way/1"]);
    expect(city.trees.map((t) => t.feature)).toEqual(["node/4"]);
  });

  it("keeps everything without a window", () => {
    const city = buildCity([near, far, TREE, farTree], { frame });
    expect(city.volumes).toHaveLength(2);
    expect(city.trees).toHaveLength(2);
  });

  it("refuses a window that is not a positive number", () => {
    for (const withinM of [0, -1, Number.NaN]) {
      expect(() => buildCity([near], { frame }, { withinM })).toThrow(
        RangeError,
      );
    }
  });
});
