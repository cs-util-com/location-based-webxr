// @ts-check
/**
 * Local archive server for the e2e suite: builds one test zip IN MEMORY at
 * startup (no committed fixture — the repo caps tracked files at 2 MiB and a
 * generated archive can never rot out of sync with the specs) and serves it
 * on two routes:
 *
 * - `/ranges-ok/tour.zip`  — honors `Range` with 206 slices (plus HEAD with
 *   Content-Length/ETag, and a 200 full body for range-less GETs, which is
 *   what the background warm-download issues).
 * - `/no-ranges/tour.zip`  — IGNORES `Range` and streams the whole body with
 *   200, the "host without range support" the fallback path exists for.
 * - `/flippable/tour.zip` — 200 full body with a SETTABLE ETag (`/flip`),
 *   the "author overwrote the archive at the same URL" host the
 *   revalidation spec drives.
 * - `/api/drive-proxy?id=…` — ranges like `ranges-ok`, on the Drive proxy's
 *   own path, so the app treats it as a Drive tour; `id=e2e-drive` sends a
 *   `content-disposition` file name ("My tour.zip"), any other id none.
 * - `/slow-warm/tour.zip` — ranges like `ranges-ok`, but a range-less GET
 *   (the background warm download) is HELD while the warm gate is closed
 *   (`/warm-gate?state=hold` / `?state=release`) — the deterministic
 *   in-flight-warm window the clear-cache-during-warm spec needs.
 * - `/no-cors/tour.zip` - the archive WITHOUT CORS headers: a host that
 *   blocks browsers, which the "download the file and open it here"
 *   advice exists for (tour kit plan K0).
 * - `/ranges-ok/stations-tour.zip` - a `tour.json` version 2 with three
 *   stations (tour kit plan K4): one found by the fixture's printed code
 *   (a knight with a voice and a scene choice), one by walking to it (a
 *   `.glb` model), one far away for the skip.
 *
 * CORS: the app origin (the vite port) differs from this server's,
 * and `Range` is not a CORS-safelisted request header, so the preflight
 * OPTIONS must allow it and `Content-Range`/`ETag` must be exposed.
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";

import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";

import { E2E_QR_TEXT, e2eQrLevelEntryName } from "./qr-fixture.mjs";

const port = Number(process.argv[2] ?? "5197");

/** 1×1 red PNG — a real decodable image, 67 bytes. */
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.codePointAt(0),
);

/** The default tour: images, an authored level, padding. `withLevel: false`
 *  is the PLAIN tour (flows plan M4) - images only, no recording and no
 *  printed code: the "nothing to place" case the status line must name. */
async function buildZip({ withLevel = true } = {}) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  await writer.add("session.json", new TextReader('{"kind":"e2e-tour"}'));
  for (let i = 0; i < 8; i += 1) {
    await writer.add(
      `images/frame-${String(i)}.png`,
      new Uint8ArrayReader(TINY_PNG.slice()),
    );
  }
  // An authored QR level (QR-pose plan M4): the viewer spec relocalizes
  // against it. Geo sits ~13 m from the spec's zero reference.
  if (withLevel) {
    await writer.add(
      await e2eQrLevelEntryName(),
      new TextReader(
        JSON.stringify({
          version: 1,
          qr: {
            physicalSizeM: 0.2,
            geo: {
              lat: 47.5001,
              lon: 8.7001,
              alt: 400,
              rotation: [0, 0, 0, 1],
            },
          },
        }),
      ),
    );
  }
  // A placed pin (guided-setup plan M3/M4): the creator's finish must write
  // it back, and a visitor (M5) places it.
  if (withLevel) {
    await writer.add(
      "tour.json",
      new TextReader(
        JSON.stringify({
          version: 1,
          objects: [
            {
              id: "fixturepin01",
              kind: "pin",
              geo: { lat: 47.50009, lon: 8.7, alt: 400, headingDeg: 0 },
              createdAtIso: "2026-09-08T12:00:00.000Z",
              label: "Fixture pin",
            },
          ],
        }),
      ),
    );
  }
  // Padding entry so the archive is comfortably larger than what a
  // metadata+images session needs — the partial-fetch assertion depends on
  // the gap being wide.
  await writer.add("padding.bin", new TextReader("p".repeat(200_000)));
  return writer.close();
}

