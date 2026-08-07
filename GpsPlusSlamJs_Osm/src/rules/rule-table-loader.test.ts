/**
 * Rule-table loader tests.
 *
 * Why these tests matter:
 * The owner chose a runtime fetch from a publicly-editable Google Sheet as the
 * shipped default (§2.1), accepting the risk because the live-tuning loop is the
 * point. That decision makes the drift guard load-bearing rather than
 * nice-to-have: the three-tier fallback bounds only the BROKEN failure (a sheet
 * that will not parse degrades to the snapshot), and says nothing about a
 * plausible-but-wrong edit — which is the likelier accident and has no diff, no
 * review and no rollback behind it.
 *
 * The other thing pinned here is that loading NEVER throws. An app with a stale
 * table still works; an app with no table has no affordance data at all, and the
 * snapshot is always present.
 *
 * @see rule-table-loader.ts.md
 */

import { describe, it, expect, vi } from "vitest";
import {
  loadRuleTable,
  snapshotRuleTable,
  checkDrift,
  RULE_TABLE_CSV_URL,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_RULE_DRIFT,
} from "./rule-table-loader.js";
import { parseRuleTable, ruleValue } from "./rule-table.js";
import { MemoryBlobStore } from "../source/memory-blob-store.js";

const META = { source: "test", fetchedAt: 0 };

/** A small but structurally real sheet. */
function sheet(overrides: Record<string, [number, number]> = {}) {
  const base: Record<string, [number, number]> = {
    surface_sand: [5, 5],
    natural_beach: [8, 7],
    building_house: [0, 0],
    landuse_grass: [10, 9],
    ...overrides,
  };
  return [
    "id,Key,Value,battleArea,walkable",
    ...Object.entries(base).map(
      ([id, [battle, walk]]) =>
        `${id},${id.split("_")[0]},${id.split("_").slice(1).join("_")},${battle},${walk}`,
    ),
  ].join("\n");
}

const ok = (body: string) => Promise.resolve(new Response(body));

describe("the checked-in snapshot is always usable", () => {
  const table = snapshotRuleTable();

  it("parses, and carries the real sheet's shape", () => {
    // 467 SCORING rules, not the 721 quoted throughout this project's docs.
    // The sheet has 721 rows with ids, of which 254 carry a Key, a Value and a
    // Description but NO scores — documentation, not rules. Pinned because the
    // discrepancy otherwise looks like a parser bug.
    expect(Object.keys(table.rules).length).toBe(467);
    expect(
      table.skipped.filter((s2) => s2.reason.includes("documented")).length,
    ).toBe(254);
    expect(table.categories).toEqual(
      expect.arrayContaining([
        "battleArea",
        "spawnPoint",
        "treasureReward",
        "restingArea",
        "questGiver",
        "walkable",
      ]),
    );
  });

  it("reproduces every value the C# reference pins", () => {
    // The whole reason the multiplicative model was kept over a bounded
    // redesign: the reference's tests are a ready-made oracle with exact
    // expected products, which makes the port verifiable.
    expect(ruleValue(table, "landuse_grass", "battleArea")).toBe(10);
    expect(ruleValue(table, "building_house", "battleArea")).toBe(0);
    expect(ruleValue(table, "surface_sand", "walkable")).toBe(5);
    expect(ruleValue(table, "natural_beach", "walkable")).toBe(7);
    expect(ruleValue(table, "landuse_farmland", "battleArea")).toBe(0.8);
    expect(ruleValue(table, "wheelchair_yes", "battleArea")).toBe(4);
  });

  it("counts the 8 id-less rows the live sheet contains rather than hiding them", () => {
    expect(table.skipped.filter((s) => s.id === "(empty)")).toHaveLength(8);
  });

  it("is stored as raw CSV, so every test using it exercises the parser", () => {
    // A pre-parsed snapshot would let a parser regression hide behind
    // pre-digested data.
    expect(table.source).toBe("snapshot");
  });
});

describe("tier 1 — the live fetch", () => {
  it("uses the published sheet URL and returns the live table", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => ok(sheet()));
    const loaded = await loadRuleTable({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onWarn: () => {},
    });

    expect(fetchImpl.mock.calls[0]![0]).toBe(RULE_TABLE_CSV_URL);
    expect(loaded.tier).toBe("live");
    expect(ruleValue(loaded.table, "surface_sand", "walkable")).toBe(5);
  });

  it("writes what it fetched to the cache", async () => {
    const store = new MemoryBlobStore();
    await loadRuleTable({
      fetchImpl: vi.fn().mockImplementation(() => ok(sheet())) as never,
      store,
      onWarn: () => {},
    });
    expect((await store.keys()).length).toBe(1);
  });
});

