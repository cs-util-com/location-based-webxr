import { describe, expect, it } from "vitest";

import {
  createCityWorkerCore,
  type CityWorkerDeps,
} from "./globe-city-worker-core.js";

const TERRARIUM = "https://example.test/terrarium/{z}/{x}/{y}.png";
const RELIEF = "https://relief.test/{z}/{x}/{y}.png";

/** A promise with its resolve handed out. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A load's final report, as the library's `finished` resolves it. */
interface Report {
  outcome: string;
  missingTiles: unknown[];
  missingHeights?: number;
}

/** One building chunk with its own buffers (a mesh, colours). */
function chunk() {
  return {
    mesh: {
      positions: new Float32Array(9),
      normals: new Float32Array(9),
      indices: new Uint32Array(3),
    },
    colors: new Float32Array(9),
  };
}

/**
 * The Osm library's city API as recording fakes: each `loadCityData` is
 * kept with its options, so a test delivers data, settles the first pass
 * and finishes the load by hand.
 */
function fakes() {
  const posted: { message: Record<string, unknown>; transfer: unknown[] }[] =
    [];
  const loads: {
    plan: unknown;
    options: Record<string, unknown>;
    aborted: boolean;
    firstPass: ReturnType<typeof deferred<Record<string, unknown>>>;
    finished: ReturnType<typeof deferred<Report>>;
  }[] = [];
  const plans: { target: unknown; heights: unknown }[] = [];
  let stores = 0;
  const store = deferred<unknown>();
  const shared = chunk();
  const deps: CityWorkerDeps = {
    post: (message, transfer) => {
      posted.push({ message: message as Record<string, unknown>, transfer });
    },
    openStore: () => {
      stores++;
      return store.promise;
    },
    userAgent: "test-agent",
    now: () => 0,
    osm: {
      TERRAIN_EXTENT_M: 3000,
      TERRARIUM_URL_TEMPLATE: TERRARIUM,
      cityDataPlan: (target, options) => {
        plans.push({ target, heights: options.heights });
        return { target };
      },
      createCityTileSource: () => ({ source: true }),
      createCachingTileFetch: () => ({ fetch: true }),
      browserPngDecoder: () => ({ decode: true }),
      buildCity: () => ({
        buildings: [shared, chunk()],
        trees: [],
        roads: [shared],
        volumes: [1, 2, 3],
        barriers: [],
        roadCount: 1,
      }),
      loadCityData: (plan, options) => {
        const load = {
          plan,
          options: options as unknown as Record<string, unknown>,
          aborted: false,
          firstPass: deferred<Record<string, unknown>>(),
          finished: deferred<Report>(),
        };
        loads.push(load);
        return {
          firstPass: load.firstPass.promise,
          finished: load.finished.promise,
          abort: () => {
            load.aborted = true;
          },
        };
      },
    },
  };
  return {
    deps,
    posted,
    loads,
    plans,
    store,
    stores: () => stores,
    kinds: () =>
      posted.map(
        (p) => `${String(p.message["kind"])} ${String(p.message["id"])}`,
      ),
  };
}

