import { describe, expect, it, vi } from "vitest";
import { Mesh } from "three";
import type {
  OsmDataSource,
  OsmFeature,
  OsmTileResult,
} from "gps-plus-slam-osm";
import { RateLimitedError } from "gps-plus-slam-osm";
import {
  createOsmBuildingLayer,
  DEFAULT_OSM_BUILDING_RADIUS_M,
  DEFAULT_OSM_BUILDING_TIMEOUT_MS,
  type OsmBuildingStatus,
} from "./osm-building-layer.js";

const ORIGIN = { lat: 50.9413, lon: 6.9583 };

/** A closed square footprint, tagged as a plain building, near ORIGIN. */
const BUILDING_FEATURE: OsmFeature = {
  type: "way",
  id: 1,
  tags: { building: "yes", height: "10" },
  geometry: [
    { lat: 50.9413, lng: 6.9583 },
    { lat: 50.94135, lng: 6.9583 },
    { lat: 50.94135, lng: 6.95835 },
    { lat: 50.9413, lng: 6.95835 },
    { lat: 50.9413, lng: 6.9583 },
  ],
};

/** A short residential road segment near ORIGIN. */
const ROAD_FEATURE: OsmFeature = {
  type: "way",
  id: 2,
  tags: { highway: "residential" },
  geometry: [
    { lat: 50.9414, lng: 6.9583 },
    { lat: 50.9414, lng: 6.9585 },
  ],
};

/** A closed park footprint, tagged as a ground plate, near ORIGIN. */
const PARK_FEATURE: OsmFeature = {
  type: "way",
  id: 3,
  tags: { leisure: "park" },
  geometry: [
    { lat: 50.9412, lng: 6.9581 },
    { lat: 50.94125, lng: 6.9581 },
    { lat: 50.94125, lng: 6.95815 },
    { lat: 50.9412, lng: 6.95815 },
    { lat: 50.9412, lng: 6.9581 },
  ],
};

function tileResult(features: readonly OsmFeature[]): OsmTileResult {
  return {
    tile: "test-tile",
    features,
    fetchedAt: 0,
    sourceId: "fake",
    schemaVersion: 1,
    skipped: [],
  };
}

/** Resolves every tile with the same fixed set of features. */
function resolvingSource(features: readonly OsmFeature[]): OsmDataSource {
  return {
    attribution: "test",
    sourceId: "fake-resolving",
    fetchTile: () => Promise.resolve(tileResult(features)),
  };
}

/** Rejects every tile request. */
function rejectingSource(): OsmDataSource {
  return {
    attribution: "test",
    sourceId: "fake-rejecting",
    fetchTile: () => Promise.reject(new Error("network down")),
  };
}

/** Never resolves on its own; only settles when its signal is aborted. */
function hangingSource(): OsmDataSource {
  return {
    attribution: "test",
    sourceId: "fake-hanging",
    fetchTile: (_tile: string, signal?: AbortSignal) =>
      new Promise<OsmTileResult>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  };
}

