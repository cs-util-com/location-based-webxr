/**
 * A city's data, planned and loaded in ONE place for every consumer: which
 * Overpass tiles (per scoring ring, inner first), which height tiles, one
 * cached Overpass source, and a loader that delivers the city after its
 * first ring and again as the rest arrives.
 *
 * WHY IT IS HERE (round-4 plan 2026-10-11-0122 §5, the owner's question "why
 * can our demo run different logic than the OSM demo?"). OsmDemo and the
 * globe lab each derived "which tiles" and "which heights" themselves: the
 * demo's arrival plan, the globe worker's working set, two source
 * constructions and two height definitions (z13 from two sources against z12
 * from one), and the globe's warm-up warmed heights its city never read
 * (validation finding F6). One plan, one loader and one source factory here
 * means a consumer's warm-up and its build ask for the same data by
 * construction, and the next consumer gets the same behaviour for free.
 *
 * WHAT THE LOADER DOES, and why each part:
 * - the tiles and the heights load SIDE BY SIDE (OsmDemo loads its terrain
 *   beside its refresh; one after the other paid both waits in full);
 * - the city is delivered after the FIRST ring (`firstRings`), then again
 *   with the rest: OsmDemo draws its first ring first, and the inner ring is
 *   usually one tile where the widest is up to three, each 15-90 s cold;
 * - a height tile has a DEADLINE (`heightDeadlineMs`, the provider's own
 *   `requestTimeoutMs`): a request that never answers is a gap, not a wait
 *   without end;
 * - a tile that failed or was rate-limited, and a height that is missing,
 *   are asked for AGAIN after each of `retryDelaysMs`, and the city is
 *   delivered again with what arrived, so a passing failure costs a delay,
 *   not the place's city for the session;
 * - NOTHING is delivered while any height is missing: the field fills a gap
 *   with the window's mean, which would stand buildings tens of metres
 *   (kilometres in the Alps) off the ground (r790 milestone review F5).
 *
 * @see city-data.ts.md
 */

import { latLngToCell } from "h3-js";

import {
  TERRAIN_EXTENT_M,
  TERRAIN_SPACING_M,
  heightfieldFrom,
} from "../elevation/heightfield.js";
import {
  createTerrainField,
  latticeWindow,
} from "../elevation/terrain-field.js";
import {
  terrainWindowFor,
  type TerrainWindow,
} from "../elevation/terrain-window.js";
import {
  TerrariumProvider,
  fromWorldPixel,
  toTilePixel,
  type PngDecoder,
} from "../elevation/terrarium.js";
import { cityGround, type CityGround } from "../mesh/city.js";
import { ENU_METRES_PER_DEG_LNG_EQUATOR } from "../mesh/enu.js";
import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import { loadTiles } from "../source/area-loader.js";
import { CachingSource } from "../source/caching-source.js";
import type { OsmBlobStore } from "../source/osm-blob-store.js";
import type {
  OsmDataSource,
  OsmTileResult,
} from "../source/osm-data-source.js";
import { OverpassSource } from "../source/overpass-source.js";
import { mergeTiles } from "../spatial/merge-tiles.js";
import {
  PROGRESSIVE_RADII,
  SCORE_CHUNK_RES,
  fetchTilesForScoreWorkingSet,
} from "../spatial/resolutions.js";
import { cityLoadProgress, type CityLoadCounts } from "./city-progress.js";

/** The deepest zoom Terrarium tiles exist at. */
const MAX_HEIGHT_ZOOM = 15;

/** Where a city's heights come from: Terrarium-encoded tiles at one zoom. */
export interface CityHeights {
  /**
   * URL templates with `{z}`, `{x}` and `{y}`. More than one: the arms of a
   * race, every one planned (a warm-up warms them all); a loader reads one.
   */
  readonly urlTemplates: readonly string[];
  /** The tiles' zoom, an integer 0-15. */
  readonly zoom: number;
}