/** The smallest valid binary glTF: one JSON chunk, an empty scene, no
 *  buffers, images or extensions - inert by K0's check. */
function minimalGlb() {
  const json = new TextEncoder().encode(
    JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{}] }),
  );
  const padded = Math.ceil(json.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + padded).fill(0x20);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(json, 20);
  return out;
}

/** Metres to degrees at the spec's zero (47.5, 8.7). */
const DEG_PER_M_LAT = 8.9832e-6;
const DEG_PER_M_LON = 1.32966e-5;

/**
 * The stations tour (tour kit plan K4): fixed order; "The gate" anchored to
 * the fixture's printed code (so the lock that passes the scan gate finds
 * it), "The well" 30 m north (found by walking), "The tower" 300 m east
 * (skipped).
 */
async function buildStationsZip() {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  await writer.add("session.json", new TextReader('{"kind":"e2e-stations"}'));
  await writer.add(
    await e2eQrLevelEntryName(),
    new TextReader(
      JSON.stringify({
        version: 1,
        qr: {
          physicalSizeM: 0.2,
          // Where the fakes' armed pose ([1, 1.5, -2] raw WebXR, so 2 m
          // north and 1 m east) puts the code under the seeded alignment:
          // its votes then agree with the walk instead of pulling it.
          geo: {
            lat: 47.5 + 2 * DEG_PER_M_LAT,
            lon: 8.7 + 1 * DEG_PER_M_LON,
            alt: 400,
            rotation: [0, 0, 0, 1],
          },
        },
      }),
    ),
  );
  await writer.add(
    "content/knight.png",
    new Uint8ArrayReader(TINY_PNG.slice()),
  );
  await writer.add(
    "content/voice.mp3",
    new Uint8ArrayReader(new Uint8Array([0xff, 0xfb, 0x90, 0x00])),
  );
  await writer.add("content/arch.glb", new Uint8ArrayReader(minimalGlb()));
  const geo = (north, east) => ({
    lat: 47.5 + north * DEG_PER_M_LAT,
    lon: 8.7 + east * DEG_PER_M_LON,
    alt: 400,
    headingDeg: 0,
  });
  await writer.add(
    "tour.json",
    new TextReader(
      JSON.stringify({
        version: 2,
        title: "E2E castle",
        order: "fixed",
        objects: [],
        assets: [
          { id: "knight", path: "content/knight.png", width: 1, height: 1 },
          { id: "voice", path: "content/voice.mp3" },
          { id: "arch", path: "content/arch.glb" },
        ],
        stations: [
          {
            id: "gate",
            title: "The gate",
            anchor: { code: await qrCodeId(E2E_QR_TEXT) },
            activateRadiusM: 30,
            foundRadiusM: 5,
            steps: [
              {
                id: "knight",
                block: {
                  kind: "character",
                  name: "Sir Kay",
                  image: "knight",
                  caption: "Halt, traveller!",
                  voice: "voice",
                },
              },
              {
                id: "ask",
                block: {
                  kind: "choice",
                  prompt: "Enter the castle?",
                  options: [
                    { id: "no", label: "Not today", goto: "farewell" },
                    { id: "yes", label: "Yes", goto: "welcome" },
                  ],
                },
              },
              { id: "farewell", block: { kind: "text", text: "Farewell." } },
              {
                id: "welcome",
                block: { kind: "text", text: "Welcome inside." },
              },
            ],
          },
          {
            id: "well",
            title: "The well",
            anchor: { geo: geo(30, 0) },
            activateRadiusM: 20,
            foundRadiusM: 5,
            steps: [
              {
                id: "arch",
                block: {
                  kind: "model",
                  asset: "arch",
                  caption: "The old arch.",
                },
              },
            ],
          },
          {
            id: "tower",
            title: "The tower",
            anchor: { geo: geo(0, 300) },
            activateRadiusM: 20,
            foundRadiusM: 5,
            steps: [{ id: "top", block: { kind: "text", text: "The top." } }],
          },
        ],
      }),
    ),
  );
  return writer.close();
}

