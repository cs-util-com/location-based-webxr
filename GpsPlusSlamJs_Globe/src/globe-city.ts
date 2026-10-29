/**
 * The city in the globe's own scene (globe city plan 2026-10-05-0040 §12.5
 * C4, §14): loaded and built in a worker from the Osm library alone (the
 * lab's `globe-city-worker.js`), drawn through the library's
 * `gps-plus-slam-osm/three`, and placed on the globe's Earth-centred group
 * by `ecefFromCityAt` (the frame at the target, scaled from the library's
 * ruler to the true ellipsoid, R2), so a frame recentre moves nothing (R16).
 * Moved out of the globe lab as a pure refactor (editor-on-the-full-globe
 * plan, the city slice); the caller hands in the worker and the library's
 * three.js entry, so this package needs neither the lab's served routes nor
 * the Osm library.
 *
 * ONE LOAD IS THE WARM-UP AND THE BUILD (round-4 plan 2026-10-11-0122 §5):
 * `load(target)` starts the library's `loadCityData` in the worker and
 * returns a handle with the arrival prefetch's shape (`progress`, `stats`,
 * `finished`, `abort`, `done`), so the pin paces its flight on the city's own
 * data; the city is drawn after the first ring and replaced as the rest
 * arrives.
 *
 * It appears by a DITHERED fade (`alphaHash`, R17): a transparent fade would
 * reorder the city against the relief and the clouds; dithering keeps it
 * opaque, in the depth pass, with a share of its pixels drawn.
 *
 * @see globe-city.ts.md
 */
import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import { cityHeights } from "./globe-city-heights.js";
import { ecefFromCityAt } from "./globe-frame.js";
import type { LatLng } from "./globe-target.js";

/**
 * How long a city fades in once it arrives (ms). The build usually lands
 * after the dive, below the altitude fade's band, so without this the whole
 * city switched on in one frame (r790 milestone review F4).
 */
export const CITY_ARRIVAL_FADE_MS = 1500;

/** One job family's counts, as the worker reports them. */
export interface CityJobCounts {
  total: number;
  warm: number;
  fetched: number;
  failed: number;
}

/** The load's counts: the Overpass tiles and the height tiles. */
export interface CityLoadCounts {
  overpass: CityJobCounts;
  dem: CityJobCounts;
}

/** The part of the library's `gps-plus-slam-osm/three` the city uses. */
export interface GlobeCityThree {
  cityObjects(city: {
    buildings: unknown;
    trees: unknown;
    roads: unknown;
  }): THREE.Object3D[];
  disposeCityObjects(objects: Iterable<THREE.Object3D>): void;
}

/** The part of a module `Worker` the city uses. */
export type GlobeCityWorker = Pick<
  Worker,
  "addEventListener" | "postMessage" | "terminate"
>;

export interface GlobeCityOptions {
  /** The globe's Earth-centred group (its world matrix is the frame). */
  parent: THREE.Object3D;
  ellipsoid: Ellipsoid;
  /**
   * Makes the city's worker, on the first load and again after one
   * failed. The lab's: `new Worker("/w/labs/globe/globe-city-worker.js",
   * { type: "module" })` (a literal, so the lookdev builder finds it).
   */
  createWorker: () => GlobeCityWorker;
  /**
   * Loads the library's three.js entry, asked for with the first city
   * drawn (the lab's: `() => import("gps-plus-slam-osm/three")`, so its boot
   * graph stays free of the Osm library). Asked once; its promise is kept.
   */
  loadCityThree: () => Promise<GlobeCityThree>;
  /** Whether the roads are drawn (default true). */
  roads?: boolean;
  /** How far the roads are lifted along the city's up (m, default 2). */
  roadLiftM?: number;
  /** A polygon offset pulling the roads forward in depth (0, default: none). */
  roadOffset?: number;
  /**
   * The relief's height source (a `{z}/{x}/{y}` template), so the city
   * stands on the heights the ground is drawn from (G1 1d); the worker
   * reads AWS Terrarium without it. RangeError for one it cannot read.
   */
  heightsUrl?: string;
  /** The clock of the arrival fade (ms; default `performance.now`). */
  now?: () => number;
}

/** The current load as `state()` reports it. */
export interface GlobeCityLoadState {
  outcome: string | null;
  ended: boolean;
  stages: string[];
  counts: CityLoadCounts;
  progress: number;
}