/** One scoring ring: its radius and the Overpass tiles it ADDS. */
export interface CityRing {
  readonly radius: number;
  readonly tiles: readonly string[];
}

/** What a city at a place needs: its tiles and its heights. */
export interface CityDataPlan {
  readonly target: LatLng;
  readonly heights: CityHeights;
  /** Inner ring first; each lists only the tiles no inner ring has. */
  readonly rings: readonly CityRing[];
  /** Every ring's tiles, each once, in ring order. */
  readonly overpassTiles: readonly string[];
  /** Every height tile URL of the window, every template, each once. */
  readonly heightUrls: readonly string[];
  /** The terrain window the heights cover (`terrainWindowFor` at the target). */
  readonly window: TerrainWindow;
}

export interface CityDataPlanOptions {
  readonly heights: CityHeights;
  /**
   * The scoring rings, strictly ascending positive integers. Default
   * `PROGRESSIVE_RADII`, the rings OsmDemo's refresh cycle scores.
   */
  readonly radii?: readonly number[];
}

function requireTarget(target: LatLng): void {
  const { lat, lng } = target;
  if (
    !(Number.isFinite(lat) && Number.isFinite(lng)) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    throw new RangeError(
      `cityDataPlan: the target must be a latitude and longitude, got ${lat}, ${lng}`,
    );
  }
}

function requireHeights(heights: CityHeights): void {
  const { zoom, urlTemplates } = heights;
  if (!(Number.isInteger(zoom) && zoom >= 0 && zoom <= MAX_HEIGHT_ZOOM)) {
    throw new RangeError(
      `cityDataPlan: the height zoom must be an integer 0-${MAX_HEIGHT_ZOOM}, got ${zoom}`,
    );
  }
  if (urlTemplates.length === 0) {
    throw new RangeError("cityDataPlan: at least one height URL template");
  }
  for (const template of urlTemplates) {
    if (!["{z}", "{x}", "{y}"].every((part) => template.includes(part))) {
      throw new RangeError(
        `cityDataPlan: a height URL template needs {z}, {x} and {y}, got ${template}`,
      );
    }
  }
}

function requireRadii(radii: readonly number[]): void {
  if (radii.length === 0) {
    throw new RangeError("cityDataPlan: at least one ring");
  }
  let previous = 0;
  for (const radius of radii) {
    if (!(Number.isInteger(radius) && radius > previous)) {
      throw new RangeError(
        `cityDataPlan: rings must be ascending positive integers, got ${radii.join(", ")}`,
      );
    }
    previous = radius;
  }
}

/**
 * The tile indices one axis of the lattice window touches, by the same round
 * trip the provider makes (`fromWorldPixel`, then `toTilePixel`). The axes
 * are separable: longitude depends only on x, latitude only on y.
 */
function tilesAlong(
  axis: "x" | "y",
  from: number,
  to: number,
  other: number,
  zoom: number,
): number[] {
  const tiles = new Set<number>();
  for (let v = from; v <= to; v++) {
    const pixel = axis === "x" ? { x: v, y: other } : { x: other, y: v };
    tiles.add(toTilePixel(fromWorldPixel(pixel, zoom), zoom)[axis]);
  }
  return [...tiles].sort((a, b) => a - b);
}

/** Every height tile URL a fresh field fetches for `window`, per template. */
function heightUrlsFor(window: TerrainWindow, heights: CityHeights): string[] {
  const { zoom } = heights;
  const { origin, reach } = latticeWindow(
    window.fetchCentre,
    window.fetchRadiusM,
    zoom,
  );
  const xs = tilesAlong(
    "x",
    origin.x - reach,
    origin.x + reach,
    origin.y,
    zoom,
  );
  const ys = tilesAlong(
    "y",
    origin.y - reach,
    origin.y + reach,
    origin.x,
    zoom,
  );
  const urls: string[] = [];
  for (const template of heights.urlTemplates) {
    for (const x of xs) {
      for (const y of ys) {
        urls.push(
          template
            .replace("{z}", String(zoom))
            .replace("{x}", String(x))
            .replace("{y}", String(y)),
        );
      }
    }
  }
  return urls;
}