/**
 * A tour zip that IS a recording (geo-join e2e): era-5 session.json plus an
 * action stream whose four consistent GPS↔odom pairs solve a clean
 * translation alignment ([+2 m N] and the 400 m altitude datum), and two
 * captures taken AFTER the zero — so the viewer's capture-time join
 * accepts and places photos at capture spots instead of the ring.
 * Payload frames match the recorder's writes exactly: odom positions are
 * RAW WEBXR ([E, y, −N] for a NUE (N, E)); the reducer converts on replay.
 */
async function buildRecordingZip() {
  const degPerMLat = 8.9832e-6;
  const degPerMLon = 1.32966e-5; // at lat 47.5
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  await writer.add(
    "session.json",
    new TextReader(JSON.stringify({ version: 1, odomCoordVersion: 5 })),
  );
  const actions = [
    { type: "gpsData/setZeroPos", payload: { lat: 47.5, lon: 8.7 } },
  ];
  const pairsNue = [
    [0, 0],
    [10, 0],
    [0, 10],
    [10, 10],
  ];
  for (const [i, [n, e]] of pairsNue.entries()) {
    actions.push({
      type: "gpsData/recordGpsEvent",
      payload: {
        odomPosition: [e, 0, -n],
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: `rec-${String(i)}`,
          latitude: 47.5 + (n + 2) * degPerMLat,
          longitude: 8.7 + e * degPerMLon,
          altitude: 400,
          latLongAccuracy: 4,
          timestamp: 1756150000000 + i * 1000,
        },
      },
    });
  }
  for (const [i, [n, e]] of [
    [0, 0],
    [10, 0],
  ].entries()) {
    actions.push({
      type: "gpsData/add2dImage",
      payload: {
        imageFile: `images/frame-${String(i)}.png`,
        position: [e, 0, -n],
        rotation: [0, 0, 0, 1],
        screenRotation: 0,
        capturedAt: 1756150005000 + i * 1000,
      },
    });
  }
  for (const [i, action] of actions.entries()) {
    await writer.add(
      `actions/${String(i + 1).padStart(6, "0")}.json`,
      new TextReader(JSON.stringify(action)),
    );
  }
  for (let i = 0; i < 2; i += 1) {
    await writer.add(
      `images/frame-${String(i)}.png`,
      new Uint8ArrayReader(TINY_PNG.slice()),
    );
  }
  await writer.add(
    await e2eQrLevelEntryName(),
    new TextReader(
      JSON.stringify({
        version: 1,
        qr: {
          physicalSizeM: 0.2,
          geo: { lat: 47.5001, lon: 8.7001, alt: 400, rotation: [0, 0, 0, 1] },
        },
      }),
    ),
  );
  return writer.close();
}

/**
 * A tour zip whose recorded photos' spots were BAKED at a Finish (scan-pass
 * plan S1): `tour.json` carries `captureSpots` (7 fixes, unlike the
 * recording zip's 4, so a status line proves which source placed them),
 * the two photos and a level - plus a walk a copy kept for a co-author
 * (`session.json`, an action and a frame no spot shows), which a visitor
 * must neither show in the gallery nor replay (scan-pass plan S1).
 */
