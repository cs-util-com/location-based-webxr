/**
 * The city in the globe's own scene (globe city plan 2026-10-05-0040 §12.5
 * C4, §14): loaded and built in `globe-city-worker.js` from the Osm library
 * alone, drawn through the library's `gps-plus-slam-osm/three`, and placed on
 * the globe's Earth-centred group by `ecefFromCityAt` (the frame at the
 * target, scaled from the library's ruler to the true ellipsoid, R2), so a
 * frame recentre moves nothing (R16).
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
 * @see globe-city.js.md
 */
import * as THREE from "three";

import { ecefFromCityAt } from "/globe/globe-frame.js";

import { cityHeights } from "./globe-city-heights.js";

/**
 * How long a city fades in once it arrives (ms). The build usually lands
 * after the dive, below the altitude fade's band, so without this the whole
 * city switched on in one frame (r790 milestone review F4).
 */
const ARRIVAL_FADE_MS = 1500;

/**
 * The library's three.js entry, loaded with the first city: the lab's boot
 * graph stays free of the Osm library (`build-lookdev.test.mjs` holds it to
 * that), so a page that never reaches a city never loads it.
 */
let cityThree = null;
const loadCityThree = () => (cityThree ??= import("gps-plus-slam-osm/three"));

const NO_JOBS = { total: 0, warm: 0, fetched: 0, failed: 0 };
const keyOf = (target) => `${target.lat},${target.lng}`;

/**
 * @param {{ parent: THREE.Object3D, ellipsoid: object,
 *   createWorker?: () => Worker, roads?: boolean, roadLiftM?: number,
 *   roadOffset?: number, heightsUrl?: string }} options
 *   `parent` the globe's Earth-centred group (its world matrix is the frame);
 *   `roads` whether the roads are drawn; `roadLiftM` how far they are lifted
 *   off the ground (metres, along the city's up); `roadOffset` a polygon
 *   offset pulling them forward in depth (0: none); `heightsUrl` the relief's
 *   height source (a `{z}/{x}/{y}` template), so the city stands on the
 *   heights the ground is drawn from (G1 1d); the worker reads AWS
 *   Terrarium without it. RangeError for a template it cannot read.
 */
