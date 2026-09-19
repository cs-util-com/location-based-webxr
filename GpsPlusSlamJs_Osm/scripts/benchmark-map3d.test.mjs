import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildTileQuery,
  OVERPASS_SELECT_KEYS,
} from "../src/source/overpass-query.js";
import {
  buildComparisonProfiles,
  planComparisonCells,
} from "./benchmark-map3d.mjs";

const bbox = {
  south: 40.748649127451834,
  west: -74.00064468383789,
  north: 40.78467511524571,
  east: -73.93524169921875,
};
const profilesForSite = (site) =>
  buildComparisonProfiles({ bbox: site.bbox, keys: OVERPASS_SELECT_KEYS });
const hosts = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const sites = [
  { id: "manhattan", bbox },
  { id: "small", bbox: { south: 50, west: 6, north: 50.01, east: 6.01 } },
];

describe("comparison query profiles", () => {
  it("preserves the supplied map3d query and isolates each transport/output/timeout change", () => {
    // WHY: changing two variables in an arm would make a latency difference ambiguous.
    const byId = Object.fromEntries(
      profilesForSite(sites[0]).map((p) => [p.id, p]),
    );
    const exact =
      '[out:json][timeout:25];(way["building"]( 40.748649127451834,-74.00064468383789,40.78467511524571,-73.93524169921875 );relation["building"]( 40.748649127451834,-74.00064468383789,40.78467511524571,-73.93524169921875 ););out body geom;';
    expect(byId.map3d).toEqual({
      id: "map3d",
      query: exact,
      encoding: "raw",
      timeoutSeconds: 25,
    });
    expect(byId.encoded).toEqual({
      ...byId.map3d,
      id: "encoded",
      encoding: "form",
    });
    expect(byId["geom-only"]).toEqual({
      ...byId.map3d,
      id: "geom-only",
      query: exact.replace("out body geom;", "out geom;"),
    });
    expect(byId.timeout180).toEqual({
      ...byId.map3d,
      id: "timeout180",
      timeoutSeconds: 180,
      query: exact.replace("timeout:25", "timeout:180"),
    });
    expect(byId.preview.query).toContain('way["building:part"]');
    expect(byId.preview.query).toContain(
      'relation["building:part"]["type"~"^(multipolygon|boundary)$"]',
    );
    expect(byId.preview.query).not.toContain("nw[");
    expect(byId.preview.encoding).toBe("raw");
    expect(byId.preview.timeoutSeconds).toBe(25);
    expect(byId.everything).toEqual({
      id: "everything",
      query: `[out:json][timeout:180][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];\nnwr;\nout geom;`,
      encoding: "form",
      timeoutSeconds: 180,
    });
    expect(byId["everything-areal"]).toEqual({
      ...byId.everything,
      id: "everything-areal",
      query: byId.everything.query.replace(
        "nwr;",
        '(nw;relation["type"~"^(multipolygon|boundary)$"];);',
      ),
    });
  });

  it("matches the actual production query across bboxes and key selections", () => {
    // WHY: the plain-Node query mirror must fail when production changes.
    for (const site of sites) {
      for (const keys of [
        OVERPASS_SELECT_KEYS,
        ["building"],
        ["highway", "building:part"],
      ]) {
        const full = buildComparisonProfiles({ bbox: site.bbox, keys }).find(
          (p) => p.id === "full-production180",
        );
        expect(full).toEqual({
          id: "full-production180",
          query: buildTileQuery(site.bbox, 180, keys),
          encoding: "form",
          timeoutSeconds: 180,
        });
      }
    }
  });

  it.each([
    { ...bbox, south: NaN },
    { ...bbox, west: Infinity },
    { ...bbox, south: bbox.north },
    { ...bbox, east: bbox.west - 1 },
    { ...bbox, north: 91 },
    { ...bbox, west: -181 },
  ])("rejects invalid bounds before creating a request: %j", (invalid) => {
    // WHY: invalid extents must not become accidental expensive requests.
    expect(() =>
      buildComparisonProfiles({ bbox: invalid, keys: OVERPASS_SELECT_KEYS }),
    ).toThrow();
  });

  it.each([[], ['building"];out;'], [""], [null]])(
    "rejects unsafe or empty keys: %j",
    (keys) => {
      // WHY: benchmark inputs must never escape their selector or become unfiltered.
      expect(() => buildComparisonProfiles({ bbox, keys })).toThrow();
    },
  );
});

describe("comparison scheduling", () => {
  it("completes all arms each round with unique IDs and changing order", () => {
    // WHY: the historical blocked-by-arm sweep confounded arm with server load.
    const cells = planComparisonCells({ hosts, sites, profilesForSite });
    expect(cells).toHaveLength(96);
    expect(new Set(cells.map((c) => c.id)).size).toBe(cells.length);
    const expected = hosts
      .flatMap((url) =>
        sites.flatMap((site) =>
          profilesForSite(site).map(
            (profile) => `${url}|${site.id}|${profile.id}`,
          ),
        ),
      )
      .sort();
    const orders = [];
    for (const round of [1, 2, 3]) {
      const slice = cells.slice((round - 1) * 32, round * 32);
      expect(slice.every((c) => c.round === round)).toBe(true);
      expect(
        slice.map((c) => `${c.url}|${c.site}|${c.profile}`).sort(),
      ).toEqual(expected);
      orders.push(slice.map((c) => c.profile).join(","));
    }
    expect(new Set(orders).size).toBe(3);
    for (const cell of cells) {
      const site = sites.find((s) => s.id === cell.site);
      const profile = profilesForSite(site).find((p) => p.id === cell.profile);
      expect(cell).toMatchObject({
        query: profile.query,
        encoding: profile.encoding,
        timeoutSeconds: profile.timeoutSeconds,
        bbox: site.bbox,
      });
      expect(cell.operator).toBe(
        cell.url === hosts[0] ? "fossgis" : "private.coffee",
      );
    }
  });

  it("preserves round coverage across repeat counts and unequal profile sets", () => {
    // WHY: subset runs must retain the same complete-round scheduling contract.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        (repeats, count) => {
          const select = (site) =>
            profilesForSite(site).slice(0, site.id === "small" ? 1 : count);
          const cells = planComparisonCells({
            hosts,
            sites,
            repeats,
            profilesForSite: select,
          });
          expect(cells).toHaveLength(repeats * hosts.length * (count + 1));
          expect(new Set(cells.map((c) => c.id)).size).toBe(cells.length);
          for (let round = 1; round <= repeats; round++) {
            expect(cells.filter((c) => c.round === round)).toHaveLength(
              hosts.length * (count + 1),
            );
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    "rejects invalid repeats %s",
    (repeats) => {
      // WHY: the schedule must be finite and must not silently run no cases.
      expect(() =>
        planComparisonCells({ hosts, sites, repeats, profilesForSite }),
      ).toThrow();
    },
  );

  it("rejects empty or duplicate dimensions", () => {
    // WHY: duplicate IDs or empty arms undermine result accounting.
    for (const patch of [
      { hosts: [] },
      { sites: [] },
      { hosts: [hosts[0], hosts[0]] },
      { sites: [sites[0], sites[0]] },
      { profilesForSite: () => [] },
      {
        profilesForSite: () => [
          profilesForSite(sites[0])[0],
          profilesForSite(sites[0])[0],
        ],
      },
    ]) {
      expect(() =>
        planComparisonCells({ hosts, sites, profilesForSite, ...patch }),
      ).toThrow();
    }
  });
});
