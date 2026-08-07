/**
 * Fixture-source and real-data tests.
 *
 * Why these tests matter:
 * Two jobs. First, that `FixtureSource` and any other source are genuinely
 * interchangeable behind `OsmDataSource` — the seam the plan calls "the single
 * most important abstraction in the package" is worthless if it only works for
 * the source it was written against.
 *
 * Second, and more valuable: these run the Iteration-1 parser and geometry
 * conversion against REAL captured Overpass responses. Hand-written test
 * literals only contain the cases we thought of; real OSM contains a Roman
 * aqueduct with 1179 positions in one way, and a res-10 coastal tile whose
 * entire payload is the North Sea.
 *
 * @see ../testdata/README.md for provenance and the S3DB census.
 */

import { describe, it, expect } from "vitest";
import { getResolution } from "h3-js";
import { FixtureSource } from "./fixture-source.js";
import { CachingSource } from "./caching-source.js";
import { MemoryBlobStore } from "./memory-blob-store.js";
import { toGeometry } from "../model/osm-geometry.js";
import { featureKey } from "../model/osm-feature.js";
import {
  FIXTURE_SLUGS,
  loadAllFixtures,
  loadFixture,
} from "../test-utils/load-fixtures.js";

const fixtures = loadAllFixtures();

describe("FixtureSource honours the OsmDataSource contract", () => {
  it("returns the captured features for a known tile", async () => {
    const park = loadFixture("park");
    const source = new FixtureSource([park]);

    const result = await source.fetchTile(park.tile);

    expect(result.tile).toBe(park.tile);
    expect(result.features.length).toBeGreaterThan(0);
    expect(result.sourceId).toBe("fixture:park");
    expect(result.fetchedAt).toBe(park.capturedAt);
  });

  it("records which tiles were requested, so fetch policy can be asserted", async () => {
    const park = loadFixture("park");
    const source = new FixtureSource([park]);
    await source.fetchTile(park.tile);
    await source.fetchTile("unknown-tile");
    expect(source.requested).toEqual([park.tile, "unknown-tile"]);
  });

  it("returns an empty tile for an unknown cell by default", async () => {
    // Matches what a real source does for genuinely unmapped ocean.
    const source = new FixtureSource([]);
    const result = await source.fetchTile("8a1fa199bc5ffff");
    expect(result.features).toEqual([]);
    expect(result.fetchedAt).toBe(0); // deterministic, never Date.now()
  });

  it("can be made to throw on an unknown cell, for tests that assert a fetch", async () => {
    const source = new FixtureSource([], { onMissing: "throw" });
    await expect(source.fetchTile("8a1fa199bc5ffff")).rejects.toThrow(
      /No fixture/,
    );
  });

  it("is interchangeable with any other source behind the caching decorator", async () => {
    const park = loadFixture("park");
    const source = new FixtureSource([park]);
    const cache = new CachingSource(source, new MemoryBlobStore());

    const first = await cache.fetchTile(park.tile);
    const second = await cache.fetchTile(park.tile);

    expect(source.requested).toEqual([park.tile]); // cached the second time
    expect(second.features.length).toBe(first.features.length);
    expect(second.fetchedAt).toBe(first.fetchedAt);
  });

  it("survives a JSON round-trip through the blob store unchanged", async () => {
    // Everything on OsmTileResult must be structured-cloneable and
    // JSON-serialisable — it crosses both a storage boundary and (in the
    // consumer's bridge) a worker boundary.
    const park = loadFixture("park");
    const cache = new CachingSource(
      new FixtureSource([park]),
      new MemoryBlobStore(),
    );
    const direct = await cache.fetchTile(park.tile);
    const fromCache = await cache.fetchTile(park.tile);
    expect(JSON.stringify(fromCache)).toBe(JSON.stringify(direct));
  });
});

