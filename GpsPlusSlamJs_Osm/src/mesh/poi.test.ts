/**
 * POI marker placement (W12).
 *
 * WHY THESE TESTS MATTER. The demo's whole reason for existing is "click a thing
 * and it tells you what it is", and a POI is the first feature that is a POINT
 * rather than a surface — so it is the first one whose identity has to survive
 * all the way from the tag to the details panel. A marker that renders but
 * carries the wrong id opens the panel on a confidently wrong feature, which is
 * worse than not being clickable at all.
 *
 * The other half is the one every builder in this package has had to get right
 * and two have got wrong first: **two builders must never draw the same
 * feature.** `natural=tree` belongs to `trees.ts` and areas belong to
 * `plates.ts` / W14, so the selection here has to exclude them by construction
 * rather than by hoping the tag sets do not overlap.
 */

import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { enuFrameAt } from "./enu.js";
import { buildPoiMarkers, isPoiNode, poiKind } from "./poi.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const FRAME = enuFrameAt(COLOGNE);

/** A node at the frame origin unless moved, with the given tags. */
function node(
  tags: Record<string, string>,
  position: { lat: number; lng: number } = COLOGNE,
  id = 1,
): OsmFeature {
  return {
    type: "node",
    id,
    tags,
    position,
  } as unknown as OsmFeature;
}

function way(tags: Record<string, string>): OsmFeature {
  return {
    type: "way",
    id: 99,
    tags,
    geometry: [
      { lat: 50.9413, lng: 6.9583 },
      { lat: 50.9414, lng: 6.9583 },
      { lat: 50.9414, lng: 6.9584 },
      { lat: 50.9413, lng: 6.9583 },
    ],
  } as unknown as OsmFeature;
}

describe("isPoiNode", () => {
  it("accepts a node carrying a recognised primary key", () => {
    expect(isPoiNode(node({ amenity: "bench" }))).toBe(true);
    expect(isPoiNode(node({ shop: "bakery" }))).toBe(true);
    expect(isPoiNode(node({ tourism: "artwork" }))).toBe(true);
  });

  it("rejects a node with no recognised key", () => {
    // Not everything tagged is a place. A bare `barrier=gate` or a routing node
    // is not something a user clicks to ask "what is this?", and marking every
    // tagged node would bury the ones that are.
    expect(isPoiNode(node({ barrier: "gate" }))).toBe(false);
    expect(isPoiNode(node({}))).toBe(false);
  });

  it("rejects a TREE, because `trees.ts` already draws it", () => {
    // The rule that stops two builders drawing the same feature, stated as an
    // assertion rather than as a hope that the tag sets do not overlap. A tree
    // drawn twice is a cone with a marker inside it, and the marker wins the
    // pick — so the user clicks a tree and is told about a tree-shaped POI.
    expect(isPoiNode(node({ natural: "tree" }))).toBe(false);
  });

  it("rejects a WAY carrying a POI tag, because that is an area", () => {
    // `amenity=parking` is overwhelmingly a way, and it is a ground plate
    // (W11) or an area slab (W14) — not a point marker. Selecting on the tag
    // alone would put a marker in the middle of every car park in the tile.
    expect(isPoiNode(way({ amenity: "parking" }))).toBe(false);
  });
});

describe("poiKind", () => {
  it("names the primary tag as key=value", () => {
    expect(poiKind({ amenity: "cafe" })).toBe("amenity=cafe");
  });

  it("picks DETERMINISTICALLY when several primary keys are present", () => {
    // A node can be `amenity=cafe` + `tourism=information`, and object key order
    // is insertion order — so choosing "the first key found" makes the answer
    // depend on how the JSON happened to be written. The order is fixed by the
    // key list instead, so the same node always reports the same kind.
    const both = { tourism: "information", amenity: "cafe" };
    const reversed = { amenity: "cafe", tourism: "information" };
    expect(poiKind(both)).toBe(poiKind(reversed));
    expect(poiKind(both)).toBe("amenity=cafe");
  });

  it("returns undefined when nothing primary is present", () => {
    expect(poiKind({ barrier: "gate" })).toBeUndefined();
  });
});

describe("buildPoiMarkers", () => {
  it("places a marker per qualifying node, in ENU metres", () => {
    // 0.001 degrees of latitude is ~111 m north; the sign matters because ENU
    // north is +y and the render frame flips it, and getting that wrong puts the
    // marker on the far side of the origin from the thing it labels.
    const north = { lat: COLOGNE.lat + 0.001, lng: COLOGNE.lng };
    const markers = buildPoiMarkers([node({ amenity: "cafe" }, north)], {
      frame: FRAME,
    });

    expect(markers).toHaveLength(1);
    expect(markers[0]?.position.y).toBeGreaterThan(100);
    expect(markers[0]?.position.y).toBeLessThan(120);
    expect(Math.abs(markers[0]?.position.x ?? 99)).toBeLessThan(1);
  });

  it("carries the feature key, so a pick can name what was clicked", () => {
    // The identity that reaches the details panel. Without it a marker is a
    // dot the app cannot say anything about, which is the entire feature.
    const markers = buildPoiMarkers(
      [node({ amenity: "cafe" }, COLOGNE, 4242)],
      {
        frame: FRAME,
      },
    );
    expect(markers[0]?.feature).toContain("4242");
  });

  it("prefers the name tag for the label, and falls back to the kind", () => {
    const named = buildPoiMarkers(
      [node({ amenity: "cafe", name: "Café Schmitz" })],
      { frame: FRAME },
    );
    expect(named[0]?.label).toBe("Café Schmitz");

    const unnamed = buildPoiMarkers([node({ amenity: "cafe" })], {
      frame: FRAME,
    });
    // The VALUE, not the whole `key=value` — a marker labelled "amenity=cafe"
    // reads as debug output rather than as a place.
    expect(unnamed[0]?.label).toBe("cafe");
  });

  it("samples the ground under each marker", () => {
    // Same reason as trees and plates: a marker at y=0 is underground wherever
    // the terrain is above the datum, and Cologne's datum is ~53 m.
    const markers = buildPoiMarkers([node({ amenity: "cafe" })], {
      frame: FRAME,
      groundHeightM: () => 53.5,
    });
    expect(markers[0]?.groundHeightM).toBeCloseTo(53.5, 6);
  });

  it("defaults the ground to 0 when no sampler is given", () => {
    // Not NaN: an unsampled marker must still be placeable, and NaN propagates
    // into the transform and removes the object from the scene silently.
    const markers = buildPoiMarkers([node({ amenity: "cafe" })], {
      frame: FRAME,
    });
    expect(markers[0]?.groundHeightM).toBe(0);
  });

  it("skips everything that is not a qualifying node", () => {
    const markers = buildPoiMarkers(
      [
        node({ natural: "tree" }),
        way({ amenity: "parking" }),
        node({ barrier: "gate" }),
      ],
      { frame: FRAME },
    );
    expect(markers).toEqual([]);
  });

  it("is deterministic in order, so two runs agree", () => {
    // The demo compares runs across positions and devices; a marker list whose
    // order depends on iteration accidents makes any such comparison useless.
    const features = [
      node({ amenity: "cafe" }, COLOGNE, 1),
      node({ shop: "bakery" }, COLOGNE, 2),
      node({ tourism: "artwork" }, COLOGNE, 3),
    ];
    const first = buildPoiMarkers(features, { frame: FRAME });
    const second = buildPoiMarkers([...features], { frame: FRAME });
    expect(first.map((m) => m.feature)).toEqual(second.map((m) => m.feature));
  });
});