/**
 * The plan for a city at `target`. Pure. RangeError for a target that is not
 * a latitude and longitude, a height zoom that is not an integer 0-15, no
 * height template or one without `{z}`, `{x}` and `{y}`, and rings that are
 * not strictly ascending positive integers.
 */
export function cityDataPlan(
  target: LatLng,
  options: CityDataPlanOptions,
): CityDataPlan {
  requireTarget(target);
  requireHeights(options.heights);
  const radii = options.radii ?? PROGRESSIVE_RADII;
  requireRadii(radii);
  const chunk = latLngToCell(target.lat, target.lng, SCORE_CHUNK_RES);
  const seen = new Set<string>();
  const rings = radii.map((radius) => {
    const tiles = fetchTilesForScoreWorkingSet(chunk, radius).filter(
      (tile) => !seen.has(tile),
    );
    for (const tile of tiles) seen.add(tile);
    return { radius, tiles };
  });
  const window = terrainWindowFor({
    frameOrigin: target,
    centre: target,
    extentM: TERRAIN_EXTENT_M,
  });
  return {
    target: { lat: target.lat, lng: target.lng },
    heights: options.heights,
    rings,
    overpassTiles: rings.flatMap((ring) => ring.tiles),
    heightUrls: heightUrlsFor(window, options.heights),
    window,
  };
}

/**
 * The cached Overpass source a city loads through: the race of the
 * library's endpoints (`OverpassSource`) behind the persistent store. ONE
 * construction for every consumer; `userAgent` is each app's own (the OSM
 * convention), `fetchImpl` the network seam.
 */
export function createCityTileSource(
  store: OsmBlobStore,
  options: { readonly userAgent: string; readonly fetchImpl?: typeof fetch },
): CachingSource {
  return new CachingSource(
    new OverpassSource({
      userAgent: options.userAgent,
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
    }),
    store,
  );
}

// --- loading ----------------------------------------------------------------

/** One delivery of a city's data. */
export interface CityData {
  /**
   * `first`: after the first rings, more to come; `full`: every ring tried;
   * `retry`: again, after a retry brought something new.
   */
  readonly stage: "first" | "full" | "retry";
  /** The features of every tile loaded so far, merged. */
  readonly features: readonly OsmFeature[];
  /** The frame at the target and the heights under it (`buildCity`'s input). */
  readonly ground: CityGround;
  /** The height at the target, metres (the tiles' datum plus the option's). */
  readonly groundM: number;
  readonly tiles: {
    readonly loaded: number;
    /** Tiles of the delivered rings still missing (failed or deferred). */
    readonly missing: readonly string[];
  };
}

export interface CityLoadReport {
  readonly outcome: "settled" | "aborted";
  readonly counts: CityLoadCounts;
  /** Tiles still missing when it ended. */
  readonly missingTiles: readonly string[];
  /** Height posts still missing when it ended (0: the heights are whole). */
  readonly missingHeights: number;
  readonly elapsedMs: number;
}

export interface CityLoad {
  /** 0 to 1 (`cityLoadProgress`): 1 once every job was tried once. */
  progress(): number;
  counts(): CityLoadCounts;
  /** True once it settled or was aborted. */
  readonly done: boolean;
  /**
   * Resolves once every job was tried once (`settled`), before any retry,
   * or at an abort; never rejects. What a flight waits for: a retry is not
   * worth holding a camera for.
   */
  readonly firstPass: Promise<CityLoadReport>;
  /** Resolves once, after the retries too; never rejects. */
  readonly finished: Promise<CityLoadReport>;
  /** Stops every request and retry; nothing is delivered after it. */
  abort(): void;
}

