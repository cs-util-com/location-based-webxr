/**
 * Measures how often a multipolygon relation and one of its OWN outer members
 * both reach the index, and pins the de-duplication that stops them from being
 * scored twice.
 *
 * WHY THIS TEST MATTERS.
 *
 * The C# reference removes a multipolygon's `role=outer` members from its
 * spatial index (`OsmGeoSpatialIndexer.alreadyHandledOuterRelationMembers`) so
 * the same ground is not counted twice, while KEEPING `role=inner` members
 * because holes carry their own tags and are real areas in their own right.
 * The plan lists that as a rule to port (§3.2); it was never implemented.
 *
 * The consequence is specific to a multiplicative kernel. An outer way of a
 * multipolygon usually carries no tags and so is not returned by the 32-key
 * filter at all — but when it does carry one (a `natural=water` outer ring of a
 * `natural=water` relation is the common case), Overpass returns BOTH the
 * relation and the way as top-level elements. They cover the same cells, both
 * contribute, and the shared tag is applied twice: a factor of 10 becomes 100.
 * A veto stays a veto, so the error is silent and one-directional — areas are
 * over-scored, never under-scored, which is exactly the direction that makes a
 * bad affordance look like a good one.
 *
 * This file therefore does two things, and the order is the point:
 *
 * 1. MEASURES the real frequency across the checked-in fixtures, so the
 *    decision to fix was made against a number rather than a hypothesis. The
 *    answer is **zero** — see the pinned rows at the bottom — which is why the
 *    guard below is described as preventive rather than corrective.
 * 2. ASSERTS the de-duplication itself on constructed input, where the inputs
 *    are known exactly. Fixture-driven assertions on a rare interaction are
 *    hostage to whichever elements happened to be in the bbox, and this one is
 *    not in them at all.
 *
 * The implementation is deliberately NARROWER than the reference's: it
 * suppresses an outer member only when its tags are a subset of its parent's,
 * so a `barrier=fence` bounding a `natural=wood` survives. See
 * `redundantOuterMembers` in `h3-feature-index.ts`.
 */

import { describe, expect, it } from "vitest";

import { buildFeatureIndex } from "./h3-feature-index.js";
import { featureKey } from "../model/osm-feature.js";
import type { OsmFeature, OsmRelation, OsmWay } from "../model/osm-feature.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { FIXTURE_SLUGS, loadFixture } from "../test-utils/load-fixtures.js";

/** A square ring, big enough to cover several res-13 cells. */
function square(lat: number, lng: number, size: number) {
  return [
    { lat, lng },
    { lat, lng: lng + size },
    { lat: lat + size, lng: lng + size },
    { lat: lat + size, lng },
    { lat, lng },
  ];
}

const OUTER_WAY: OsmWay = {
  type: "way",
  id: 100,
  geometry: square(50.9, 6.9, 0.0004),
  // A tagged outer ring: this is what makes it survive the key filter and
  // arrive alongside its parent relation.
  tags: { natural: "water" },
};

const INNER_WAY: OsmWay = {
  type: "way",
  id: 200,
  geometry: square(50.9001, 6.9001, 0.0001),
  // A hole that is itself a mapped feature — the case the C# reference
  // deliberately KEEPS in the index.
  tags: { natural: "wood" },
};

const RELATION: OsmRelation = {
  type: "relation",
  id: 300,
  tags: { type: "multipolygon", natural: "water" },
  members: [
    { type: "way", ref: 100, role: "outer", geometry: OUTER_WAY.geometry },
    { type: "way", ref: 200, role: "inner", geometry: INNER_WAY.geometry },
  ],
};

