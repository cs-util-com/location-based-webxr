import { describe, expect, it } from "vitest";

import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import type { Bbox } from "../spatial/clip.js";
import { enuFrameAt } from "./enu.js";
import { stableRotationY } from "./stable-jitter.js";
import {
  FURNITURE_DEFAULT_HEIGHT_M,
  FURNITURE_KINDS,
  MAX_FURNITURE_HEIGHT_M,
  buildStreetFurniture,
  compassYawRad,
  furnitureModelOf,
  furnitureWithinCut,
} from "./street-furniture.js";

/**
 * WHY THESE TESTS MATTER. Street furniture is drawn from mapped nodes only,
 * so every rule here is about what the map says and what is guessed: which
 * tags make which model, which height wins, which way a lamp faces, and the
 * honest list of what was invented (`guessed`). A wrong rule draws a 5 m mast
 * where a wall lamp hangs, or a bench rotated by a mis-read compass, and both
 * read as a broken map rather than as a missing feature.
 */
const ORIGIN = { lat: 49.41, lng: 8.69 };
const frame = enuFrameAt(ORIGIN);
const at = (x: number, y: number): LatLng => frame.toLatLng({ x, y });
const WIDE: Bbox = { south: 49.3, west: 8.6, north: 49.5, east: 8.8 };

let nextId = 1;
function node(
  tags: Record<string, string>,
  x = 0,
  y = 0,
  id = nextId++,
): OsmFeature {
  return { type: "node", id, position: at(x, y), tags };
}

const build = (
  features: OsmFeature[],
  extra: Partial<Parameters<typeof buildStreetFurniture>[1]> = {},
) => buildStreetFurniture(features, { frame, window: WIDE, ...extra });

describe("furnitureModelOf", () => {
  // The tag-to-model table is the whole classification; a lamp's mount picks
  // a different model, and the first matching kind wins in a fixed order.
  it("maps the four kinds and the three lamp mounts", () => {
    expect(furnitureModelOf({ highway: "street_lamp" })).toBe("lamp");
    expect(
      furnitureModelOf({ highway: "street_lamp", lamp_mount: "wall" }),
    ).toBe("lamp-wall");
    expect(
      furnitureModelOf({ highway: "street_lamp", lamp_mount: "suspended" }),
    ).toBe("lamp-suspended");
    expect(
      furnitureModelOf({ highway: "street_lamp", lamp_mount: "straight mast" }),
    ).toBe("lamp");
    expect(furnitureModelOf({ barrier: "bollard" })).toBe("bollard");
    expect(furnitureModelOf({ amenity: "bench" })).toBe("bench");
    expect(furnitureModelOf({ amenity: "waste_basket" })).toBe("bin");
    expect(furnitureModelOf({ amenity: "cafe" })).toBeUndefined();
    expect(furnitureModelOf({})).toBeUndefined();
  });

  it("prefers the lamp when a node carries two kinds", () => {
    expect(
      furnitureModelOf({ highway: "street_lamp", barrier: "bollard" }),
    ).toBe("lamp");
  });
});

describe("compassYawRad", () => {
  // OSM `direction` is compass degrees clockwise from north; a rotation about
  // +y is anticlockwise seen from above, hence the sign. Anything that is not
  // a plain number of degrees (cardinal letters, ranges, empty) is refused,
  // so the item takes a seeded yaw and lists it as guessed.
  it("turns compass degrees into an anticlockwise yaw", () => {
    expect(compassYawRad("0")).toBeCloseTo(0);
    expect(compassYawRad("90")).toBeCloseTo(-Math.PI / 2);
    expect(compassYawRad(" 180.5 ")).toBeCloseTo((-180.5 * Math.PI) / 180);
    expect(compassYawRad("-45")).toBeCloseTo(Math.PI / 4);
  });

  it("refuses everything else", () => {
    for (const junk of [
      undefined,
      "",
      " ",
      "N",
      "90-270",
      "forward",
      "1e3",
      "NaN",
      "Infinity",
      "90;180",
    ]) {
      expect(compassYawRad(junk)).toBeUndefined();
    }
  });
});

