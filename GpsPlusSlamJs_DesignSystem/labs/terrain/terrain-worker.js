/**
 * The terrain lab's worker (terrain plan 2026-09-27-0605 §4 "Data" and
 * "Precompute", §9 findings 3-5): decodes the tile bytes the page fetched,
 * runs the data chain (`terrain-pipeline.js`: the mosaic, OsmDemo's
 * `buildHeightfieldData` onto the metric ENU grid, the no-data mask) with
 * the served modules as its dependencies, and runs the precompute. The sky view
 * follows in a second message, so the first frame does not wait for it
 * (plan §9 finding 14).
 *
 * THE PAGE FETCHES, NOT THIS WORKER (finding 4): a worker's requests are
 * outside the smoke's routing, so a fetch here would make "no request
 * leaves the machine" pass vacuously. The bytes arrive transferred.
 *
 * ROUTE URLS ONLY: import maps do not apply inside a worker, so every import
 * is a served path (`/osm-lib/`, `/osm/`) or relative. The deploy crawl
 * refuses a bare one (`build-lookdev.mjs`).
 *
 * Protocol (one request at a time; `id` echoes back):
 * - in  `{ type: "build", id, spec, tiles: [{ z, x, y, bytes }], svf }`,
 *   `bytes` an ArrayBuffer or null for a tile that failed to load;
 * - out `{ type: "relief", id, ... }`, then `{ type: "svf", id, svf, ms }`
 *   when `svf.directions > 0`, or `{ type: "error", id, message }`.
 *
 * @see terrain-worker.js.md
 */
import {
  browserPngDecoder,
  toElevationTile,
  toWorldPixel,
} from "/osm-lib/elevation/terrarium.js";
import { enuFrameAt } from "/osm-lib/mesh/enu.js";
import { buildHeightfieldData } from "/osm-lib/elevation/heightfield.js";
import { terrainTextureFrom } from "/osm/terrain-texture.js";
import { reliefField } from "./terrain-pipeline.js";
import {
  gradient,
  localRelief,
  reliefStd,
  skyView,
} from "./terrain-precompute.js";

const decodePng = browserPngDecoder();

/** Decodes every tile that arrived; a tile that fails to decode is a gap. */
async function decodeTiles(tiles) {
  const decoded = [];
  let decodeFailures = 0;
  for (const t of tiles) {
    if (t.bytes === null) continue;
    try {
      decoded.push(toElevationTile(await decodePng(t.bytes), t.z, t.x, t.y));
    } catch {
      decodeFailures += 1;
    }
  }
  return { decoded, decodeFailures };
}

async function build({ id, spec, tiles, svf }) {
  const started = performance.now();
  const { decoded, decodeFailures } = await decodeTiles(tiles);
  const range = {
    x0: Math.min(...tiles.map((t) => t.x)),
    x1: Math.max(...tiles.map((t) => t.x)),
    y0: Math.min(...tiles.map((t) => t.y)),
    y1: Math.max(...tiles.map((t) => t.y)),
  };
  const field = await reliefField({
    decoded,
    range,
    spec,
    deps: {
      toWorldPixel,
      enuFrameAt,
      buildHeightfieldData,
      terrainTextureFrom,
    },
  });
  const decodedMs = performance.now() - started;
  const { side, height, valid } = field;
  const { gx, gy } = gradient(height, side, spec.spacingM);
  const sigma = spec.reliefSigmaM / spec.spacingM;
  const relief = localRelief(height, side, sigma);
  const std = reliefStd(height, side, sigma);
  const small = localRelief(height, side, spec.detailSigmaPosts);
  const reliefMs = performance.now() - started - decodedMs;
  // The sky view runs after the relief is posted, and `height` is
  // transferred away with it: the march reads a copy.
  const wantSvf = svf.directions > 0 && field.hasData;
  const posts = wantSvf ? height.slice() : null;
  postMessage(
    {
      type: "relief",
      id,
      side,
      extentM: spec.extentM,
      spacingM: spec.spacingM,
      datum: field.datum,
      hasData: field.hasData,
      missing: field.missing,
      total: field.total,
      reliefM: field.reliefM,
      missingTiles: field.missingTiles,
      decodeFailures,
      decodedMs,
      reliefMs,
      fields: {
        height,
        gx,
        gy,
        relief,
        reliefStd: std,
        reliefSmall: small,
        valid,
      },
    },
    [
      height.buffer,
      gx.buffer,
      gy.buffer,
      relief.buffer,
      std.buffer,
      small.buffer,
      valid.buffer,
    ],
  );
  if (wantSvf) {
    const t0 = performance.now();
    const out = skyView(posts, side, spec.spacingM, svf);
    postMessage({ type: "svf", id, svf: out, ms: performance.now() - t0 }, [
      out.buffer,
    ]);
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (message?.type !== "build") return;
  build(message).catch((error) => {
    postMessage({
      type: "error",
      id: message.id,
      message: String(error?.message ?? error),
    });
  });
};
