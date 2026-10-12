/**
 * The city in the globe's own scene (globe city plan 2026-10-05-0040 §12.5
 * C4, §14): built in `globe-city-worker.js` from the Osm library alone, drawn
 * through the library's `gps-plus-slam-osm/three`, and placed on the globe's
 * Earth-centred group by `ecefFromCityAt` (the frame at the target, scaled
 * from the library's ruler to the true ellipsoid, R2), so a frame recentre
 * moves nothing (R16).
 *
 * It appears by a DITHERED fade (`alphaHash`, R17): a transparent fade would
 * reorder the city against the relief and the clouds; dithering keeps it
 * opaque, in the depth pass, with a share of its pixels drawn.
 *
 * @see globe-city.js.md
 */
import * as THREE from "three";

import { ecefFromCityAt } from "/globe/globe-frame.js";

/**
 * The library's three.js entry, loaded with the first city: the lab's boot
 * graph stays free of the Osm library (`build-lookdev.test.mjs` holds it to
 * that, as for the arrival prefetch), so a page that never reaches a city
 * never loads it.
 */
/**
 * How long a city fades in once it arrives (ms). The build usually lands
 * after the dive (the worker reads its heights once the prefetch is done),
 * below the altitude fade's band, so without this the whole city switched
 * on in one frame (r790 milestone review F4).
 */
const ARRIVAL_FADE_MS = 1500;

let cityThree = null;
const loadCityThree = () => (cityThree ??= import("gps-plus-slam-osm/three"));

/**
 * @param {{ parent: THREE.Object3D, ellipsoid: object,
 *   createWorker?: () => Worker }} options
 *   `parent` the globe's Earth-centred group (its world matrix is the frame).
 */
export function createGlobeCity({
  parent,
  ellipsoid,
  // A LITERAL URL: the lookdev builder finds a worker by its literal string,
  // so a variable would leave the deployed preview without it. Through the
  // worker view (`/w/`): its modules import packages by name.
  createWorker = () =>
    new Worker("/w/labs/globe/globe-city-worker.js", { type: "module" }),
}) {
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

  /**
   * The building materials' dither, one call for every chunk: the requested
   * fade (the altitude's) times the arrival's.
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
   * A failed build leaves no city drawn (an older place's city is not left
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

  const onMessage = async (event) => {
    const reply = event.data;
    if (reply?.id !== requestId) return; // superseded
    if (!reply.ok) {
      fail(reply.message);
      return;
    }
    let three;
    try {
      three = await loadCityThree();
    } catch (error) {
      fail(String(error));
      return;
    }
    // A newer request may have been made while the module loaded.
    if (reply.id !== requestId) return;
    clear(three);
    objects = three.cityObjects({
      buildings: reply.buildings,
      trees: reply.trees,
    });
    for (const o of objects) root.add(o);
    ecefFromCityAt(ellipsoid, state.target, root.matrix);
    root.matrixWorldNeedsUpdate = true;
    arrivedAt = performance.now();
    applyFade();
    state = {
      ...state,
      phase: "ready",
      counts: reply.counts,
      groundM: reply.groundM,
      objects: objects.length,
    };
  };

  return {
    /** The city's root (on the Earth-centred group). */
    root,
    /**
     * Builds the city at `target` ({ lat, lng }), its heights at the relief's
     * `zoom`; a later call supersedes an earlier one. RangeError for a target
     * that is not finite or a zoom that is not an integer 1-15.
     */
    build(target, { zoom }) {
      if (!(Number.isFinite(target?.lat) && Number.isFinite(target?.lng))) {
        throw new RangeError(`a city needs a finite target, got ${target}`);
      }
      if (!(Number.isInteger(zoom) && zoom >= 1 && zoom <= 15)) {
        throw new RangeError(`a city needs the relief's zoom, got ${zoom}`);
      }
      if (worker === null) {
        const made = createWorker();
        made.addEventListener("message", onMessage);
        // A worker that failed to load or crashed answers nothing again: it
        // goes, so the next build makes a new one (review F6).
        made.addEventListener("error", (e) => {
          made.terminate();
          if (worker === made) worker = null;
          fail(e.message || "the city's worker failed");
        });
        worker = made;
      }
      requestId += 1;
      state = {
        phase: "loading",
        target: { lat: target.lat, lng: target.lng },
      };
      worker.postMessage({
        kind: "build",
        id: requestId,
        target: state.target,
        zoom,
      });
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
     * `{ phase, target?, counts?, groundM?, objects?, message?, fade, shown }`:
     * `fade` as asked, `shown` with the arrival's fade-in applied.
     */
    state: () => ({ ...state, fade, shown }),
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