describe("buildStreetFurniture", () => {
  // Only nodes are furniture: a way tagged as a bench (a long bench mapped as
  // a line) or a bollard row is not invented into point objects here.
  it("takes nodes only, never ways or relations", () => {
    const way: OsmFeature = {
      type: "way",
      id: nextId++,
      tags: { amenity: "bench" },
      geometry: [at(0, 0), at(3, 0)],
    };
    const bollards: OsmFeature = {
      type: "way",
      id: nextId++,
      tags: { barrier: "bollard" },
      geometry: [at(0, 5), at(9, 5)],
    };
    expect(build([way, bollards])).toEqual([]);
    expect(build([node({ amenity: "bench" })])).toHaveLength(1);
  });

  it("uses the default height per model and lists it as guessed", () => {
    const items = build([
      node({ highway: "street_lamp" }),
      node({ highway: "street_lamp", lamp_mount: "wall" }),
      node({ highway: "street_lamp", lamp_mount: "suspended" }),
      node({ barrier: "bollard" }),
    ]);
    expect(items.map((i) => i.heightM)).toEqual([5, 4, 6, 0.9]);
    expect(FURNITURE_DEFAULT_HEIGHT_M).toEqual({
      lamp: 5,
      "lamp-wall": 4,
      "lamp-suspended": 6,
      bollard: 0.9,
    });
    for (const item of items) expect(item.guessed).toContain("height");
  });

  it("lets a tagged height win, and refuses an implausible one", () => {
    const [tall, metres, typo, zero, junk] = build([
      node({ highway: "street_lamp", height: "7" }),
      node({ barrier: "bollard", height: "1.2 m" }),
      node({
        highway: "street_lamp",
        height: String(MAX_FURNITURE_HEIGHT_M + 1),
      }),
      node({ barrier: "bollard", height: "0" }),
      node({ barrier: "bollard", height: "tall" }),
    ]);
    expect(tall?.heightM).toBe(7);
    expect(tall?.guessed).not.toContain("height");
    expect(metres?.heightM).toBe(1.2);
    expect(typo?.heightM).toBe(5);
    expect(typo?.guessed).toContain("height");
    expect(zero?.heightM).toBe(0.9);
    expect(junk?.heightM).toBe(0.9);
  });

  // Benches and bins draw their library model at its own size, so no height
  // is invented for them and none is listed as guessed.
  it("leaves benches and bins at their model's own size", () => {
    const [bench, bin] = build([
      node({ amenity: "bench" }),
      node({ amenity: "waste_basket", height: "3" }),
    ]);
    expect(bench).not.toHaveProperty("heightM");
    expect(bin).not.toHaveProperty("heightM");
    expect(bench?.guessed).toEqual(["yaw"]);
  });

  it("faces a mapped direction, and seeds the yaw from the key otherwise", () => {
    const facing = node({ amenity: "bench", direction: "90" }, 0, 0, 77);
    const free = node({ amenity: "bench" }, 0, 0, 78);
    const [a, b] = build([facing, free]);
    expect(a?.yawRad).toBeCloseTo(-Math.PI / 2);
    expect(a?.guessed).toEqual([]);
    // The same yaw a POI marker of the same node takes (one helper), so a
    // bench drawn by either layer faces the same way.
    expect(b?.yawRad).toBe(stableRotationY("node/78"));
    expect(b?.guessed).toEqual(["yaw"]);
    expect(build([free])[0]?.yawRad).toBe(b?.yawRad);
  });

  it("places each item in the frame on its ground", () => {
    const [item] = build([node({ barrier: "bollard" }, 12, -7, 900)], {
      groundHeightM: () => 3.5,
    });
    expect(item?.key).toBe("node/900");
    expect(item?.kind).toBe("bollard");
    expect(item?.model).toBe("bollard");
    expect(item?.position.x).toBeCloseTo(12, 6);
    expect(item?.position.y).toBeCloseTo(-7, 6);
    expect(item?.groundHeightM).toBe(3.5);
    expect(build([node({ barrier: "bollard" })])[0]?.groundHeightM).toBe(0);
  });

  // A ground sampler that answers NaN or Infinity (no elevation tile yet, a
  // hole in the data) must not send a lamp to NaN height, where it vanishes:
  // it stands on 0, as the markings and pedestrian areas do.
  it("stands an item on 0 when the ground answers a non-number", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const [item] = build([node({ barrier: "bollard" })], {
        groundHeightM: () => bad,
      });
      expect(item?.groundHeightM).toBe(0);
    }
  });

  it("builds only the kinds asked for, in input order", () => {
    const features = [
      node({ amenity: "bench" }),
      node({ highway: "street_lamp", lamp_mount: "wall" }),
      node({ amenity: "waste_basket" }),
      node({ barrier: "bollard" }),
    ];
    expect(build(features).map((i) => i.kind)).toEqual([
      "bench",
      "lamp",
      "bin",
      "bollard",
    ]);
    expect(
      build(features, { kinds: ["lamp", "bollard"] }).map((i) => i.model),
    ).toEqual(["lamp-wall", "bollard"]);
    expect(build(features, { kinds: [] })).toEqual([]);
    expect(FURNITURE_KINDS).toEqual(["lamp", "bollard", "bench", "bin"]);
  });

  it("places nothing outside the window", () => {
    const window: Bbox = {
      south: at(0, -10).lat,
      west: at(-10, 0).lng,
      north: at(0, 10).lat,
      east: at(10, 0).lng,
    };
    const items = build(
      [node({ amenity: "bench" }, 5, 5), node({ amenity: "bench" }, 20, 0)],
      { window },
    );
    expect(items).toHaveLength(1);
  });

  it("refuses a missing window and an unknown kind", () => {
    expect(() =>
      buildStreetFurniture([], {
        frame,
        window: undefined as unknown as Bbox,
      }),
    ).toThrow(RangeError);
    expect(() => build([], { kinds: ["lamp", "tree" as never] })).toThrow(
      RangeError,
    );
  });
});

describe("furnitureWithinCut", () => {
  // The cut is a plan distance from the eye, inclusive, and Infinity keeps
  // everything: the renderer packs exactly these indices.
  const items = [
    { position: { x: 0, y: 0 } },
    { position: { x: 30, y: 40 } },
    { position: { x: 80, y: 1 } },
  ];

  it("keeps the items within the cut, in order", () => {
    expect(furnitureWithinCut(items, { x: 0, y: 0 }, 50)).toEqual([0, 1]);
    expect(furnitureWithinCut(items, { x: 80, y: 0 }, 1)).toEqual([2]);
    expect(furnitureWithinCut(items, { x: 0, y: 0 }, Infinity)).toEqual([
      0, 1, 2,
    ]);
  });

  it("refuses a cut that is not positive", () => {
    expect(() => furnitureWithinCut(items, { x: 0, y: 0 }, 0)).toThrow(
      RangeError,
    );
    expect(() => furnitureWithinCut(items, { x: 0, y: 0 }, Number.NaN)).toThrow(
      RangeError,
    );
  });
});