describe("multipolygon outer members are not counted twice", () => {
  it("drops an outer member that arrives alongside its parent relation", () => {
    const index = buildFeatureIndex([RELATION, OUTER_WAY, INNER_WAY]);

    // The relation stands for the outer ring; the way is the same ground.
    expect(index.features.has(featureKey(RELATION))).toBe(true);
    expect(index.features.has(featureKey(OUTER_WAY))).toBe(false);
  });

  it("KEEPS an inner member, because a hole carries its own tags", () => {
    const index = buildFeatureIndex([RELATION, OUTER_WAY, INNER_WAY]);

    // `natural=wood` inside a lake is a real, separately scoreable feature.
    // Dropping it would lose the tag entirely — the relation does not carry it.
    expect(index.features.has(featureKey(INNER_WAY))).toBe(true);
  });

  it("is order-independent — the way may arrive before its relation", () => {
    // Overpass does not guarantee relations precede their members, and a merge
    // across tiles reorders freely. The C# reference needed a separate
    // `alreadyHandledOuterRelationMembers` set for exactly this reason.
    const wayFirst = buildFeatureIndex([OUTER_WAY, INNER_WAY, RELATION]);
    const relationFirst = buildFeatureIndex([RELATION, OUTER_WAY, INNER_WAY]);

    expect([...wayFirst.features.keys()].sort()).toEqual(
      [...relationFirst.features.keys()].sort(),
    );
    expect(wayFirst.features.has(featureKey(OUTER_WAY))).toBe(false);
  });

  it("keeps an outer member whose parent relation is NOT present", () => {
    // A tile boundary can deliver the way without the relation. Dropping it
    // then would erase real ground — absence of the parent is not evidence.
    const index = buildFeatureIndex([OUTER_WAY]);
    expect(index.features.has(featureKey(OUTER_WAY))).toBe(true);
  });

  it("keeps an outer member of a NON-areal relation", () => {
    // A `type=route` relation does not stand for its members' geometry — the
    // members are the features. Suppressing them would drop the roads.
    const route: OsmRelation = {
      type: "relation",
      id: 400,
      tags: { type: "route", route: "bicycle" },
      members: [
        { type: "way", ref: 100, role: "outer", geometry: OUTER_WAY.geometry },
      ],
    };
    const index = buildFeatureIndex([route, OUTER_WAY]);
    expect(index.features.has(featureKey(OUTER_WAY))).toBe(true);
  });

  it("keeps an outer member that carries a tag its parent does not", () => {
    // THE DELIBERATE DIVERGENCE FROM C#, and the reason this is not a
    // straight port. The reference drops every `role=outer` member
    // unconditionally, which loses a fence that happens to bound a wood: the
    // relation carries `natural=wood` and nothing carries `barrier=fence`
    // afterwards. Suppression is therefore conditional on the member's tags
    // being a SUBSET of the parent's — only then is its factor provably a
    // sub-product of the parent's, and multiplying both a squaring.
    const fence: OsmWay = {
      type: "way",
      id: 500,
      geometry: square(50.9, 6.9, 0.0004),
      tags: { natural: "water", barrier: "fence" },
    };
    const relation: OsmRelation = {
      type: "relation",
      id: 600,
      tags: { type: "multipolygon", natural: "water" },
      members: [
        { type: "way", ref: 500, role: "outer", geometry: fence.geometry },
      ],
    };

    const index = buildFeatureIndex([relation, fence]);
    expect(index.features.has(featureKey(fence))).toBe(true);
  });

  it("stops the double contribution reaching the cells", () => {
    const index = buildFeatureIndex([RELATION, OUTER_WAY]);

    // Every cell the outer ring covers must list exactly one contributor for
    // that ground. Before the fix both the relation and the way were listed,
    // so `natural=water` multiplied in twice.
    for (const entries of index.byCell.values()) {
      const keys = entries.map((entry) => entry.feature);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).not.toContain(featureKey(OUTER_WAY));
    }
  });
});

describe("how often this actually happens in the fixtures", () => {
  it("REPORTS the measured frequency rather than asserting it", () => {
    const rows: string[] = [];

    for (const slug of FIXTURE_SLUGS) {
      const fixture = loadFixture(slug);
      const parsed = parseOverpassJson(fixture.payload);
      const present = new Set(parsed.features.map((f) => featureKey(f)));

      let arealRelations = 0;
      let outerMembersAlsoPresent = 0;
      let innerMembersAlsoPresent = 0;

      for (const feature of parsed.features as OsmFeature[]) {
        if (feature.type !== "relation") continue;
        const relationType = feature.tags["type"];
        if (relationType !== "multipolygon" && relationType !== "boundary") {
          continue;
        }
        arealRelations++;
        for (const member of feature.members) {
          const key = `${member.type}/${member.ref}` as const;
          if (!present.has(key)) continue;
          if (member.role === "outer") outerMembersAlsoPresent++;
          if (member.role === "inner") innerMembersAlsoPresent++;
        }
      }

      rows.push(
        `${slug.padEnd(15)} ${String(arealRelations).padStart(3)} areal relations | ` +
          `${String(outerMembersAlsoPresent).padStart(3)} outer members also returned | ` +
          `${String(innerMembersAlsoPresent).padStart(3)} inner`,
      );
    }

    // PINNED, not printed. `silent: true` in the vitest config means a
    // console.log here would reach nobody — a "reports rather than asserts"
    // test that reports into the void is worse than one that pins, because it
    // looks like a measurement while being none. The fixtures are immutable
    // until deliberately recaptured, so these ARE facts about checked-in data;
    // a recapture that moves them should fail loudly and be re-read, which is
    // exactly the review this line buys.
    //
    // What they say: the outer-member double-count occurs ZERO times in the
    // whole corpus, so the guard is preventive. The reason is structural — an
    // outer way usually carries no tags of its own, so the 32-key filter never
    // selects it. The single inner hit is the counter-example that matters: a
    // member CAN arrive independently, so the outer case is one tag away
    // rather than impossible.
    expect(rows).toEqual([
      "park              1 areal relations |   0 outer members also returned |   0 inner",
      "street-corner     0 areal relations |   0 outer members also returned |   0 inner",
      "beach             1 areal relations |   0 outer members also returned |   0 inner",
      "building-block    4 areal relations |   0 outer members also returned |   1 inner",
    ]);
  });
});
