/**
 * The globe city's worker, as a core an app's worker shell wires to the
 * Osm library: one load at a time, the library's `loadCityData` for a
 * place on the relief's own heights, `buildCity` on each delivery, and
 * the replies `globe-city.ts` reads. The library is handed in (`osm`), so
 * this package needs no dependency on it, and the core runs under a unit
 * test without a worker. The design system's globe lab keeps its own
 * no-build copy (`labs/globe/globe-city-worker.js`) of the same protocol.
 *
 * @see globe-city-worker-core.ts.md
 */
import { cityHeights, type CityHeightsSpec } from "./globe-city-heights.js";

/** The mesh buffers of one built chunk (the library's `CityMeshChunk`). */
export interface CityWorkerChunk {
  readonly mesh: {
    readonly positions: { readonly buffer: ArrayBufferLike };
    readonly normals: { readonly buffer: ArrayBufferLike };
    readonly indices: { readonly buffer: ArrayBufferLike };
  };
  readonly colors?: { readonly buffer: ArrayBufferLike } | undefined;
  readonly height01?: { readonly buffer: ArrayBufferLike } | undefined;
  readonly featureRand?: { readonly buffer: ArrayBufferLike } | undefined;
}

/** What `loadCityData` hands `onData`: the parts this core reads. */
export interface CityWorkerDelivery {
  readonly stage: unknown;
  readonly features: readonly unknown[];
  readonly ground: unknown;
  readonly tiles: {
    readonly loaded: number;
    readonly missing: readonly unknown[];
  };
  readonly groundM: unknown;
}

/** A running load (the library's `loadCityData` result). */
export interface CityWorkerLoad {
  readonly firstPass: Promise<object>;
  readonly finished: Promise<{
    readonly outcome: string;
    readonly missingTiles: readonly unknown[];
    readonly missingHeights?: number;
  }>;
  abort(): void;
}

/**
 * The Osm library's city API, by the names it exports (method syntax: the
 * library's own parameter types are accepted).
 */
export interface CityWorkerOsm {
  readonly TERRAIN_EXTENT_M: number;
  readonly TERRARIUM_URL_TEMPLATE: string;
  cityDataPlan(
    target: { lat: number; lng: number },
    options: { heights: CityHeightsSpec },
  ): unknown;
  createCityTileSource(store: never, options: { userAgent: string }): unknown;
  createCachingTileFetch(options: { store: never }): unknown;
  browserPngDecoder(): unknown;
  loadCityData(
    plan: never,
    options: {
      source: never;
      heightFetch: never;
      decodePng: never;
      firstRings: number;
      onProgress: (
        counts: unknown,
        progress: unknown,
        landing: unknown,
      ) => void;
      onData: (data: CityWorkerDelivery) => void;
    },
  ): CityWorkerLoad;
  buildCity(
    features: never,
    ground: never,
    options: { withinM: number; roads: boolean },
  ): {
    readonly buildings: readonly CityWorkerChunk[];
    readonly trees: { readonly length: number };
    readonly roads: readonly CityWorkerChunk[];
    readonly volumes: readonly unknown[];
    readonly barriers: readonly unknown[];
    readonly roadCount: number;
  };
}

export interface CityWorkerDeps {
  /** The worker's `postMessage`, with the buffers to hand over. */
  post(message: unknown, transfer: ArrayBufferLike[]): void;
  /** The tile store (persistent, or in memory), opened once. */
  openStore(): Promise<unknown>;
  readonly osm: CityWorkerOsm;
  /** How the app identifies itself to the Overpass operators. */
  readonly userAgent: string;
  /** The clock of `buildMs` (default `performance.now`). */
  readonly now?: () => number;
}

export interface CityWorkerCore {
  /** One message from the page (`load` or `abort`; others are ignored). */
  handle(data: unknown): void;
}

/** The buffers a reply hands over rather than copies, each once. */
function transferables(chunks: readonly CityWorkerChunk[]): ArrayBufferLike[] {
  const out = new Set<ArrayBufferLike>();
  for (const chunk of chunks) {
    const m = chunk.mesh;
    out.add(m.positions.buffer).add(m.normals.buffer).add(m.indices.buffer);
    for (const a of [chunk.colors, chunk.height01, chunk.featureRand]) {
      if (a !== undefined) out.add(a.buffer);
    }
  }
  return [...out];
}