/** `state()`: the city's phase and place, the last delivery, the fade. */
export interface GlobeCityState {
  phase: "idle" | "loading" | "ready" | "failed";
  target?: LatLng;
  stage?: string;
  counts?: unknown;
  groundM?: unknown;
  objects?: number;
  mainMs?: number;
  message?: string;
  fade: number;
  shown: number;
  load: GlobeCityLoadState | null;
}

/** What `finished` resolves with. */
export interface GlobeCityLoadReport {
  outcome: string;
  counts: CityLoadCounts;
  [key: string]: unknown;
}

/** The prefetch-shaped handle a flight paces on. */
export interface GlobeCityLoadHandle {
  progress(): number;
  readonly done: boolean;
  finished: Promise<GlobeCityLoadReport>;
  stats(): { counts: CityLoadCounts; inFlight: number; bytesStored: number };
  abort(): void;
}

export interface GlobeCity {
  /** The city's root (on the Earth-centred group). */
  readonly root: THREE.Group;
  /**
   * Loads and builds the city at `target`, its heights at the relief's
   * `zoom`, and returns a prefetch-shaped handle. The same place while its
   * load runs or has ended without an abort or a failure returns that
   * load's handle (no second load), unless `fresh` (a new flight: a new
   * load, which reads what is stored as warm); another place supersedes.
   * RangeError for a target that is not finite or a zoom that is not an
   * integer 1-15.
   */
  load(
    target: LatLng,
    options: { zoom: number; fresh?: boolean },
  ): GlobeCityLoadHandle;
  /** 0 hides the city, 1 draws it whole; between, a dithered share. */
  setFade(value: number): void;
  state(): GlobeCityState;
  dispose(): void;
}

/** A load's own state, behind its handle. */
interface CityLoad {
  id: number;
  key: string;
  counts: CityLoadCounts;
  progress: number;
  fullProgress?: number;
  frozen: number;
  outcome: string | null;
  ended: boolean;
  stages: string[];
  resolve: (report: GlobeCityLoadReport) => void;
  finished: Promise<GlobeCityLoadReport>;
}

/** A worker reply, as far as the city reads it (data from a worker). */
interface CityReply {
  id?: number;
  kind?: string;
  ok?: boolean;
  message?: string;
  counts?: unknown;
  progress?: number;
  landing?: number;
  outcome?: string;
  stage?: string;
  buildings?: unknown;
  trees?: unknown;
  roads?: unknown;
  groundM?: unknown;
}

const NO_JOBS: CityJobCounts = { total: 0, warm: 0, fetched: 0, failed: 0 };
const keyOf = (target: LatLng) => `${target.lat},${target.lng}`;

/** A material's dither and opacity for the shown share. */
function fadeMaterial(m: THREE.Material, shown: number): void {
  const dither = shown < 1;
  if (m.alphaHash !== dither) {
    m.alphaHash = dither;
    m.needsUpdate = true;
  }
  m.opacity = shown;
}

/**
 * An object's materials, one or many: every city object is a mesh (the
 * library's `cityObjects`).
 */
function materialsOf(object: THREE.Object3D): THREE.Material[] {
  const { material } = object as THREE.Mesh;
  return Array.isArray(material) ? material : [material];
}

/**
 * The roads lie on the library's heights, not on the relief's drawn mesh:
 * lifted along the city's up (scene y), and pulled forward. A road is one
 * mesh with one material.
 */
function placeRoad(o: THREE.Object3D, liftM: number, offset: number): void {
  if (o.userData.cityLayer !== "roads") return;
  o.position.y = liftM;
  if (offset > 0) {
    const material = (o as THREE.Mesh<THREE.BufferGeometry, THREE.Material>)
      .material;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -offset;
    material.polygonOffsetUnits = -offset;
  }
}

/** The target and zoom checked (RangeError). */
function checkLoad(target: LatLng, zoom: number): void {
  if (!(Number.isFinite(target?.lat) && Number.isFinite(target?.lng))) {
    throw new RangeError(
      `a city needs a finite target, got ${JSON.stringify(target)}`,
    );
  }
  if (!(Number.isInteger(zoom) && zoom >= 1 && zoom <= 15)) {
    throw new RangeError(`a city needs the relief's zoom, got ${zoom}`);
  }
}