async function buildBakedZip() {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  const spot = (i, lat) => ({
    image: `images/frame-${String(i)}.png`,
    geo: { lat, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  });
  await writer.add(
    "tour.json",
    new TextReader(
      JSON.stringify({
        version: 2,
        minor: 1,
        objects: [],
        captureSpots: {
          fixes: 7,
          gpsAccuracyMedianM: 3,
          captures: [spot(0, 47.50002), spot(1, 47.50011)],
        },
      }),
    ),
  );
  for (let i = 0; i < 3; i += 1) {
    await writer.add(
      `images/frame-${String(i)}.png`,
      new Uint8ArrayReader(TINY_PNG.slice()),
    );
  }
  await writer.add(
    "session.json",
    new TextReader(JSON.stringify({ version: 1, odomCoordVersion: 5 })),
  );
  await writer.add(
    "actions/000001.json",
    new TextReader(
      JSON.stringify({
        type: "gpsData/setZeroPos",
        payload: { lat: 47.5, lon: 8.7 },
      }),
    ),
  );
  await writer.add(
    await e2eQrLevelEntryName(),
    new TextReader(
      JSON.stringify({
        version: 1,
        qr: {
          physicalSizeM: 0.2,
          geo: { lat: 47.5001, lon: 8.7001, alt: 400, rotation: [0, 0, 0, 1] },
        },
      }),
    ),
  );
  return writer.close();
}

const zipBytes = await buildZip();
const bakedZipBytes = await buildBakedZip();
const plainZipBytes = await buildZip({ withLevel: false });
const recordingZipBytes = await buildRecordingZip();
const stationsZipBytes = await buildStationsZip();
const sampleZipBytes = new Uint8Array(
  readFileSync(
    new URL("../public/samples/marienplatz-tour.zip", import.meta.url),
  ),
);
const ETAG = '"e2e-tour-v1"';

/**
 * The `/flippable/tour.zip` route's ETag version — settable via
 * `/flip?etag=<v>` (explicit set, not a toggle, so a retried spec stays
 * deterministic). Only the revalidation spec uses this route, so the global
 * state cannot leak into parallel siblings.
 */
let flippableEtagVersion = "v1";

/**
 * The `/slow-warm` route's warm gate: while held, range-less GETs (the warm
 * download) queue instead of answering; `release` answers everything queued
 * and lets later ones straight through. Explicit hold/release (never a
 * toggle) keeps a retried spec deterministic, and `release` is idempotent so
 * ordering between the release call and the queued request cannot deadlock.
 * Only the clear-cache-during-warm spec drives this route, so the global
 * state cannot leak into parallel siblings.
 */
let warmGate = { released: true, waiters: [] };

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "range,if-none-match,if-modified-since",
  "access-control-expose-headers":
    "content-range,content-length,etag,content-disposition",
};

/** The Drive-shaped routes (Drive replace plan §5 #12): the proxy's own
 *  path, so the app treats the tour as a Drive tour without any Google
 *  host. `e2e-drive` carries a file name the link does not; the other id
 *  sends none (the fallback). */
const DRIVE_PROXY_PATH = "/api/drive-proxy";
const DRIVE_FILE_NAMES = {
  "e2e-drive": `attachment; filename="My tour.zip"; filename*=UTF-8''My%20tour.zip`,
};

/** The utility routes: preflight + health. True if handled. */
function handleUtilityRoute(req, res, pathname) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS).end();
    return true;
  }
  if (pathname === "/health") {
    res.writeHead(200, CORS_HEADERS).end("ok");
    return true;
  }
  return false;
}

/** `/flip?etag=v2` — change what the flippable route reports as its ETag. */
function handleFlip(res, url) {
  flippableEtagVersion = url.searchParams.get("etag") ?? "v1";
  res.writeHead(200, CORS_HEADERS).end(flippableEtagVersion);
}

/** `/warm-gate?state=hold|release` — control the `/slow-warm` warm gate. */
function handleWarmGate(res, url) {
  const state = url.searchParams.get("state");
  if (state === "hold") {
    warmGate = { released: false, waiters: [] };
  } else {
    warmGate.released = true;
    for (const answer of warmGate.waiters) answer();
    warmGate.waiters = [];
  }
  res.writeHead(200, CORS_HEADERS).end(warmGate.released ? "released" : "held");
}

/** Serve the archive: HEAD metadata, 206 slices (ranges-ok), or a 200 body.
 *  `bytes` defaults to the standard tour; the recording route passes its own
 *  archive (distinct etag so caches cannot cross the two). */