/** Lets the queued promise reactions run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const MUNICH = { lat: 48.137, lng: 11.575 };

describe("createCityWorkerCore", () => {
  // Why: the city's whole conversation with the page. One load reads the
  // relief's own heights, delivers each built stage with its buffers
  // handed over (once each, a shared buffer too), then says when every job
  // was tried once and when it finished; each reply carries the load's id
  // so the page drops a superseded one.
  it("loads on the relief's heights and replies progress, city, settled and finished", async () => {
    const f = fakes();
    const core = createCityWorkerCore(f.deps);
    core.handle({
      kind: "load",
      id: 1,
      target: MUNICH,
      zoom: 12,
      heightsUrl: RELIEF,
    });
    f.store.resolve({ store: true });
    await settle();
    expect(f.plans[0]?.heights).toEqual({ urlTemplates: [RELIEF], zoom: 12 });
    const load = f.loads[0];
    if (!load) throw new Error("no load");
    expect(load.options["firstRings"]).toBe(1);
    (load.options["onProgress"] as (...a: unknown[]) => void)(
      { jobs: 1 },
      0.5,
      0.25,
    );
    (load.options["onData"] as (d: unknown) => void)({
      stage: "first",
      features: [{}, {}],
      ground: {},
      tiles: { loaded: 4, missing: ["t"] },
      groundM: 515.5,
    });
    load.firstPass.resolve({ outcome: "settled" });
    await settle();
    load.finished.resolve({
      outcome: "settled",
      missingTiles: [],
      missingHeights: 0,
    });
    await settle();
    expect(f.kinds()).toEqual([
      "progress 1",
      "city 1",
      "settled 1",
      "finished 1",
    ]);
    const city = f.posted[1];
    expect(city?.message["ok"]).toBe(true);
    expect(city?.message["groundM"]).toBe(515.5);
    expect(city?.message["counts"]).toMatchObject({
      features: 2,
      tiles: 4,
      missingTiles: 1,
      volumes: 3,
      roads: 1,
    });
    // Two chunks of three buffers plus a colour array, the shared one once.
    expect(city?.transfer).toHaveLength(8);
    expect(new Set(city?.transfer).size).toBe(8);
  });

  // Why: a new place supersedes the old load (stopped, its late replies
  // dropped), and the store is opened once for the worker's life.
  it("stops the load before for a new one and drops its late replies", async () => {
    const f = fakes();
    const core = createCityWorkerCore(f.deps);
    core.handle({ kind: "load", id: 1, target: MUNICH, zoom: 12 });
    f.store.resolve({});
    await settle();
    core.handle({ kind: "load", id: 2, target: MUNICH, zoom: 12 });
    await settle();
    expect(f.loads[0]?.aborted).toBe(true);
    expect(f.stores()).toBe(1);
    // Without a heightsUrl the worker reads AWS Terrarium.
    expect(f.plans[1]?.heights).toEqual({
      urlTemplates: [TERRARIUM],
      zoom: 12,
    });
    f.loads[0]?.finished.resolve({ outcome: "aborted", missingTiles: [] });
    f.loads[0]?.firstPass.resolve({ outcome: "aborted" });
    await settle();
    expect(f.kinds()).toEqual([]);
  });

  // Why: an abort stops only the load it names.
  it("aborts the named load only", async () => {
    const f = fakes();
    const core = createCityWorkerCore(f.deps);
    core.handle({ kind: "load", id: 1, target: MUNICH, zoom: 12 });
    f.store.resolve({});
    await settle();
    core.handle({ kind: "abort", id: 9 });
    expect(f.loads[0]?.aborted).toBe(false);
    core.handle({ kind: "abort", id: 1 });
    expect(f.loads[0]?.aborted).toBe(true);
  });

  // Why: a load superseded while the store opened never starts.
  it("starts nothing for a load superseded while the store opened", async () => {
    const f = fakes();
    const core = createCityWorkerCore(f.deps);
    core.handle({ kind: "load", id: 1, target: MUNICH, zoom: 12 });
    core.handle({ kind: "load", id: 2, target: MUNICH, zoom: 12 });
    f.store.resolve({});
    await settle();
    expect(f.loads).toHaveLength(1);
    expect(f.plans).toHaveLength(1);
  });

  // Why: no city stands on invented heights: a load that ended without a
  // delivery says why before it finishes.
  it("says why when a load ended without a city", async () => {
    const f = fakes();
    const core = createCityWorkerCore(f.deps);
    core.handle({ kind: "load", id: 3, target: MUNICH, zoom: 12 });
    f.store.resolve({});
    await settle();
    f.loads[0]?.finished.resolve({
      outcome: "settled",
      missingTiles: [],
      missingHeights: 4,
    });
    await settle();
    expect(f.kinds()).toEqual(["city 3", "finished 3"]);
    expect(f.posted[0]?.message).toMatchObject({
      ok: false,
      message: "4 heights missing for the city's window (nothing is built)",
    });
  });

  // Why: bad input from the page is answered, never thrown inside the
  // worker (where nobody would see it): a target that is not finite, a
  // zoom the heights cannot read, and a load that throws.
  it("answers a bad target, a bad zoom and a failing load", async () => {
    const f = fakes();
    const core = createCityWorkerCore(f.deps);
    core.handle({
      kind: "load",
      id: 1,
      target: { lat: NaN, lng: 0 },
      zoom: 12,
    });
    core.handle({ kind: "load", id: 2, target: MUNICH, zoom: 40 });
    expect(f.kinds()).toEqual(["city 1", "finished 1", "city 2", "finished 2"]);
    expect(f.posted[1]?.message["outcome"]).toBe("invalid-target");
    f.deps.osm.loadCityData = () => {
      throw new Error("no network");
    };
    core.handle({ kind: "load", id: 3, target: MUNICH, zoom: 12 });
    f.store.resolve({});
    await settle();
    expect(f.posted.slice(4).map((p) => p.message)).toEqual([
      { id: 3, kind: "city", ok: false, message: "no network" },
      { id: 3, kind: "finished", outcome: "settled" },
    ]);
  });

  // Why: anything that is not a load or an abort is ignored.
  it("ignores other messages", () => {
    const f = fakes();
    const core = createCityWorkerCore(f.deps);
    core.handle(null);
    core.handle("load");
    core.handle({ kind: "paint" });
    expect(f.posted).toEqual([]);
  });
});