/** A new load's state, its `finished` promise and its resolver. */
function newLoad(id: number, target: LatLng): CityLoad {
  let resolve: (report: GlobeCityLoadReport) => void = () => undefined;
  const finished = new Promise<GlobeCityLoadReport>((r) => {
    resolve = r;
  });
  return {
    id,
    key: keyOf(target),
    counts: { overpass: NO_JOBS, dem: NO_JOBS },
    progress: 0,
    frozen: 0,
    outcome: null,
    ended: false,
    stages: [],
    resolve,
    finished,
  };
}

/** Settles a load once (later calls do nothing). */
function settle(
  load: CityLoad,
  outcome: string,
  report: Record<string, unknown> = {},
): void {
  if (load.outcome !== null) return;
  load.frozen = load.progress;
  load.outcome = outcome;
  load.resolve({ outcome, counts: load.counts, ...report });
}

/**
 * The city on `parent` (`GlobeCityOptions`). RangeError for a
 * `heightsUrl` that is not a `{z}/{x}/{y}` template.
 */
export function createGlobeCity({
  parent,
  ellipsoid,
  createWorker,
  loadCityThree,
  roads = true,
  roadLiftM = 2,
  roadOffset = 0,
  heightsUrl,
  now = () => performance.now(),
}: GlobeCityOptions): GlobeCity {
  if (heightsUrl !== undefined) cityHeights(1, heightsUrl);
  const root = new THREE.Group();
  root.name = "globe-city";
  root.matrixAutoUpdate = false;
  parent.add(root);
  let cityThree: Promise<GlobeCityThree> | null = null;
  const three = () => (cityThree ??= loadCityThree());
  let worker: GlobeCityWorker | null = null;
  let requestId = 0;
  let objects: THREE.Object3D[] = [];
  let fade = 1;
  let arrivedAt = -Infinity;
  let shown = 0;
  let state: Omit<GlobeCityState, "fade" | "shown" | "load"> = {
    phase: "idle",
  };
  /** The current load's state (null before the first load). */
  let current: CityLoad | null = null;
  /** The place whose city is drawn (its arrival fade ran), as "lat,lng". */
  let drawnKey: string | null = null;

  /**
   * The building materials' dither, one call for every object: the
   * requested fade (the altitude's) times the arrival's.
   */
  const applyFade = () => {
    const arrival = Math.min(
      1,
      Math.max(0, (now() - arrivedAt) / CITY_ARRIVAL_FADE_MS),
    );
    shown = fade * arrival;
    for (const object of objects) {
      // Tree materials are shared with every later city: their fade is the
      // same number, so writing it there too is harmless and keeps them
      // fading with the buildings.
      for (const m of materialsOf(object)) fadeMaterial(m, shown);
    }
    root.visible = shown > 0 && objects.length > 0;
  };

  const clear = (lib: GlobeCityThree) => {
    for (const o of objects) root.remove(o);
    lib.disposeCityObjects(objects);
    objects = [];
  };

  /**
   * A failed load leaves no city drawn (an older place's city is not left
   * standing under a "failed" state, review F6).
   */
  const fail = (message: string) => {
    state = { ...state, phase: "failed", message };
    if (objects.length > 0) {
      void three().then((lib) => {
        clear(lib);
        applyFade();
      });
    }
  };

  /** A delivery turned into three.js objects on the root. */
  const drawCity = async (reply: CityReply, load: CityLoad) => {
    let lib: GlobeCityThree;
    try {
      lib = await three();
    } catch (error) {
      fail(String(error));
      return;
    }
    // A newer load may have started while the module loaded.
    if (reply.id !== requestId) return;
    const firstOfPlace = drawnKey !== load.key;
    drawnKey = load.key;
    clear(lib);
    const drawnAt = now();
    objects = lib.cityObjects({
      buildings: reply.buildings,
      trees: reply.trees,
      roads: roads ? reply.roads : [],
    });
    for (const o of objects) {
      placeRoad(o, roadLiftM, roadOffset);
      root.add(o);
    }
    const mainMs = now() - drawnAt;
    ecefFromCityAt(ellipsoid, state.target as LatLng, root.matrix);
    root.matrixWorldNeedsUpdate = true;
    // The arrival fade once per place; a later stage replaces in place.
    if (firstOfPlace) arrivedAt = now();
    applyFade();
    state = {
      ...state,
      phase: "ready",
      stage: reply.stage,
      counts: reply.counts,
      groundM: reply.groundM,
      objects: objects.length,
      mainMs: Math.round(mainMs),
    };
    load.stages.push(reply.stage as string);
  };

  /** A progress reply: the counts and the share the flight paces on. */
  const onProgress = (reply: CityReply, load: CityLoad) => {
    load.counts = reply.counts as CityLoadCounts;
    // The flight paces on the first delivery's jobs (DEC-AW-1): the outer
    // rings keep loading after the landing.
    load.progress = (reply.landing ?? reply.progress) as number;
    load.fullProgress = reply.progress;
  };

  /**
   * "settled" is the first pass; retries may still bring a new stage
   * until "finished".
   */
  const onSettled = (reply: CityReply, load: CityLoad) => {
    if (reply.kind === "finished") load.ended = true;
    if (reply.counts) load.counts = reply.counts as CityLoadCounts;
    load.progress = 1;
    settle(load, reply.outcome as string, reply as Record<string, unknown>);
  };

  const onMessage = (event: MessageEvent) => {
    const reply = event.data as CityReply | null | undefined;
    if (reply?.id !== requestId || current === null) return; // superseded
    const load = current;
    if (reply.kind === "progress") return onProgress(reply, load);
    if (reply.kind === "settled" || reply.kind === "finished") {
      return onSettled(reply, load);
    }
    if (reply.kind !== "city") return;
    if (!reply.ok) return fail(reply.message as string);
    void drawCity(reply, load);
  };

  /** The worker, made on the first load and after one failed. */
  const ensureWorker = (): GlobeCityWorker => {
    if (worker !== null) return worker;
    const made = createWorker();
    made.addEventListener("message", onMessage);
    // A worker that failed to load or crashed answers nothing again: it
    // goes, so the next load makes a new one (review F6).
    made.addEventListener("error", (e: ErrorEvent) => {
      made.terminate();
      if (worker === made) worker = null;
      fail(e.message || "the city's worker failed");
      if (current) {
        current.ended = true;
        settle(current, "unavailable");
      }
    });
    worker = made;
    return made;
  };

  /** A new load's state, its request posted. */
  const startLoad = (target: LatLng, zoom: number): CityLoad => {
    const w = ensureWorker();
    if (current && current.outcome === null) settle(current, "aborted");
    requestId += 1;
    current = newLoad(requestId, target);
    const at = { lat: target.lat, lng: target.lng };
    state = { phase: "loading", target: at };
    w.postMessage({
      kind: "load",
      id: requestId,
      target: at,
      zoom,
      heightsUrl,
    });
    return current;
  };

  /** The prefetch-shaped handle a flight paces on. */
  const handleOf = (load: CityLoad): GlobeCityLoadHandle => ({
    progress: () => (load.outcome === "aborted" ? load.frozen : load.progress),
    get done() {
      return load.outcome !== null;
    },
    finished: load.finished,
    stats: () => ({ counts: load.counts, inFlight: 0, bytesStored: 0 }),
    abort: () => {
      if (load.outcome !== null) return;
      settle(load, "aborted");
      if (worker && load.id === requestId) {
        worker.postMessage({ kind: "abort", id: load.id });
      }
    },
  });

  /** Whether `load` of `target` reuses the current load. */
  const reuses = (target: LatLng, fresh: boolean): boolean =>
    !fresh &&
    current !== null &&
    current.key === keyOf(target) &&
    current.outcome !== "aborted" &&
    current.outcome !== "unavailable" &&
    state.phase !== "failed";

  return {
    root,
    load(target, { zoom, fresh = false }) {
      checkLoad(target, zoom);
      const load =
        reuses(target, fresh) && current !== null
          ? current
          : startLoad(target, zoom);
      return handleOf(load);
    },
    setFade(value) {
      if (!(value >= 0 && value <= 1)) {
        throw new RangeError(`the fade must be 0-1, got ${value}`);
      }
      fade = value;
      applyFade();
    },
    state: () => ({
      ...state,
      fade,
      shown,
      load: current && {
        outcome: current.outcome,
        ended: current.ended,
        stages: [...current.stages],
        counts: current.counts,
        progress: current.progress,
      },
    }),
    dispose() {
      if (objects.length > 0) {
        void three().then((lib) => clear(lib));
      }
      parent.remove(root);
      worker?.terminate();
      worker = null;
    },
  };
}