function handleArchive(
  req,
  res,
  mode,
  bytes = zipBytes,
  etag = ETAG,
  extraHeaders = {},
) {
  const baseHeaders = {
    ...CORS_HEADERS,
    ...extraHeaders,
    etag: mode === "flippable" ? `"e2e-tour-${flippableEtagVersion}"` : etag,
    "last-modified": "Mon, 24 Aug 2026 12:00:00 GMT",
  };
  if (req.method === "HEAD") {
    res
      .writeHead(200, {
        ...baseHeaders,
        "content-length": String(bytes.length),
      })
      .end();
    return;
  }
  const range = req.headers.range;
  const rangeMatch =
    (mode === "ranges-ok" || mode === "slow-warm") && typeof range === "string"
      ? /^bytes=(\d+)-(\d+)$/.exec(range)
      : null;
  if (rangeMatch !== null) {
    const start = Number(rangeMatch[1]);
    const end = Math.min(Number(rangeMatch[2]), bytes.length - 1);
    const slice = bytes.slice(start, end + 1);
    res
      .writeHead(206, {
        ...baseHeaders,
        "content-range": `bytes ${String(start)}-${String(end)}/${String(bytes.length)}`,
        "content-length": String(slice.length),
      })
      .end(Buffer.from(slice));
    return;
  }
  const answer = () => {
    res
      .writeHead(200, {
        ...baseHeaders,
        "content-length": String(bytes.length),
      })
      .end(Buffer.from(bytes));
  };
  if (mode === "slow-warm" && !warmGate.released) {
    warmGate.waiters.push(answer); // held until /warm-gate?state=release
    return;
  }
  answer();
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${String(port)}`);
  if (handleUtilityRoute(req, res, url.pathname)) return;
  if (url.pathname === "/flip") {
    handleFlip(res, url);
    return;
  }
  if (url.pathname === "/warm-gate") {
    handleWarmGate(res, url);
    return;
  }
  if (url.pathname === "/no-cors/tour.zip") {
    // A host that blocks browsers (tour kit plan K0): the archive is there,
    // but no answer carries CORS headers, so the browser refuses the read.
    res
      .writeHead(200, { "content-length": String(zipBytes.length) })
      .end(req.method === "HEAD" ? undefined : Buffer.from(zipBytes));
    return;
  }
  if (url.pathname === "/ranges-ok/recording-tour.zip") {
    handleArchive(req, res, "ranges-ok", recordingZipBytes, '"e2e-rec-v1"');
    return;
  }
  if (url.pathname === "/ranges-ok/baked-tour.zip") {
    handleArchive(req, res, "ranges-ok", bakedZipBytes, '"e2e-baked-v1"');
    return;
  }
  if (url.pathname === "/ranges-ok/stations-tour.zip") {
    handleArchive(req, res, "ranges-ok", stationsZipBytes, '"e2e-stations-v1"');
    return;
  }
  if (url.pathname === "/ranges-ok/sample-tour.zip") {
    // The committed sample tour (public/samples, owner decision S-D9).
    handleArchive(req, res, "ranges-ok", sampleZipBytes, '"e2e-sample-v1"');
    return;
  }
  if (url.pathname === "/ranges-ok/plain-tour.zip") {
    handleArchive(req, res, "ranges-ok", plainZipBytes, '"e2e-plain-v1"');
    return;
  }
  if (url.pathname === DRIVE_PROXY_PATH) {
    const id = url.searchParams.get("id") ?? "";
    const name = /** @type {Record<string, string>} */ (DRIVE_FILE_NAMES)[id];
    handleArchive(
      req,
      res,
      "ranges-ok",
      zipBytes,
      `"e2e-drive-${id}"`,
      name === undefined ? {} : { "content-disposition": name },
    );
    return;
  }
  const match = /^\/(ranges-ok|no-ranges|flippable|slow-warm)\/tour\.zip$/.exec(
    url.pathname,
  );
  if (match === null) {
    res.writeHead(404, CORS_HEADERS).end();
    return;
  }
  handleArchive(req, res, match[1]);
}).listen(port, () => {
  console.log(`archive-server on http://127.0.0.1:${String(port)}`);
});