describe("the captured fixtures themselves", () => {
  it("all four are present", () => {
    expect(fixtures.map((f) => f.name).sort()).toEqual(
      [...FIXTURE_SLUGS].sort(),
    );
  });

  it.each(fixtures.map((f) => [f.name, f]))(
    "%s carries the provenance the plan requires",
    (_name, fixture) => {
      expect(fixture.tile).toBeTruthy();
      expect(fixture.bbox.south).toBeLessThan(fixture.bbox.north);
      expect(fixture.bbox.west).toBeLessThan(fixture.bbox.east);
      expect(fixture.query).toContain("out geom;");
      expect(fixture.capturedAt).toBeGreaterThan(0);
      expect(fixture.capturedFrom).toMatch(/^https:/);
      expect(fixture.regenerateWith).toContain("capture:fixtures");
    },
  );

  it.each(fixtures.map((f) => [f.name, f]))(
    "%s was captured at res 10, not the res-8 fetch resolution",
    (_name, fixture) => {
      // Documents the deviation rather than letting it be a silent surprise:
      // res-8 capture 504s against public instances. See testdata/README.md.
      expect(getResolution(fixture.tile)).toBe(10);
    },
  );
});

describe("parsing real Overpass data end to end", () => {
  it.each(fixtures.map((f) => [f.name, f]))(
    "%s parses with no skipped elements",
    async (_name, fixture) => {
      const source = new FixtureSource([fixture]);
      const result = await source.fetchTile(fixture.tile);

      // Every element in a real response should be understood. A skip here
      // means the parser has a gap that hand-written literals did not reveal.
      expect(result.skipped).toEqual([]);
      expect(result.features).toHaveLength(fixture.elementCount);
    },
  );

  it.each(fixtures.map((f) => [f.name, f]))(
    "%s converts to geometry without throwing, and reports any failures as typed errors",
    async (_name, fixture) => {
      const source = new FixtureSource([fixture]);
      const { features } = await source.fetchTile(fixture.tile);

      const failures: string[] = [];
      for (const feature of features) {
        const result = toGeometry(feature);
        if (!result.ok) {
          failures.push(`${featureKey(feature)}: ${result.error.reason}`);
        }
      }

      // Failures are allowed — real OSM contains route relations and broken
      // multipolygons — but every one must be a typed error we can name, and
      // they must be a small minority.
      expect(failures.length).toBeLessThan(Math.max(3, features.length * 0.2));
    },
  );

  it("the street-corner fixture contains the 1179-position Roman aqueduct", async () => {
    // A real single-way stress case for cell coverage that no hand-written
    // literal would have produced.
    const fixture = loadFixture("street-corner");
    const { features } = await new FixtureSource([fixture]).fetchTile(
      fixture.tile,
    );
    const aqueduct = features.find(
      (f) => f.type === "way" && f.id === 467190239,
    );
    expect(aqueduct).toBeDefined();
    expect(aqueduct?.type === "way" && aqueduct.geometry.length).toBe(1179);
  });

  it("the beach fixture is a single relation — the entire North Sea", async () => {
    // Proves that ONE relation can dominate a tile's payload (0.99 MB for one
    // element here). Any assumption that payload scales with tile area is wrong
    // near coastlines, boundaries and large forests.
    const fixture = loadFixture("beach");
    const { features } = await new FixtureSource([fixture]).fetchTile(
      fixture.tile,
    );

    expect(features).toHaveLength(1);
    expect(features[0]!.type).toBe("relation");
    expect(fixture.rawBytes).toBeGreaterThan(500_000);
  });

  it("the building-block fixture holds the S3DB census that gates the 3D work", () => {
    // The plan asks: are `roof:shape` and `height` near zero in areas we
    // actually target? In Cologne's Altstadt — close to a German best case —
    // only 6 of 51 buildings carry a non-flat roof:shape. That is the "near
    // zero" the plan told us to look for, and it is the evidence against
    // building a straight skeleton for gabled/hipped roofs.
    const { s3dbCensus } = loadFixture("building-block");
    expect(s3dbCensus.buildings).toBe(51);
    expect(s3dbCensus.parts).toBe(12);
    expect(s3dbCensus.pitchedRoofs).toBe(6);
    expect(s3dbCensus.withHeight).toBe(8);

    // building:part is the one that pays: 24% coverage even here.
    expect(s3dbCensus.parts / s3dbCensus.buildings).toBeGreaterThan(0.2);
    // roof:shape is the one that does not: 12%.
    expect(s3dbCensus.pitchedRoofs / s3dbCensus.buildings).toBeLessThan(0.15);
  });
});