describe("createOsmBuildingLayer", () => {
  it("defaults to a 300m radius and a 120s timeout", () => {
    expect(DEFAULT_OSM_BUILDING_RADIUS_M).toBe(300);
    expect(DEFAULT_OSM_BUILDING_TIMEOUT_MS).toBe(120_000);
  });

  it("rotates the group -90deg to match this app's (north, east) world axes", () => {
    // gps-plus-slam-osm's mesh output is fixed to +x=east, -z=north
    // (mesh-data.ts). This app's own AR-world frame (preview-frame.ts) is
    // x=north, z=east — a 90deg difference. Without this rotation, buildings
    // and roads render 90deg off from the tour's own waypoints/route/map.
    const layer = createOsmBuildingLayer({
      origin: ORIGIN,
      source: resolvingSource([]),
    });
    expect(layer.group.rotation.y).toBeCloseTo(-Math.PI / 2);
  });

  it("adds building meshes to the group once loaded", async () => {
    const layer = createOsmBuildingLayer({
      origin: ORIGIN,
      source: resolvingSource([BUILDING_FEATURE]),
    });

    expect(layer.group.children).toHaveLength(0);
    await layer.load();

    expect(layer.group.children.length).toBeGreaterThan(0);
    expect(layer.group.children[0]).toBeInstanceOf(Mesh);
  });

  it("adds road meshes to the same group, from the same fetch", async () => {
    const layer = createOsmBuildingLayer({
      origin: ORIGIN,
      source: resolvingSource([BUILDING_FEATURE, ROAD_FEATURE]),
    });

    await layer.load();

    // One building mesh, one road mesh — no second network round trip.
    expect(layer.group.children).toHaveLength(2);
    expect(layer.group.children.every((child) => child instanceof Mesh)).toBe(
      true,
    );
  });

  it("adds ground plate meshes (parks, car parks, ...) from the same fetch", async () => {
    const layer = createOsmBuildingLayer({
      origin: ORIGIN,
      source: resolvingSource([BUILDING_FEATURE, ROAD_FEATURE, PARK_FEATURE]),
    });

    await layer.load();

    // Building + road + park plate — still one network round trip.
    expect(layer.group.children).toHaveLength(3);
  });

  it("fails soft: a rejecting source leaves the group empty and does not throw", async () => {
    const layer = createOsmBuildingLayer({
      origin: ORIGIN,
      source: rejectingSource(),
    });

    await expect(layer.load()).resolves.toBeUndefined();
    expect(layer.group.children).toHaveLength(0);
  });

  it("fails soft: no features in the area leaves the group empty", async () => {
    const layer = createOsmBuildingLayer({
      origin: ORIGIN,
      source: resolvingSource([]),
    });

    await layer.load();
    expect(layer.group.children).toHaveLength(0);
  });

  it("aborts and fails soft once the timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      const layer = createOsmBuildingLayer({
        origin: ORIGIN,
        timeoutMs: 5_000,
        source: hangingSource(),
      });

      const pending = layer.load();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toBeUndefined();
      expect(layer.group.children).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispose() aborts an in-flight load and clears the group", async () => {
    let sawAbort = false;
    const source: OsmDataSource = {
      attribution: "test",
      sourceId: "fake-dispose",
      fetchTile: (_tile: string, signal?: AbortSignal) =>
        new Promise<OsmTileResult>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            sawAbort = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    };
    const layer = createOsmBuildingLayer({ origin: ORIGIN, source });

    const pending = layer.load();
    layer.dispose();
    await pending;

    expect(sawAbort).toBe(true);
    expect(layer.group.children).toHaveLength(0);
  });

  it("fetches only the origin's tile when no route is given (unchanged default)", async () => {
    const fetchedTiles: string[] = [];
    const source: OsmDataSource = {
      attribution: "test",
      sourceId: "fake-spy",
      fetchTile: (tile: string) => {
        fetchedTiles.push(tile);
        return Promise.resolve(tileResult([]));
      },
    };
    const layer = createOsmBuildingLayer({ origin: ORIGIN, source });

    await layer.load();

    expect(fetchedTiles).toHaveLength(1);
  });

  it("fetches one extra tile per route point far enough to land outside the origin's tile", async () => {
    const fetchedTiles: string[] = [];
    const source: OsmDataSource = {
      attribution: "test",
      sourceId: "fake-spy",
      fetchTile: (tile: string) => {
        fetchedTiles.push(tile);
        return Promise.resolve(tileResult([]));
      },
    };
    // ~2.2km east of ORIGIN — well outside a single ~1406m-edge FETCH_RES
    // tile, so this must land in a different tile.
    const farRoutePoint = { lat: ORIGIN.lat, lon: ORIGIN.lon + 0.026 };
    const layer = createOsmBuildingLayer({
      origin: ORIGIN,
      route: [ORIGIN, farRoutePoint],
      source,
    });

    await layer.load();

    expect(new Set(fetchedTiles).size).toBe(2);
  });

  it("dedupes a feature returned by more than one fetched tile into a single mesh", async () => {
    const fetchedTiles: string[] = [];
    const source: OsmDataSource = {
      attribution: "test",
      sourceId: "fake-spy",
      fetchTile: (tile: string) => {
        fetchedTiles.push(tile);
        // Same feature id comes back from every tile — real Overpass tiles
        // overlap at their edges, so a feature near a boundary is returned
        // by both.
        return Promise.resolve(tileResult([BUILDING_FEATURE]));
      },
    };
    const farRoutePoint = { lat: ORIGIN.lat, lon: ORIGIN.lon + 0.026 };
    const layer = createOsmBuildingLayer({
      origin: ORIGIN,
      route: [ORIGIN, farRoutePoint],
      source,
    });

    await layer.load();

    expect(new Set(fetchedTiles).size).toBe(2);
    // Two tiles both returned BUILDING_FEATURE — deduped to one mesh.
    expect(
      layer.group.children.filter((child) => child instanceof Mesh),
    ).toHaveLength(1);
  });

  it("does not add meshes if disposed while a load was already in flight", async () => {
    let resolveTile!: (result: OsmTileResult) => void;
    const source: OsmDataSource = {
      attribution: "test",
      sourceId: "fake-slow",
      fetchTile: () =>
        new Promise<OsmTileResult>((resolve) => {
          resolveTile = resolve;
        }),
    };
    const layer = createOsmBuildingLayer({ origin: ORIGIN, source });

    const pending = layer.load();
    layer.dispose();
    resolveTile(tileResult([BUILDING_FEATURE]));
    await pending;

    expect(layer.group.children).toHaveLength(0);
  });

  it("classifies failure from the resolved result, not only a thrown error", async () => {
    // Every tile erroring (not rate-limited) -> failed.
    const allFailed: OsmDataSource = {
      attribution: "test",
      sourceId: "fake-all-failed",
      fetchTile: () => Promise.reject(new Error("overpass down")),
    };
    const layerAllFailed = createOsmBuildingLayer({
      origin: ORIGIN,
      source: allFailed,
    });
    await layerAllFailed.load();
    expect(layerAllFailed.getStatus()).toBe("failed");

    // Every tile rate-limited (deferred) -> failed.
    const allDeferred: OsmDataSource = {
      attribution: "test",
      sourceId: "fake-all-deferred",
      fetchTile: () =>
        Promise.reject(new RateLimitedError("rate limited", 1000)),
    };
    const layerAllDeferred = createOsmBuildingLayer({
      origin: ORIGIN,
      source: allDeferred,
    });
    await layerAllDeferred.load();
    expect(layerAllDeferred.getStatus()).toBe("failed");

    // All tiles loaded but zero features -> loaded (genuinely empty area).
    const empty = resolvingSource([]);
    const layerEmpty = createOsmBuildingLayer({
      origin: ORIGIN,
      source: empty,
    });
    await layerEmpty.load();
    expect(layerEmpty.getStatus()).toBe("loaded");
  });

  it("treats a partial failure (some tiles loaded, some failed) as loaded", async () => {
    let call = 0;
    const source: OsmDataSource = {
      attribution: "test",
      sourceId: "fake-partial",
      fetchTile: () => {
        call += 1;
        return call === 1
          ? Promise.resolve(tileResult([BUILDING_FEATURE]))
          : Promise.reject(new Error("boom"));
      },
    };
    const farRoutePoint = { lat: ORIGIN.lat, lon: ORIGIN.lon + 0.026 };
    const layer = createOsmBuildingLayer({
      origin: ORIGIN,
      route: [ORIGIN, farRoutePoint],
      source,
    });

    await layer.load();

    expect(layer.getStatus()).toBe("loaded");
    expect(layer.group.children.length).toBeGreaterThan(0);
  });

  describe("status + setEnabled", () => {
    it("starts idle when enabled (default) and off when constructed disabled", () => {
      const idleLayer = createOsmBuildingLayer({
        origin: ORIGIN,
        source: resolvingSource([]),
      });
      expect(idleLayer.getStatus()).toBe("idle");

      const offLayer = createOsmBuildingLayer({
        origin: ORIGIN,
        source: resolvingSource([]),
        enabled: false,
      });
      expect(offLayer.getStatus()).toBe("off");
    });

    it("goes idle -> loading -> loaded, notifying subscribers of each transition without replay", async () => {
      const seen: OsmBuildingStatus[] = [];
      const layer = createOsmBuildingLayer({
        origin: ORIGIN,
        source: resolvingSource([BUILDING_FEATURE]),
      });
      const unsubscribe = layer.onStatusChange((status) => seen.push(status));

      await layer.load();

      expect(seen).toEqual(["loading", "loaded"]);
      unsubscribe();
    });

    it("setEnabled(false) mid-fetch aborts, clears the group, and goes straight to off (never failed, no warn)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      let resolveTile!: (result: OsmTileResult) => void;
      const source: OsmDataSource = {
        attribution: "test",
        sourceId: "fake-slow",
        fetchTile: (_tile, signal) =>
          new Promise<OsmTileResult>((resolve, reject) => {
            resolveTile = resolve;
            signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      };
      const layer = createOsmBuildingLayer({ origin: ORIGIN, source });
      const seen: OsmBuildingStatus[] = [];
      layer.onStatusChange((status) => seen.push(status));

      const pending = layer.load();
      layer.setEnabled(false);
      await pending;

      expect(layer.getStatus()).toBe("off");
      expect(seen).toEqual(["loading", "off"]);
      expect(layer.group.children).toHaveLength(0);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
      void resolveTile;
    });

    it("setEnabled(true) while off starts a fresh load; setEnabled(true) after failed retries with a fresh controller", async () => {
      const signals: (AbortSignal | undefined)[] = [];
      const source: OsmDataSource = {
        attribution: "test",
        sourceId: "fake-retry",
        fetchTile: (_tile, signal) => {
          signals.push(signal);
          return Promise.reject(new Error("down"));
        },
      };
      const layer = createOsmBuildingLayer({
        origin: ORIGIN,
        source,
        enabled: false,
      });

      expect(layer.getStatus()).toBe("off");
      layer.setEnabled(true);
      await vi.waitFor(() => expect(layer.getStatus()).toBe("failed"));
      expect(signals).toHaveLength(1);

      layer.setEnabled(true); // retry after failure
      await vi.waitFor(() => expect(signals).toHaveLength(2));
      expect(signals[1]!.aborted).toBe(false);
    });

    it("setEnabled(true) while idle/loading/loaded is a no-op (no second fetch, no duplicate meshes)", async () => {
      let calls = 0;
      const source: OsmDataSource = {
        attribution: "test",
        sourceId: "fake-count",
        fetchTile: () => {
          calls += 1;
          return Promise.resolve(tileResult([BUILDING_FEATURE]));
        },
      };
      const layer = createOsmBuildingLayer({ origin: ORIGIN, source });

      layer.setEnabled(true); // idle: no-op
      await layer.load();
      expect(calls).toBe(1);

      layer.setEnabled(true); // loaded: no-op
      await layer.load(); // second load() is also a no-op from "loaded"
      expect(calls).toBe(1);
      expect(
        layer.group.children.filter((child) => child instanceof Mesh),
      ).toHaveLength(1);
    });

    it("setEnabled(false) after a completed load hides the group instead of disposing it; setEnabled(true) shows it again with no re-fetch", async () => {
      let calls = 0;
      const source: OsmDataSource = {
        attribution: "test",
        sourceId: "fake-cache",
        fetchTile: () => {
          calls += 1;
          return Promise.resolve(tileResult([BUILDING_FEATURE]));
        },
      };
      const layer = createOsmBuildingLayer({ origin: ORIGIN, source });
      const seen: OsmBuildingStatus[] = [];
      layer.onStatusChange((status) => seen.push(status));

      await layer.load();
      expect(calls).toBe(1);
      const meshCount = layer.group.children.filter(
        (child) => child instanceof Mesh,
      ).length;
      expect(meshCount).toBeGreaterThan(0);

      layer.setEnabled(false);
      expect(layer.getStatus()).toBe("off");
      expect(layer.group.visible).toBe(false);
      // The meshes are still there — only hidden, not disposed.
      expect(
        layer.group.children.filter((child) => child instanceof Mesh),
      ).toHaveLength(meshCount);

      layer.setEnabled(true);
      expect(layer.getStatus()).toBe("loaded");
      expect(layer.group.visible).toBe(true);
      expect(calls).toBe(1); // no re-fetch
      expect(seen).toEqual(["loading", "loaded", "off", "loaded"]);
    });

    it("setEnabled(false) while already off emits nothing", () => {
      const layer = createOsmBuildingLayer({
        origin: ORIGIN,
        source: resolvingSource([]),
        enabled: false,
      });
      const seen: OsmBuildingStatus[] = [];
      layer.onStatusChange((status) => seen.push(status));

      layer.setEnabled(false);

      expect(seen).toEqual([]);
      expect(layer.getStatus()).toBe("off");
    });

    it("off -> on while the first fetch is still pending: only the second run's result lands (resolve variant)", async () => {
      const resolvers: ((result: OsmTileResult) => void)[] = [];
      const source: OsmDataSource = {
        attribution: "test",
        sourceId: "fake-stale-resolve",
        fetchTile: () =>
          new Promise<OsmTileResult>((resolve) => {
            resolvers.push(resolve);
          }),
      };
      const layer = createOsmBuildingLayer({ origin: ORIGIN, source });
      const seen: OsmBuildingStatus[] = [];
      layer.onStatusChange((status) => seen.push(status));

      const first = layer.load();
      layer.setEnabled(false);
      layer.setEnabled(true);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The stale first run settles late with a feature; must be discarded.
      resolvers[0]!(tileResult([BUILDING_FEATURE]));
      await first;
      // The second (current) run settles empty.
      resolvers[1]!(tileResult([]));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(layer.getStatus()).toBe("loaded");
      expect(layer.group.children).toHaveLength(0);
      expect(seen).toEqual(["loading", "off", "loading", "loaded"]);
    });

    it("off -> on while the first fetch is still pending: a late rejection from the stale run is discarded (reject variant)", async () => {
      const rejecters: ((error: unknown) => void)[] = [];
      const source: OsmDataSource = {
        attribution: "test",
        sourceId: "fake-stale-reject",
        fetchTile: () =>
          new Promise<OsmTileResult>((_resolve, reject) => {
            rejecters.push(reject);
          }),
      };
      const layer = createOsmBuildingLayer({ origin: ORIGIN, source });

      const first = layer.load();
      layer.setEnabled(false);
      layer.setEnabled(true);
      await new Promise((resolve) => setTimeout(resolve, 0));

      rejecters[0]!(new Error("late failure from stale run"));
      await first;

      expect(layer.getStatus()).toBe("loading"); // the second run is still pending
      rejecters[1]!(new Error("current run fails for real"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(layer.getStatus()).toBe("failed");
    });

    it("dispose() mid-fetch emits no status event and drops listeners", async () => {
      let resolveTile!: (result: OsmTileResult) => void;
      const source: OsmDataSource = {
        attribution: "test",
        sourceId: "fake-dispose-status",
        fetchTile: () =>
          new Promise<OsmTileResult>((resolve) => {
            resolveTile = resolve;
          }),
      };
      const layer = createOsmBuildingLayer({ origin: ORIGIN, source });
      const seen: OsmBuildingStatus[] = [];
      layer.onStatusChange((status) => seen.push(status));

      const pending = layer.load();
      layer.dispose();
      resolveTile(tileResult([BUILDING_FEATURE]));
      await pending;

      expect(seen).toEqual(["loading"]);
    });

    it("a retry after a partial load ends with exactly one copy of the meshes", async () => {
      let resolveFirst!: (result: OsmTileResult) => void;
      let call = 0;
      const source: OsmDataSource = {
        attribution: "test",
        sourceId: "fake-retry-clears",
        fetchTile: () => {
          call += 1;
          if (call === 1) {
            return new Promise<OsmTileResult>((resolve) => {
              resolveFirst = resolve;
            });
          }
          return Promise.resolve(tileResult([BUILDING_FEATURE]));
        },
      };
      const layer = createOsmBuildingLayer({ origin: ORIGIN, source });

      const pending = layer.load();
      layer.setEnabled(false);
      resolveFirst(tileResult([BUILDING_FEATURE]));
      await pending;
      expect(layer.group.children).toHaveLength(0);

      layer.setEnabled(true);
      await vi.waitFor(() => expect(layer.getStatus()).toBe("loaded"));

      expect(
        layer.group.children.filter((child) => child instanceof Mesh),
      ).toHaveLength(1);
    });
  });
});
