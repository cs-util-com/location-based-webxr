/**
 * Cross-tile, cross-session merge tests.
 *
 * Why these tests matter:
 * The scenario is real and ordinary — session 1 runs somewhere, session 2
 * starts 500 m away weeks later, and its fetch must merge into a store that
 * already holds overlapping data. Fetch-tile bboxes overlap by construction
 * (a hexagon's bbox is bigger than the hexagon), so the same element arrives in
 * several tiles routinely, and those tiles can be months apart.
 *
 * **The C# reference gets this wrong in a way worth reproducing as a test.**
 * `OsmGeoSpatialIndexer.AddOsmGeoNode` overwrites `allEntries[id]` on a
 * duplicate but does NOT re-index, while `GetOrAddGeometry` and the envelope
 * lookup are first-write-wins. So after a second tile supplies the same
 * element, its TAGS come from the newer tile and its GEOMETRY from the older
 * one — and nothing detects the mix. An element whose footprint was corrected
 * in OSM between two fetches ends up scored with new tags against an old
 * outline: a wrong answer that looks entirely plausible. The reference also
 * never consults `version` or `timestamp`, although its data source supplies
 * both.
 *
 * @see merge-tiles.ts.md
 */

import { describe, it, expect } from "vitest";
import { mergeTiles } from "./merge-tiles.js";
import type { OsmTileResult } from "../source/osm-data-source.js";
import type { OsmFeature } from "../model/osm-feature.js";

const OLD = 1_000_000;
const NEW = 2_000_000;

function way(
  id: number,
  tags: Record<string, string>,
  lat: number,
): OsmFeature {
  return {
    type: "way",
    id,
    geometry: [
      { lat, lng: 6.9 },
      { lat, lng: 6.91 },
    ],
    tags,
  };
}

function tile(
  name: string,
  features: OsmFeature[],
  fetchedAt: number,
): OsmTileResult {
  return {
    tile: name,
    features,
    fetchedAt,
    sourceId: "test",
    schemaVersion: 2,
    skipped: [],
  };
}

describe("a merge is TOTAL — one element comes from exactly one tile", () => {
  it("never assembles tags from one tile and geometry from another", () => {
    // THE C# BUG, as an executable test. Both fields must come from the same
    // source tile; a mix is a plausible-looking wrong answer.
    const older = tile("A", [way(1, { building: "yes" }, 50.9)], OLD);
    const newer = tile("B", [way(1, { building: "house" }, 51.5)], NEW);

    const merged = mergeTiles([older, newer]);
    const feature = merged.features.get("way/1")!;

    expect(feature.tags).toEqual({ building: "house" });
    expect(feature.type).toBe("way");
    // Narrowed rather than cast: the whole assertion is that tags and geometry
    // travel together, so reaching for geometry through an unchecked cast would
    // undercut the point of the test.
    if (feature.type !== "way") throw new Error("expected a way");
    expect(feature.geometry[0]!.lat).toBe(51.5);
  });

  it("keeps a single element even when it appears in three overlapping tiles", () => {
    const merged = mergeTiles([
      tile("A", [way(1, { a: "1" }, 50.9)], OLD),
      tile("B", [way(1, { b: "2" }, 51.0)], OLD + 1),
      tile("C", [way(1, { c: "3" }, 51.1)], OLD + 2),
    ]);

    expect(merged.features.size).toBe(1);
    expect(merged.features.get("way/1")!.tags).toEqual({ c: "3" });
  });

  it("keys by type AND id, because OSM ids are only unique within a type", () => {
    // node 1, way 1 and relation 1 all exist. The C# reference used bare
    // numeric ids in its provenance map — a latent collision.
    const merged = mergeTiles([
      tile(
        "A",
        [
          { type: "node", id: 1, position: { lat: 50.9, lng: 6.9 }, tags: {} },
          way(1, { highway: "path" }, 50.9),
        ],
        OLD,
      ),
    ]);

    expect(merged.features.size).toBe(2);
    expect(merged.features.has("node/1")).toBe(true);
    expect(merged.features.has("way/1")).toBe(true);
  });
});

describe("the winner is deterministic and order-independent", () => {
  it("prefers the more recently fetched tile", () => {
    const merged = mergeTiles([
      tile("A", [way(1, { v: "old" }, 50.9)], OLD),
      tile("B", [way(1, { v: "new" }, 50.9)], NEW),
    ]);
    expect(merged.features.get("way/1")!.tags).toEqual({ v: "new" });
  });

  it("gives the same answer whichever order the tiles arrive in", () => {
    const a = tile("A", [way(1, { v: "old" }, 50.9)], OLD);
    const b = tile("B", [way(1, { v: "new" }, 50.9)], NEW);

    expect(mergeTiles([a, b]).features.get("way/1")).toEqual(
      mergeTiles([b, a]).features.get("way/1"),
    );
  });

  it("breaks a fetchedAt tie by tile id rather than by arrival order", () => {
    // Two tiles fetched in the same millisecond is not exotic — a working set
    // is fetched concurrently. Without a total order the result would depend on
    // array order, which is exactly the non-determinism this rule removes.
    const a = tile("aaa", [way(1, { v: "a" }, 50.9)], OLD);
    const b = tile("bbb", [way(1, { v: "b" }, 50.9)], OLD);

    expect(mergeTiles([a, b]).features.get("way/1")!.tags).toEqual(
      mergeTiles([b, a]).features.get("way/1")!.tags,
    );
  });
});

