/**
 * The relief's detail colour for the globe lab (globe round-5 F1): the
 * terrain lab's region around the dive's target (256 km, z8 heights at
 * 500 m posts, the same `placeFor` / `fieldSpec` / worker chain), its
 * `globe-albedo` detail as a grid of factors (`terrain-detail-grid.js`),
 * handed to the relief's tiles (`terrain.setDetail`). Loaded only for the
 * relief (a dynamic import), so the globe's boot graph stays free of the
 * Osm library the worker reads.
 *
 * @see globe-detail-region.js.md
 */
import { enuFrameAt } from "/osm-lib/mesh/enu.js";
import { toWorldPixel } from "/osm-lib/elevation/terrarium.js";
import { detailRatioGrid } from "../terrain/terrain-detail-grid.js";
import { regionTiles } from "../terrain/terrain-mosaic.js";
import {
  FIELD,
  GPS_PLACE,
  fieldSpec,
  placeFor,
} from "../terrain/terrain-params.js";
import { fetchTerrariumTiles } from "../terrain/terrain-relief-fetch.js";

/**
 * A loader bound to one relief carrier. `load(target, { detail })` builds
 * the target's region and sets the grid; a later `load` supersedes an
 * earlier one still running. `state()` is what the smokes read: `idle`,
 * `loading`, `ready` (with the grid's posts and the share of factors that
 * are not 1) or `failed` (with the reason).
 *
 * @param {{ terrain: { setDetail: Function }, urlTemplate: string }} o
 */
export function createDetailRegion({ terrain, urlTemplate }) {
  let run = 0;
  let current = { state: "idle" };
  const fail = (mine, message) => {
    if (mine === run) current = { state: "failed", message };
  };
  return {
    state: () => ({ ...current }),
    async load(target, { detail }) {
      const mine = ++run;
      const place = placeFor(GPS_PLACE, target);
      if (!place) {
        fail(mine, "the target is not a finite position");
        return;
      }
      if (!(detail > 0)) {
        terrain.setDetail(null, place.centre);
        current = { state: "idle" };
        return;
      }
      current = { state: "loading" };
      const spec = fieldSpec(place);
      const frame = enuFrameAt(place.centre);
      const tiles = regionTiles(spec, {
        toLatLng: (p) => frame.toLatLng(p),
        toWorldPixel,
      });
      const fetched = await fetchTerrariumTiles(tiles, urlTemplate);
      // Counted before the bytes are transferred to the worker.
      const loaded = fetched.filter((t) => t.bytes !== null);
      const bytes = loaded.reduce((n, t) => n + t.bytes.byteLength, 0);
      if (mine !== run) return;
      if (fetched.every((t) => t.bytes === null)) {
        fail(mine, "no height tile of the region could load");
        return;
      }
      const worker = new Worker(
        new URL("../terrain/terrain-worker.js", import.meta.url),
        { type: "module" },
      );
      try {
        const relief = await new Promise((resolve, reject) => {
          worker.onmessage = (event) => {
            const m = event.data;
            if (m.type === "relief") resolve(m);
            else if (m.type === "error") reject(new Error(m.message));
          };
          worker.onerror = (event) =>
            reject(new Error(event.message || "the relief worker failed"));
          worker.postMessage(
            {
              type: "build",
              id: mine,
              spec: {
                ...spec,
                reliefSigmaM: FIELD.reliefSigmaM,
                detailSigmaPosts: FIELD.detailSigmaPosts,
              },
              tiles: fetched,
              // No sky view: the detail does not read it.
              svf: { directions: 0, steps: FIELD.svfSteps },
            },
            fetched.flatMap((t) => (t.bytes === null ? [] : [t.bytes])),
          );
        });
        if (mine !== run) return;
        const grid = detailRatioGrid({
          fields: relief.fields,
          spec,
          datum: relief.datum,
          latDeg: place.centre.lat,
          detail,
        });
        terrain.setDetail(grid, place.centre);
        const changed = grid.ratio.filter((v) => v !== 1).length;
        current = {
          state: "ready",
          // The data the detail costs: the region's height tiles (z8).
          tiles: loaded.length,
          bytes,
          posts: grid.ratio.length,
          changedShare: changed / grid.ratio.length,
          centre: place.centre,
        };
      } catch (error) {
        fail(mine, String(error?.message ?? error));
      } finally {
        worker.terminate();
      }
    },
  };
}
