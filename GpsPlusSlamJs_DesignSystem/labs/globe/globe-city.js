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
  let state = { phase: "idle" };

  /** The building materials' dither, one call for every chunk. */
  const applyFade = () => {
    for (const object of objects) {
      // Tree materials are shared with every later city: their fade is the
      // same number, so writing it there too is harmless and keeps them
      // fading with the buildings.
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const m of materials) {
        const dither = fade < 1;
        if (m.alphaHash !== dither) {
          m.alphaHash = dither;
          m.needsUpdate = true;
        }
        m.opacity = fade;
      }
    }
    root.visible = fade > 0 && objects.length > 0;
  };

  const clear = (three) => {
    for (const o of objects) root.remove(o);
    three.disposeCityObjects(objects);
    objects = [];
  };

  const onMessage = async (event) => {
    const reply = event.data;
    if (reply?.id !== requestId) return; // superseded
    if (!reply.ok) {
      state = { ...state, phase: "failed", message: reply.message };
      return;
    }
    let three;
    try {
      three = await loadCityThree();
    } catch (error) {
      state = { ...state, phase: "failed", message: String(error) };
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
     * Builds the city at `target` ({ lat, lng }); a later call supersedes an
     * earlier one. RangeError for a target that is not finite.
     */
    build(target) {
      if (!(Number.isFinite(target?.lat) && Number.isFinite(target?.lng))) {
        throw new RangeError(`a city needs a finite target, got ${target}`);
      }
      if (worker === null) {
        worker = createWorker();
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", (e) => {
          state = { ...state, phase: "failed", message: e.message || "worker" };
        });
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
    /** `{ phase, target?, counts?, groundM?, objects?, message?, fade }`. */
    state: () => ({ ...state, fade }),
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