describe("tier 2 — the cache short-circuits the network", () => {
  it("does NOT fetch when a cached table is still fresh", async () => {
    // The TTL matches the C# reference's 100 minutes. Without this the sheet
    // would be fetched on every start-up of every app — a third-party service
    // load we have no right to generate.
    const store = new MemoryBlobStore();
    const fetchImpl = vi.fn().mockImplementation(() => ok(sheet()));
    const opts = {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      store,
      onWarn: () => {},
    };

    await loadRuleTable({ ...opts, now: () => 1_000_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const second = await loadRuleTable({ ...opts, now: () => 1_000_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // still one
    expect(second.tier).toBe("cache");
  });

  it("DOES refetch once the cache is older than the TTL", async () => {
    const store = new MemoryBlobStore();
    const fetchImpl = vi.fn().mockImplementation(() => ok(sheet()));
    const opts = {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      store,
      onWarn: () => {},
    };

    await loadRuleTable({ ...opts, now: () => 0 });
    await loadRuleTable({ ...opts, now: () => DEFAULT_TTL_MS + 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to a STALE cache when the fetch fails", async () => {
    // A table someone chose beats the shipped default, and OSM tuning moves on
    // a scale of months, so stale is genuinely fine here.
    const store = new MemoryBlobStore();
    await loadRuleTable({
      fetchImpl: vi.fn().mockImplementation(() => ok(sheet())) as never,
      store,
      now: () => 0,
      onWarn: () => {},
    });

    const loaded = await loadRuleTable({
      fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) as never,
      store,
      now: () => DEFAULT_TTL_MS * 10,
      onWarn: () => {},
    });

    expect(loaded.tier).toBe("cache");
    expect(loaded.degradedBecause).toMatch(/live fetch failed/);
  });
});

describe("tier 3 — the snapshot, and loading NEVER throws", () => {
  it.each([
    ["a network error", () => Promise.reject(new Error("offline"))],
    [
      "an HTTP error",
      () => Promise.resolve(new Response("nope", { status: 500 })),
    ],
    ["an HTML login page", () => ok("<html><body>Sign in</body></html>")],
    ["an empty body", () => ok("")],
    ["a truncated quoted field", () => ok('id,Key,walkable\nx,"unterminated')],
  ])("degrades to the snapshot on %s", async (_label, impl) => {
    const warn = vi.fn();
    const loaded = await loadRuleTable({
      fetchImpl: vi.fn().mockImplementation(impl) as never,
      onWarn: warn,
    });

    expect(loaded.tier).toBe("snapshot");
    // Still a WORKING table — the oracle values are present.
    expect(ruleValue(loaded.table, "surface_sand", "walkable")).toBe(5);
    expect(warn).toHaveBeenCalled();
  });

  it("works with no fetch implementation at all", async () => {
    // Node without a global fetch, or a consumer deliberately running offline.
    const loaded = await loadRuleTable({
      fetchImpl: undefined,
      url: "about:invalid",
      onWarn: () => {},
      fetchOverrideForTest: undefined,
    } as never);
    expect(loaded.table.categories.length).toBeGreaterThan(0);
  });

  it("survives a corrupt cache entry by going to the network", async () => {
    const store = new MemoryBlobStore();
    await store.put("rules/v1/table.csv", "{not json");
    const loaded = await loadRuleTable({
      fetchImpl: vi.fn().mockImplementation(() => ok(sheet())) as never,
      store,
      onWarn: () => {},
    });
    expect(loaded.tier).toBe("live");
  });

  it("survives a store that refuses writes", async () => {
    const readOnly = {
      get: () => Promise.resolve(undefined),
      put: () => Promise.reject(new Error("read-only")),
      delete: () => Promise.resolve(),
      keys: () => Promise.resolve([]),
    };
    const loaded = await loadRuleTable({
      fetchImpl: vi.fn().mockImplementation(() => ok(sheet())) as never,
      store: readOnly,
      onWarn: () => {},
    });
    expect(loaded.tier).toBe("live");
  });
});

describe("the drift guard — the only thing between a bad sheet edit and every app", () => {
  const previous = parseRuleTable(sheet(), META);

  const withoutWalkable = [
    "id,Key,Value,battleArea",
    "surface_sand,surface,sand,5",
    "natural_beach,natural,beach,8",
    "building_house,building,house,0",
    "landuse_grass,landuse,grass,10",
  ].join("\n");

  it("REJECTS a table that lost a category, when there is a cache to fall back to", async () => {
    // Unambiguously wrong: some app is scoring on that category and would
    // silently start getting the identity for everything, which reads as "this
    // whole area is unmapped" rather than as a broken config.
    const store = new MemoryBlobStore();
    await loadRuleTable({
      fetchImpl: vi.fn().mockImplementation(() => ok(sheet())) as never,
      store,
      now: () => 0,
      onWarn: () => {},
    });

    const loaded = await loadRuleTable({
      fetchImpl: vi.fn().mockImplementation(() => ok(withoutWalkable)) as never,
      store,
      now: () => DEFAULT_TTL_MS + 1,
      onWarn: () => {},
    });

    expect(loaded.tier).toBe("cache");
    expect(loaded.degradedBecause).toMatch(/categories disappeared/);
  });

  it("ACCEPTS it on a FIRST run, but says so — the snapshot is not a baseline", async () => {
    // The pinning failure this avoids, and it is worse than the bad edit the
    // guard is for. Drift is comparative: it needs a baseline of comparable age.
    // Against the shipped snapshot it measures elapsed time, so months after a
    // release a first run (which by definition has no cache) would reject the
    // live table, never write a cache, and reject it again forever — pinned to a
    // snapshot nobody maintains, silently.
    //
    // What protects a first run is the STRUCTURAL validation in parseRuleTable,
    // which needs no baseline (see the "degrades to the snapshot on ..." cases:
    // a login page, an empty body and a truncated field are all still refused).
    const warn = vi.fn();
    const loaded = await loadRuleTable({
      fetchImpl: vi.fn().mockImplementation(() => ok(withoutWalkable)) as never,
      onWarn: warn,
    });

    expect(loaded.tier).toBe("live");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no longer declares"),
    );
  });

  it("REJECTS a table where too large a share of rules changed at once", () => {
    // A proportion rather than a count, and deliberately loose: real tuning
    // sessions change many rows, and a guard that fires on legitimate work gets
    // switched off.
    const rewritten = parseRuleTable(
      sheet({
        surface_sand: [99, 99],
        natural_beach: [98, 98],
        building_house: [97, 97],
      }),
      META,
    );
    const reason = checkDrift(
      { table: rewritten },
      previous,
      DEFAULT_MAX_RULE_DRIFT,
    );
    expect(reason).toMatch(/rules changed/);
  });

  it("ACCEPTS an ordinary tuning edit", () => {
    // One value out of four is 25%, under the one-third limit.
    const tuned = parseRuleTable(sheet({ surface_sand: [5, 6] }), META);
    expect(
      checkDrift({ table: tuned }, previous, DEFAULT_MAX_RULE_DRIFT),
    ).toBeUndefined();
  });

  it("ACCEPTS a table that only ADDS rules", () => {
    // Growth is the normal direction and must never be treated as drift.
    const grown = parseRuleTable(
      sheet({ leisure_park: [7, 8], amenity_bench: [1, 2] }),
      META,
    );
    expect(
      checkDrift({ table: grown }, previous, DEFAULT_MAX_RULE_DRIFT),
    ).toBeUndefined();
  });

  it("counts a REMOVED rule as changed", () => {
    // Deleting rules is exactly the kind of accident the guard is for.
    const gutted = parseRuleTable(
      [
        "id,Key,Value,battleArea,walkable",
        "surface_sand,surface,sand,5,5",
      ].join("\n"),
      META,
    );
    expect(
      checkDrift({ table: gutted }, previous, DEFAULT_MAX_RULE_DRIFT),
    ).toMatch(/rules changed/);
  });

  it("compares against the CACHE when one exists, not only the snapshot", async () => {
    // Otherwise a slow legitimate drift away from the shipped snapshot would
    // eventually trip the guard permanently, and the app would be pinned to a
    // table nobody is maintaining.
    const store = new MemoryBlobStore();
    await loadRuleTable({
      fetchImpl: vi.fn().mockImplementation(() => ok(sheet())) as never,
      store,
      now: () => 0,
      onWarn: () => {},
    });

    const loaded = await loadRuleTable({
      fetchImpl: vi
        .fn()
        .mockImplementation(() => ok(sheet({ surface_sand: [5, 6] }))) as never,
      store,
      now: () => DEFAULT_TTL_MS + 1,
      onWarn: () => {},
    });
    expect(loaded.tier).toBe("live");
  });

  it("keeps the cached table rather than the snapshot when it rejects a fetch", async () => {
    const store = new MemoryBlobStore();
    await loadRuleTable({
      fetchImpl: vi.fn().mockImplementation(() => ok(sheet())) as never,
      store,
      now: () => 0,
      onWarn: () => {},
    });

    const loaded = await loadRuleTable({
      fetchImpl: vi
        .fn()
        .mockImplementation(() =>
          ok("id,Key,Value,battleArea\nsurface_sand,surface,sand,5"),
        ) as never,
      store,
      now: () => DEFAULT_TTL_MS + 1,
      onWarn: () => {},
    });

    expect(loaded.tier).toBe("cache");
    expect(loaded.degradedBecause).toMatch(/categories disappeared/);
  });
});