export function createGlobeCity({
  parent,
  ellipsoid,
  // A LITERAL URL: the lookdev builder finds a worker by its literal string,
  // so a variable would leave the deployed preview without it. Through the
  // worker view (`/w/`): its modules import packages by name.
  createWorker = () =>
    new Worker("/w/labs/globe/globe-city-worker.js", { type: "module" }),
  roads = true,
  roadLiftM = 2,
  roadOffset = 0,
  heightsUrl,
}) {
  if (heightsUrl !== undefined) cityHeights(1, heightsUrl);
  const root = new THREE.Group();
  root.name = "globe-city";
  root.matrixAutoUpdate = false;
  parent.add(root);
  let worker = null;
  let requestId = 0;
  let objects = [];
  let fade = 1;
  let arrivedAt = -Infinity;
  let shown = 0;
  let state = { phase: "idle" };
  /** The current load's handle state (null before the first load). */
  let current = null;
  /** The place whose city is drawn (its arrival fade ran), as "lat,lng". */
  let drawnKey = null;

  /**
   * The building materials' dither, one call for every object: the
   * requested fade (the altitude's) times the arrival's.
   */
  const applyFade = () => {
    const arrival = Math.min(
      1,
      Math.max(0, (performance.now() - arrivedAt) / ARRIVAL_FADE_MS),
    );
    shown = fade * arrival;
    for (const object of objects) {
      // Tree materials are shared with every later city: their fade is the
      // same number, so writing it there too is harmless and keeps them
      // fading with the buildings.
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const m of materials) {
        const dither = shown < 1;
        if (m.alphaHash !== dither) {
          m.alphaHash = dither;
          m.needsUpdate = true;
        }
        m.opacity = shown;
      }
    }
    root.visible = shown > 0 && objects.length > 0;
  };

  const clear = (three) => {
    for (const o of objects) root.remove(o);
    three.disposeCityObjects(objects);
    objects = [];
  };

  /**
   * A failed load leaves no city drawn (an older place's city is not left
   * standing under a "failed" state, review F6).
   */
  const fail = (message) => {
    state = { ...state, phase: "failed", message };
    if (objects.length > 0) {
      void loadCityThree().then((three) => {
        clear(three);
        applyFade();
      });
    }
  };

  const settle = (load, outcome, report = {}) => {
    if (load.outcome !== null) return;
    load.frozen = load.progress;
    load.outcome = outcome;
    load.resolve({ outcome, counts: load.counts, ...report });
  };

  const drawCity = async (reply, load) => {
    let three;
    try {
      three = await loadCityThree();
    } catch (error) {
      fail(String(error));
      return;
    }
    // A newer load may have started while the module loaded.
    if (reply.id !== requestId) return;
    const firstOfPlace = drawnKey !== load.key;
    drawnKey = load.key;
    clear(three);
    const drawnAt = performance.now();
    objects = three.cityObjects({
      buildings: reply.buildings,
      trees: reply.trees,
      roads: roads ? reply.roads : [],
    });
    for (const o of objects) {
      // The roads lie on the library's heights, not on the relief's drawn
      // mesh: lifted along the city's up (scene y), and pulled forward.
      if (o.userData.cityLayer === "roads") {
        o.position.y = roadLiftM;
        if (roadOffset > 0) {
          o.material.polygonOffset = true;
          o.material.polygonOffsetFactor = -roadOffset;
          o.material.polygonOffsetUnits = -roadOffset;
        }
      }
      root.add(o);
    }
    const mainMs = performance.now() - drawnAt;
    ecefFromCityAt(ellipsoid, state.target, root.matrix);
    root.matrixWorldNeedsUpdate = true;
    // The arrival fade once per place; a later stage replaces in place.
    if (firstOfPlace) arrivedAt = performance.now();
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
    load.stages.push(reply.stage);
  };

  const onMessage = (event) => {
    const reply = event.data;
    if (reply?.id !== requestId || current === null) return; // superseded
    const load = current;
    if (reply.kind === "progress") {
      load.counts = reply.counts;
      // The flight paces on the first delivery's jobs (DEC-AW-1): the outer
      // rings keep loading after the landing.
      load.progress = reply.landing ?? reply.progress;
      load.fullProgress = reply.progress;
      return;
    }
    if (reply.kind === "settled" || reply.kind === "finished") {
      if (reply.counts) load.counts = reply.counts;
      load.progress = 1;
      settle(load, reply.outcome, reply);
      return;
    }
    if (reply.kind !== "city") return;
    if (!reply.ok) {
      fail(reply.message);
      return;
    }
    void drawCity(reply, load);
  };

  /** A new load's handle state. */
  const startLoad = (target, zoom) => {
    if (worker === null) {
      const made = createWorker();
      made.addEventListener("message", onMessage);
      // A worker that failed to load or crashed answers nothing again: it
      // goes, so the next load makes a new one (review F6).
      made.addEventListener("error", (e) => {
        made.terminate();
        if (worker === made) worker = null;
        fail(e.message || "the city's worker failed");
        if (current) settle(current, "unavailable");
      });
      worker = made;
    }
    if (current && current.outcome === null) settle(current, "aborted");
    requestId += 1;
    let resolve;
    const finished = new Promise((r) => {
      resolve = r;
    });
    current = {
      id: requestId,
      key: keyOf(target),
      counts: { overpass: NO_JOBS, dem: NO_JOBS },
      progress: 0,
      frozen: 0,
      outcome: null,
      stages: [],
      resolve,
      finished,
    };
    state = {
      phase: "loading",
      target: { lat: target.lat, lng: target.lng },
    };
    worker.postMessage({
      kind: "load",
      id: requestId,
      target: state.target,
      zoom,
      heightsUrl,
    });
    return current;
  };

  /** The prefetch-shaped handle a flight paces on. */
  const handleOf = (load) => ({
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

  return {
    /** The city's root (on the Earth-centred group). */
    root,
    /**
     * Loads and builds the city at `target` ({ lat, lng }), its heights at
     * the relief's `zoom`, and returns a prefetch-shaped handle. The same
     * place while its load runs or has ended without an abort or a failure
     * returns that load's handle (no second load), unless `fresh` (a new
     * flight: a new load, which reads what is stored as warm); another
     * place supersedes. RangeError for a target that is not finite or a
     * zoom that is not an integer 1-15.
     */
    load(target, { zoom, fresh = false }) {
      if (!(Number.isFinite(target?.lat) && Number.isFinite(target?.lng))) {
        throw new RangeError(`a city needs a finite target, got ${target}`);
      }
      if (!(Number.isInteger(zoom) && zoom >= 1 && zoom <= 15)) {
        throw new RangeError(`a city needs the relief's zoom, got ${zoom}`);
      }
      const same =
        !fresh &&
        current !== null &&
        current.key === keyOf(target) &&
        current.outcome !== "aborted" &&
        current.outcome !== "unavailable" &&
        state.phase !== "failed";
      return handleOf(same ? current : startLoad(target, zoom));
    },
    /** 0 hides the city, 1 draws it whole; between, a dithered share. */
    setFade(value) {
      if (!(value >= 0 && value <= 1)) {
        throw new RangeError(`the fade must be 0-1, got ${value}`);
      }
      fade = value;
      applyFade();
    },
    /**
     * `{ phase, target?, stage?, counts?, groundM?, objects?, mainMs?,
     * message?, fade, shown, load? }`: `fade` as asked, `shown` with the
     * arrival's fade-in, `load` the current load's outcome, stages and
     * counts.
     */
    state: () => ({
      ...state,
      fade,
      shown,
      load: current && {
        outcome: current.outcome,
        stages: [...current.stages],
        counts: current.counts,
        progress: current.progress,
      },
    }),
    dispose() {
      if (objects.length > 0) {
        void loadCityThree().then((three) => clear(three));
      }
      parent.remove(root);
      worker?.terminate();
      worker = null;
    },
  };
}