/** Why a load that ended built no city. */
function noCityMessage(report: Awaited<CityWorkerLoad["finished"]>): string {
  const heights = report.missingHeights ?? 0;
  return heights > 0
    ? `${heights} heights missing for the city's window (nothing is built)`
    : `no city data arrived (${report.missingTiles.length} tiles missing)`;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface LoadMessage {
  readonly id: unknown;
  readonly target: { lat: number; lng: number };
  readonly zoom: number;
  readonly heightsUrl?: string;
  readonly firstRings?: number;
}

export function createCityWorkerCore(deps: CityWorkerDeps): CityWorkerCore {
  const { osm, userAgent } = deps;
  const post: CityWorkerDeps["post"] = (message, transfer) => {
    deps.post(message, transfer);
  };
  const now = deps.now ?? (() => performance.now());
  let store: Promise<unknown> | null = null;
  let current: { id: unknown; load: CityWorkerLoad | null } | null = null;

  const start = async (
    id: unknown,
    target: { lat: number; lng: number },
    heights: CityHeightsSpec,
    firstRings: number,
  ) => {
    store ??= deps.openStore();
    const opened = (await store) as never;
    if (current?.id !== id) return; // superseded while the store opened
    const plan = osm.cityDataPlan(target, { heights }) as never;
    let built = false;
    const load = osm.loadCityData(plan, {
      source: osm.createCityTileSource(opened, { userAgent }) as never,
      heightFetch: osm.createCachingTileFetch({ store: opened }) as never,
      decodePng: osm.browserPngDecoder() as never,
      firstRings,
      onProgress: (counts, progress, landing) => {
        if (current?.id !== id) return;
        post({ id, kind: "progress", counts, progress, landing }, []);
      },
      onData: (data) => {
        if (current?.id !== id) return;
        const startedAt = now();
        const city = osm.buildCity(
          data.features as never,
          data.ground as never,
          {
            withinM: osm.TERRAIN_EXTENT_M,
            roads: true,
          },
        );
        built = true;
        post(
          {
            id,
            kind: "city",
            ok: true,
            stage: data.stage,
            buildings: city.buildings,
            trees: city.trees,
            roads: city.roads,
            counts: {
              features: data.features.length,
              tiles: data.tiles.loaded,
              missingTiles: data.tiles.missing.length,
              volumes: city.volumes.length,
              barriers: city.barriers.length,
              trees: city.trees.length,
              roads: city.roadCount,
              buildMs: Math.round(now() - startedAt),
            },
            groundM: data.groundM,
          },
          transferables([...city.buildings, ...city.roads]),
        );
      },
    });
    const mine = current;
    if (mine === null || mine.id !== id) {
      load.abort();
      return;
    }
    mine.load = load;
    void load.firstPass.then((pass) => {
      if (current?.id === id) post({ id, kind: "settled", ...pass }, []);
    });
    const report = await load.finished;
    if (current?.id !== id) return;
    if (!built && report.outcome === "settled") {
      post(
        {
          id,
          kind: "city",
          ok: false,
          message: noCityMessage(report),
        },
        [],
      );
    }
    post({ id, kind: "finished", ...report }, []);
  };

  const load = (message: LoadMessage) => {
    const { id, target, zoom, heightsUrl, firstRings } = message;
    current?.load?.abort();
    current = { id, load: null };
    let heights: CityHeightsSpec;
    try {
      if (!(Number.isFinite(target?.lat) && Number.isFinite(target?.lng))) {
        throw new RangeError(
          `a city needs a finite target, got ${JSON.stringify(target)}`,
        );
      }
      heights = cityHeights(zoom, heightsUrl ?? osm.TERRARIUM_URL_TEMPLATE);
    } catch (error) {
      current = null;
      post({ id, kind: "city", ok: false, message: messageOf(error) }, []);
      post({ id, kind: "finished", outcome: "invalid-target" }, []);
      return;
    }
    start(id, target, heights, firstRings ?? 1).catch((error: unknown) => {
      if (current?.id !== id) return;
      post({ id, kind: "city", ok: false, message: messageOf(error) }, []);
      post({ id, kind: "finished", outcome: "settled" }, []);
    });
  };

  return {
    handle(data) {
      if (typeof data !== "object" || data === null) return;
      const message = data as { kind?: unknown; id?: unknown };
      if (message.kind === "abort") {
        if (current !== null && current.id === message.id) {
          current.load?.abort();
          current = null;
        }
        return;
      }
      if (message.kind === "load") load(data as LoadMessage);
    },
  };
}