export interface CityLoadOptions {
  /** The tiles' source (`createCityTileSource`, or any `OsmDataSource`). */
  readonly source: OsmDataSource;
  /** The height tiles' network (e.g. `createCachingTileFetch({ store })`). */
  readonly heightFetch: typeof fetch;
  readonly decodePng: PngDecoder;
  /** Each delivery; never called after an abort. */
  readonly onData: (data: CityData) => void;
  /** After each settled job, with the counts and the progress. */
  readonly onProgress?: (counts: CityLoadCounts, progress: number) => void;
  readonly signal?: AbortSignal;
  /** Rings loaded before the first delivery, at least 1. Default 1. */
  readonly firstRings?: number;
  /**
   * How long one height tile may take, ms (the provider's
   * `requestTimeoutMs`). Default 20,000; `Infinity` waits without end.
   */
  readonly heightDeadlineMs?: number;
  /** Pauses before each retry, ms. Default 10 s, 30 s, 60 s. */
  readonly retryDelaysMs?: readonly number[];
  /**
   * The geoid undulation added to the tiles' heights (`absoluteDatum`).
   * Default 0: the heights as the tiles give them, the globe relief's
   * convention.
   */
  readonly undulationMetres?: number;
  /** The pause (a test seam). Default a timer that an abort cuts short. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const DEFAULT_HEIGHT_DEADLINE_MS = 20_000;
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [10_000, 30_000, 60_000];

/** Metres between height posts: the zoom's pixel, never under 12 m. */
function spacingAt(lat: number, zoom: number): number {
  const pixelM =
    (ENU_METRES_PER_DEG_LNG_EQUATOR * 360 * Math.cos((lat * Math.PI) / 180)) /
    (256 * 2 ** zoom);
  return Math.max(TERRAIN_SPACING_M, pixelM);
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

/** How one job ended, as the counts know it. */
type JobState = "warm" | "fetched" | "failed";

/**
 * Counts for one kind of job, keyed by job: each job counted once, and moved
 * from one state to another (a retry that fills a failed job) rather than
 * counted twice.
 */
function jobTally(total: number, changed: () => void) {
  const counts = { total, warm: 0, fetched: 0, failed: 0 };
  const states = new Map<string, JobState>();
  return {
    counts,
    settle(job: string, state: JobState): void {
      const before = states.get(job);
      if (before === state) return;
      if (before !== undefined) counts[before] -= 1;
      counts[state] += 1;
      states.set(job, state);
      changed();
    },
  };
}

/** The one height source a loader reads, and its first rings; or a RangeError. */
function requireLoadable(
  plan: CityDataPlan,
  options: CityLoadOptions,
): { urlTemplate: string; firstRings: number } {
  const [urlTemplate, ...others] = plan.heights.urlTemplates;
  if (urlTemplate === undefined || others.length > 0) {
    throw new RangeError(
      `loadCityData: reads one height source, the plan has ${plan.heights.urlTemplates.length}`,
    );
  }
  const firstRings = options.firstRings ?? 1;
  if (!(Number.isInteger(firstRings) && firstRings >= 1)) {
    throw new RangeError(
      `loadCityData: firstRings must be a positive integer, got ${firstRings}`,
    );
  }
  return { urlTemplate, firstRings };
}

/** A fetch that settles each height URL in `settle` (unless aborted). */
function countingFetch(
  inner: typeof fetch,
  settle: (url: string, state: JobState) => void,
  signal: AbortSignal,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      input instanceof Request
        ? input.url
        : typeof input === "string"
          ? input
          : input.href;
    try {
      const response = await inner(input, init);
      const hit = response.headers.get("x-tile-cache") === "hit";
      if (response.status === 200) settle(url, hit ? "warm" : "fetched");
      else if (!signal.aborted) settle(url, "failed");
      return response;
    } catch (error) {
      if (!signal.aborted) settle(url, "failed");
      throw error;
    }
  };
}

/** The heights of a plan's window, loaded and sampled; whole or not at all. */
function cityHeights(
  plan: CityDataPlan,
  urlTemplate: string,
  options: CityLoadOptions,
  settle: (url: string, state: JobState) => void,
  signal: AbortSignal,
) {
  const zoom = plan.heights.zoom;
  const deadline = options.heightDeadlineMs ?? DEFAULT_HEIGHT_DEADLINE_MS;
  const field = createTerrainField({
    provider: new TerrariumProvider({
      decodePng: options.decodePng,
      fetchImpl: countingFetch(options.heightFetch, settle, signal),
      urlTemplate,
      zoom,
      ...(Number.isFinite(deadline) ? { requestTimeoutMs: deadline } : {}),
    }),
    zoom,
  });
  const state = {
    missing: Infinity,
    ground: undefined as CityGround | undefined,
    groundM: 0,
  };
  /** Loads what is missing; true once the heights are whole. */
  const load = async (): Promise<boolean> => {
    if (state.ground !== undefined) return true;
    await field.ensureAround(
      plan.window.fetchCentre,
      plan.window.fetchRadiusM,
      signal,
    );
    const heights = field.sampleGrid({
      frame: plan.window.frame,
      extentM: TERRAIN_EXTENT_M,
      spacingM: spacingAt(plan.target.lat, zoom),
      centreEnu: plan.window.sampleCentreEnu,
      absoluteDatum: { undulationMetres: options.undulationMetres ?? 0 },
    });
    // A MEAN-FILLED post is missing too: when some tiles of a batch answer,
    // the field fills the others' posts with their mean and counts them as
    // held, so `missing` alone reads 0 over a failed tile (found 2026-10-11;
    // the globe worker's own guard had the same gap).
    state.missing =
      (heights.hasData ? heights.missing : heights.total) +
      field.meanFilledCount;
    if (state.missing > 0) return false;
    const heightfield = heightfieldFrom(heights);
    state.ground = cityGround(plan.window.frame, heightfield);
    state.groundM = heightfield.heightAt(plan.window.frame.toEnu(plan.target));
    return true;
  };
  return { state, load };
}

/** The tiles of a plan, loaded one at a time; what is in and what is missing. */
function cityTiles(
  source: OsmDataSource,
  settle: (tile: string, state: JobState) => void,
  signal: AbortSignal,
) {
  const results = new Map<string, OsmTileResult>();
  const missing = new Set<string>();
  /** One tile through the library's one tile path (`loadTiles`). */
  const load = async (tile: string): Promise<void> => {
    const area = await loadTiles(source, [tile], {
      signal,
      onRateLimit: "skip",
    });
    const result = area.loaded[0];
    if (result === undefined) {
      missing.add(tile);
      settle(tile, "failed");
      return;
    }
    results.set(tile, result);
    missing.delete(tile);
    settle(tile, result.timings?.servedBy === "cache" ? "warm" : "fetched");
  };
  return { results, missing, load };
}

/**
 * Loads the city's data of `plan` and delivers it through `onData`: after the
 * first rings, after every ring, and after any retry that brought something
 * new. Never throws once started; `finished` always resolves. RangeError,
 * at the call, for a plan of more than one height source (a loader reads
 * one; a race's arms are for a warm-up) and for `firstRings` below 1.
 */
export function loadCityData(
  plan: CityDataPlan,
  options: CityLoadOptions,
): CityLoad {
  const { urlTemplate, firstRings } = requireLoadable(plan, options);
  const startedAt = now();
  const controller = new AbortController();
  const signal = controller.signal;
  let outcome: CityLoadReport["outcome"] | undefined;
  let frozen = 0;
  const changed = (): void => {
    if (outcome === undefined) options.onProgress?.(snapshot(), progress());
  };
  const tileJobs = jobTally(plan.overpassTiles.length, changed);
  const heightJobs = jobTally(plan.heightUrls.length, changed);
  const snapshot = (): CityLoadCounts => ({
    overpass: { ...tileJobs.counts },
    dem: { ...heightJobs.counts },
  });
  const progress = (): number =>
    outcome === "aborted" ? frozen : cityLoadProgress(snapshot());
  const heights = cityHeights(
    plan,
    urlTemplate,
    options,
    (url, state) => heightJobs.settle(url, state),
    signal,
  );
  const tiles = cityTiles(
    options.source,
    (tile, state) => tileJobs.settle(tile, state),
    signal,
  );

  let delivered = -1;
  /** Delivers when the heights are whole and something new arrived. */
  const deliver = (stage: CityData["stage"]): void => {
    const { ground, groundM } = heights.state;
    const size = tiles.results.size;
    if (outcome !== undefined || ground === undefined) return;
    if (size === 0 || size === delivered) return;
    delivered = size;
    options.onData({
      stage,
      features: [...mergeTiles([...tiles.results.values()]).features.values()],
      ground,
      groundM,
      tiles: { loaded: size, missing: [...tiles.missing] },
    });
  };

  const report = (result: CityLoadReport["outcome"]): CityLoadReport => {
    const missingHeights = heights.state.missing;
    return {
      outcome: result,
      counts: snapshot(),
      missingTiles: [...tiles.missing],
      missingHeights: Number.isFinite(missingHeights) ? missingHeights : 0,
      elapsedMs: Math.max(0, now() - startedAt),
    };
  };
  let resolveFirstPass!: (report: CityLoadReport) => void;
  const firstPass = new Promise<CityLoadReport>((resolve) => {
    resolveFirstPass = resolve;
  });
  let resolveFinished!: (report: CityLoadReport) => void;
  const finished = new Promise<CityLoadReport>((resolve) => {
    resolveFinished = resolve;
  });
  const finish = (result: CityLoadReport["outcome"]): void => {
    if (outcome !== undefined) return;
    frozen = progress();
    outcome = result;
    const last = report(result);
    resolveFirstPass(last);
    resolveFinished(last);
  };

  const run = async (): Promise<void> => {
    const heightsReady = heights.load();
    // Awaited below; until then a rejection (an abort) must not read as
    // unhandled.
    heightsReady.catch(() => undefined);
    const firstTiles = plan.rings.slice(0, firstRings).flatMap((r) => r.tiles);
    const restTiles = plan.rings.slice(firstRings).flatMap((r) => r.tiles);
    for (const tile of firstTiles) await tiles.load(tile);
    await heightsReady;
    if (restTiles.length > 0) deliver("first");
    for (const tile of restTiles) await tiles.load(tile);
    deliver("full");
    resolveFirstPass(report("settled"));
    await retry();
  };
  /** Asks again for what is missing after each pause, until nothing is. */
  const retry = async (): Promise<void> => {
    const sleep = options.sleep ?? defaultSleep;
    for (const pause of options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS) {
      if (tiles.missing.size === 0 && heights.state.ground !== undefined)
        return;
      await sleep(pause, signal);
      if (signal.aborted) return;
      for (const tile of [...tiles.missing]) await tiles.load(tile);
      await heights.load();
      deliver("retry");
    }
  };

  const abort = (): void => {
    if (outcome !== undefined) return;
    finish("aborted");
    controller.abort();
  };
  if (options.signal?.aborted === true) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  if (outcome === undefined) {
    void run().then(
      () => finish("settled"),
      (error: unknown) => {
        // An abort ends the run by throwing out of the tile path; anything
        // else is a bug that must still not reach the caller.
        finish(isAbort(error) || signal.aborted ? "aborted" : "settled");
      },
    );
  }

  return {
    progress,
    counts: snapshot,
    get done() {
      return outcome !== undefined;
    },
    firstPass,
    finished,
    abort,
  };
}