describe("provenance survives the merge", () => {
  it("reports which tile each element came from, and when it was fetched", () => {
    // Without this, "the western half of this region is eight months old" is
    // unanswerable — and §5.2's promise that fetchedAt is reachable from the
    // public API stops holding as soon as more than one tile is involved.
    const merged = mergeTiles([
      tile("A", [way(1, { v: "old" }, 50.9)], OLD),
      tile("B", [way(2, { v: "new" }, 51.0)], NEW),
    ]);

    expect(merged.provenance.get("way/1")).toEqual({
      tile: "A",
      fetchedAt: OLD,
      sourceId: "test",
    });
    expect(merged.provenance.get("way/2")?.fetchedAt).toBe(NEW);
  });

  it("reports the OLDEST contributing tile, which is what staleness means", () => {
    // A merged working set is only as fresh as its stalest tile; reporting the
    // newest would let a just-fetched neighbour disguise year-old data.
    const merged = mergeTiles([
      tile("A", [way(1, {}, 50.9)], OLD),
      tile("B", [way(2, {}, 51.0)], NEW),
    ]);
    expect(merged.oldestFetchedAt).toBe(OLD);
    expect(merged.newestFetchedAt).toBe(NEW);
  });
});

describe("a refetch of the SAME tile supersedes its own older copy", () => {
  it("drops an element the refetched tile no longer returns", () => {
    // Found by a property test, and it is the one case where absence DOES mean
    // deletion — soundly, because a tile covers a fixed bbox, so an element
    // missing from a fresh fetch of that same bbox is genuinely gone from OSM.
    //
    // Without this the merge would union a tile with its own stale copy, and a
    // demolished building could never disappear — defeating the entire point of
    // §5.2's maxAgeMs refresh.
    const before = tile("A", [way(1, {}, 50.9), way(2, {}, 50.95)], OLD);
    const after = tile("A", [way(1, {}, 50.9)], NEW);

    const merged = mergeTiles([before, after]);

    expect(merged.features.has("way/1")).toBe(true);
    expect(merged.features.has("way/2")).toBe(false);
  });

  it("does not let the superseded copy count as a duplicate", () => {
    const merged = mergeTiles([
      tile("A", [way(1, {}, 50.9)], OLD),
      tile("A", [way(1, {}, 50.9)], NEW),
    ]);
    expect(merged.duplicateCount).toBe(0);
  });

  it("reports staleness from the surviving copy, not the superseded one", () => {
    const merged = mergeTiles([
      tile("A", [way(1, {}, 50.9)], OLD),
      tile("A", [way(1, {}, 50.9)], NEW),
    ]);
    expect(merged.oldestFetchedAt).toBe(NEW);
  });
});

describe("absence is not deletion — ACROSS tiles", () => {
  it("keeps an element that only the older tile contains", () => {
    // The rule that makes overlapping tiles safe. An element missing from a
    // newer tile tells us NOTHING — it may simply lie outside that tile's bbox.
    // Treating absence as deletion would make every fetch silently delete its
    // neighbours' data.
    const merged = mergeTiles([
      tile("A", [way(1, {}, 50.9), way(2, {}, 50.95)], OLD),
      tile("B", [way(1, {}, 50.9)], NEW),
    ]);

    expect(merged.features.has("way/2")).toBe(true);
    expect(merged.features.size).toBe(2);
  });
});

describe("defensive behaviour", () => {
  it("returns an empty result for no tiles, rather than throwing", () => {
    const merged = mergeTiles([]);
    expect(merged.features.size).toBe(0);
    expect(merged.oldestFetchedAt).toBeUndefined();
  });

  it("counts duplicates, so overlap can be measured rather than assumed", () => {
    // The overlap is by construction, but its SIZE is not known. If a res-7
    // working set turns out to be mostly duplicated payload, that is a storage
    // finding worth having a number for before designing a fix.
    const merged = mergeTiles([
      tile("A", [way(1, {}, 50.9), way(2, {}, 50.95)], OLD),
      tile("B", [way(1, {}, 50.9), way(3, {}, 51.0)], NEW),
    ]);

    expect(merged.features.size).toBe(3);
    expect(merged.duplicateCount).toBe(1);
  });

  it("skips a tile with no features without disturbing the rest", () => {
    // Ocean tiles are real and legitimately empty.
    const merged = mergeTiles([
      tile("A", [], OLD),
      tile("B", [way(1, {}, 50.9)], NEW),
    ]);
    expect(merged.features.size).toBe(1);
  });
});
