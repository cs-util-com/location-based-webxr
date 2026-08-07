/**
 * Overpass-parser tests.
 *
 * Why these tests matter:
 * This module is the package's trust boundary — everything it consumes is a
 * response from a server we do not control, and public Overpass instances are
 * documented to return HTML error pages, 429s and truncated bodies under load
 * (we hit a 504 from the main instance while writing this package).
 *
 * The plan's requirement is absolute: a single bad element degrades to
 * "skipped and counted", never to a failed tile. Every test below is a
 * different way for the input to be wrong, and the assertion is always the
 * same shape — no throw, a named skip, and the good elements still parsed.
 *
 * @see overpass-parser.ts.md
 */

import { describe, it, expect } from "vitest";
import { parseOverpassJson } from "./overpass-parser.js";

const NODE = {
  type: "node",
  id: 1,
  lat: 50.94,
  lon: 6.95,
  tags: { amenity: "bench" },
};

const WAY = {
  type: "way",
  id: 2,
  geometry: [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 },
  ],
  tags: { highway: "footway" },
};

const wrap = (elements: unknown[]) => ({
  version: 0.6,
  osm3s: {
    copyright:
      "The data included in this document is from www.openstreetmap.org...",
    timestamp_osm_base: "2026-05-06T03:25:00Z",
  },
  elements,
});

describe("happy path", () => {
  it("parses nodes, ways and relations, converting lon -> lng", () => {
    const result = parseOverpassJson(
      wrap([
        NODE,
        WAY,
        {
          type: "relation",
          id: 3,
          tags: { type: "multipolygon" },
          members: [
            {
              type: "way",
              ref: 2,
              role: "outer",
              geometry: [
                { lat: 0, lon: 0 },
                { lat: 0, lon: 1 },
              ],
            },
          ],
        },
      ]),
    );
    expect(result.skipped).toEqual([]);
    expect(result.features).toHaveLength(3);
    const [node, way] = result.features;
    expect(node).toMatchObject({
      type: "node",
      position: { lat: 50.94, lng: 6.95 },
    });
    expect(way).toMatchObject({ type: "way" });
    expect(way?.type === "way" && way.geometry).toEqual([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
    ]);
  });

  it("surfaces the copyright string and the planet timestamp for attribution/provenance", () => {
    const result = parseOverpassJson(wrap([NODE]));
    expect(result.copyright).toContain("openstreetmap.org");
    expect(result.osmBaseTimestamp).toBe("2026-05-06T03:25:00Z");
  });

  it("an element with no tags parses fine — untagged members carry geometry", () => {
    const result = parseOverpassJson(
      wrap([{ type: "way", id: 9, geometry: WAY.geometry }]),
    );
    expect(result.features).toHaveLength(1);
    expect(result.features[0]).toMatchObject({ tags: {} });
  });
});

describe("malformed payloads degrade instead of throwing", () => {
  it.each([
    ["null", null],
    ["a string (e.g. an HTML error page)", "<html>504 Gateway Timeout</html>"],
    ["a number", 42],
    ["an array", [1, 2, 3]],
    ["an object with no elements array", { version: 0.6 }],
    ["an object whose elements is not an array", { elements: "nope" }],
  ])(
    "%s yields zero features and a named skip, not an exception",
    (_label, payload) => {
      let result!: ReturnType<typeof parseOverpassJson>;
      expect(() => {
        result = parseOverpassJson(payload);
      }).not.toThrow();
      expect(result.features).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.reason).toBeTruthy();
    },
  );
});

describe("bad elements are skipped individually — the tile survives", () => {
  it("keeps the good elements either side of a bad one", () => {
    const result = parseOverpassJson(
      wrap([NODE, { type: "node", id: 5 /* no lat/lon */ }, WAY]),
    );
    expect(result.features).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.featureKey).toBe("node/5");
  });

  it.each([
    ["element is not an object", "not-an-object"],
    ["element has no type", { id: 1 }],
    ["element has no numeric id", { type: "node", lat: 1, lon: 1 }],
    ["unknown element type", { type: "changeset", id: 7 }],
    ["node without coordinates", { type: "node", id: 8 }],
    [
      "node with out-of-range latitude",
      { type: "node", id: 9, lat: 91, lon: 0 },
    ],
    ["way without geometry", { type: "way", id: 10, tags: {} }],
    [
      "way with a one-point geometry",
      { type: "way", id: 11, geometry: [{ lat: 0, lon: 0 }] },
    ],
  ])("%s -> skipped with a reason", (_label, element) => {
    const result = parseOverpassJson(wrap([element]));
    expect(result.features).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toBeTruthy();
  });

  it("names `out geom` explicitly when a way arrives without geometry", () => {
    // This is a QUERY bug, not a data problem: forgetting `out geom` yields a
    // response full of tag-only ways and an empty-looking tile. The skip reason
    // has to say so, or the symptom is indistinguishable from "nothing mapped
    // here".
    const result = parseOverpassJson(
      wrap([{ type: "way", id: 12, nodes: [1, 2] }]),
    );
    expect(result.skipped[0]!.reason).toMatch(/out geom/);
  });
});

describe("clipped geometry — Overpass emits nulls for positions outside the bbox", () => {
  it("drops null positions but keeps the way when enough remain", () => {
    const result = parseOverpassJson(
      wrap([
        {
          type: "way",
          id: 20,
          geometry: [{ lat: 0, lon: 0 }, null, { lat: 1, lon: 1 }],
          tags: { building: "yes" },
        },
      ]),
    );
    expect(result.features).toHaveLength(1);
    const way = result.features[0]!;
    expect(way.type === "way" && way.geometry).toEqual([
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
    ]);
  });

  it("skips the way when too few positions survive, rather than emitting a stub", () => {
    // A half-materialised way stitches into a ring that closes in the wrong
    // place — a plausible-but-wrong polygon, which is worse than no polygon.
    const result = parseOverpassJson(
      wrap([
        { type: "way", id: 21, geometry: [{ lat: 0, lon: 0 }, null, null] },
      ]),
    );
    expect(result.features).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });
});

describe("tags", () => {
  it("drops non-string tag values rather than coercing them", () => {
    // A coerced tag is a fake tag: it would produce a rule key that no mapper
    // ever wrote, and could silently match (or miss) a scoring rule.
    const result = parseOverpassJson(
      wrap([{ ...NODE, tags: { good: "yes", bad: 42, worse: null } }]),
    );
    expect(result.features[0]!.tags).toEqual({ good: "yes" });
  });
});

describe("relation members", () => {
  it("drops unusable members but keeps the relation for diagnostics", () => {
    const result = parseOverpassJson(
      wrap([
        {
          type: "relation",
          id: 30,
          tags: { type: "multipolygon" },
          members: [
            "garbage",
            { type: "way" /* no ref */ },
            { type: "way", ref: 1, role: "outer" },
          ],
        },
      ]),
    );
    expect(result.features).toHaveLength(1);
    const relation = result.features[0]!;
    expect(relation.type).toBe("relation");
    expect(relation.type === "relation" && relation.members).toHaveLength(1);
  });

  it("defaults a missing role to the empty string rather than inventing one", () => {
    const result = parseOverpassJson(
      wrap([
        {
          type: "relation",
          id: 31,
          tags: { type: "multipolygon" },
          members: [{ type: "way", ref: 1 }],
        },
      ]),
    );
    const relation = result.features[0]!;
    expect(relation.type === "relation" && relation.members[0]!.role).toBe("");
  });
});
