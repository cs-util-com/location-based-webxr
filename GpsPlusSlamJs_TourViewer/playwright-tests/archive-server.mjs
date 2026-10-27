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
 * - `/ranges-ok/no-gps-tour.zip` - the default tour with its `tour.json`
 *   marked `needsNoGps` (Tour Viewer QR-first, owner decision Q-QF-1): its
 *   visitor is never asked for the location.
 * - `/ranges-ok/details-tour.zip` - a tour carrying its details (tour
 *   editor plan 2026-10-17-1816, W2): a name, a description, a
 *   contact, and a cover that is its SECOND photo (3 px wide; the first is
 *   1 px), so a page that took the first photo is told apart.
 * - `/ranges-ok/unfinished-tour.zip` - a tour not finished yet: a name,
 *   a contact and the fixture's code, no station.
 * - `/ranges-ok/stations-tour.zip` - a tour with three stations (tour
 *   kit plan K4): one at the fixture's printed code (a knight with a voice
 *   and a scene choice), one found by walking to it (a `.glb` model), one
 *   far away for the skip.
 * - `/ranges-ok/stations-tour-no-code.zip` - the same tour without its
 *   printed code: only a walk gives the guide its heading.
 * - `/ranges-ok/blocks-tour.zip` - the stations tour whose gate also
 *   holds, beside its pin, a captured photo (its own image asset), a
 *   picture of the tour's knight image in the world and a placed model of
 *   the arch: every kind of free block a tour can stand in the world.
 * - `/ranges-ok/story-blocks-tour.zip` - the stations tour whose gate
 *   story first shows a pin with a description in the world (B2b): it
 *   stands from that step on, for the rest of the visit; then a video card
 *   (`fixtures/tiny-clip.webm`, 64x36 VP8, recorded once in Chromium) and
 *   a long text in two paragraphs.
 * - `/ranges-ok/v3-tour.zip` - a tour in the earlier format 3 (a station
 *   holding a pin as an item), which the app refuses.
 * - `/ranges-ok/walk-tour.zip` (any order) and
 *   `/ranges-ok/walk-tour-fixed.zip` (fixed order) - the visitor walk
 *   prototype's "Old town walk": four
 *   stations at the prototype's spots, each a story of auto-advancing
 *   lines, for the sheet's and the layout's specs.
 *
 * Every `tour.json` here is version 4: stations at geo poses, their pins
 * and photos as free blocks, their stories as blocks shown by steps.
 *
 * CORS: the app origin (the vite port) differs from this server's,
 * and `Range` is not a CORS-safelisted request header, so the preflight
 * OPTIONS must allow it and `Content-Range`/`ETag` must be exposed.
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { crc32, deflateSync } from "node:zlib";
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";

import { e2eQrLevelEntryName } from "./qr-fixture.mjs";
import {
  capturedPhoto,
  imageAsset,
  inOwnStation,
  pinBlock,
  showStep,
  stationAt,
  textCard,
} from "./tour-fixture.mjs";

const port = Number(process.argv[2] ?? "5197");

/** The default tour's photos, in its pin's station. */
const FIXTURE_PHOTO_IDS = ["fixturephoto1", "fixturephoto2", "fixturephoto3"];

/** 1×1 red PNG — a real decodable image, 67 bytes. */
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.codePointAt(0),
);

/** The default tour: an authored level, a station holding a pin and three
 *  photos (each its own `content/` image), five other images, padding -
 *  eight images in all. `withLevel: false` is the PLAIN tour - eight
 *  images only, no `tour.json`, no recording and no printed code: a tour
 *  not finished yet.
 *  `needsNoGps`: the same tour, its `tour.json` marked as needing no GPS. */
async function buildZip({ withLevel = true, needsNoGps = false } = {}) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  await writer.add("session.json", new TextReader('{"kind":"e2e-tour"}'));
  for (let i = 0; i < (withLevel ? 5 : 8); i += 1) {
    await writer.add(
      `images/frame-${String(i)}.png`,
      new Uint8ArrayReader(TINY_PNG.slice()),
    );
  }
  // The station's photos: what a visitor sees besides the pin.
  if (withLevel) {
    for (const id of FIXTURE_PHOTO_IDS) {
      await writer.add(
        `content/${id}.png`,
        new Uint8ArrayReader(TINY_PNG.slice()),
      );
    }
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
              // The facing a measurement of the fakes' code stores (it faces
              // the camera: -90 degrees about Up in GPS-world NUE). An
              // identity read 90 degrees off every visit's view of it -
              // harmless until the settle replaced a stored code whose
              // heading the visit's GPS cannot explain (field test 3, D-F6a).
              rotation: MEASURED_CODE_ROTATION,
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
          version: 4,
          minor: 0,
          ...(needsNoGps ? { needsNoGps: true } : {}),
          assets: FIXTURE_PHOTO_IDS.map((id) =>
            imageAsset(id, `content/${id}.png`, 1, 1),
          ),
          stations: [
            stationAt(
              "st-fixturepin01",
              { lat: 47.50009, lon: 8.7, alt: 400 },
              [
                pinBlock("fixturepin01", "Fixture pin", {
                  createdAtIso: "2026-09-08T12:00:00.000Z",
                }),
                ...FIXTURE_PHOTO_IDS.map((id, i) =>
                  capturedPhoto(id, {
                    createdAtIso: "2026-09-08T12:00:00.000Z",
                    pose: { position: [i + 1, 0, 0], rotation: [0, 0, 0, 1] },
                  }),
                ),
              ],
            ),
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
/** The facing a measurement of the fakes' code stores: it faces the
 *  camera, -90 degrees about Up in GPS-world NUE (WEBXR_TO_NUE). Every
 *  fixture code uses it, so no stored code is off its measurement by
 *  construction (r811's red CI: the settle replaces a code whose heading the
 *  visit's GPS cannot explain, field test 3 D-F6a). */
const MEASURED_CODE_ROTATION = [0, -Math.SQRT1_2, 0, Math.SQRT1_2];
const DEG_PER_M_LAT = 8.9832e-6;
const DEG_PER_M_LON = 1.32966e-5;

/**
 * The stations tour (tour kit plan K4): fixed order; "The gate" at the
 * fixture's printed code (2 m north, 1 m east: the lock that passes the
 * scan gate places the visitor inside its radius - a lock is no arrival of
 * its own, tour editor plan D16), "The well" 30 m north (found by
 * walking), "The tower" 300 m east (skipped). The gate and the well each
 * hold one pin, so the e2e suite can see which station's content stands in
 * the scene (only the present one's).
 * `withCode: false`: the same tour without its printed code (no level),
 * so nothing but walking gives the guide a heading.
 * `worldBlocks: true`: the gate also stands a captured photo, a picture
 * of the knight image and a placed arch in the world.
 */
async function buildStationsZip({
  withCode = true,
  worldBlocks = false,
  storyBlocks = false,
} = {}) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  await writer.add("session.json", new TextReader('{"kind":"e2e-stations"}'));
  if (withCode)
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
              rotation: MEASURED_CODE_ROTATION,
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
  if (worldBlocks) {
    await writer.add(
      "content/gate-photo.png",
      new Uint8ArrayReader(TINY_PNG.slice()),
    );
  }
  /** The gate's free blocks besides its pin (`worldBlocks`). */
  const gateWorld = worldBlocks
    ? [
        capturedPhoto("gate-photo", {
          caption: "The gate at dusk",
          createdAtIso: "2026-10-19T08:00:00.000Z",
          pose: { position: [1, 1.5, 2], rotation: [0, 0, 0, 1] },
        }),
        {
          id: "gate-knight",
          kind: "picture",
          view: "plane",
          image: "knight",
          widthM: 0.5,
          pose: { position: [-1, 1.5, 2], rotation: [0, 0, 0, 1] },
        },
        {
          id: "gate-arch",
          kind: "model",
          view: "placed",
          asset: "arch",
          sizeM: 2,
          title: "The arch",
          pose: { position: [0, 0, 4], rotation: [0, 0, 0, 1] },
        },
      ]
    : [];
  /** The gate's new story blocks (`storyBlocks`, station blocks plan
   *  B2b): a pin with a description its first step shows, which stands
   *  from then on for the rest of the visit; a video card (the committed
   *  WebM, the knight as its poster); a long text in two paragraphs. */
  const gateStory = storyBlocks
    ? [
        {
          id: "gate-story-sign",
          kind: "shortText",
          view: "pin",
          caption: "The old sign",
          description: "Carved in 1400.",
          pose: { position: [2, 1.5, 1], rotation: [0, 0, 0, 1] },
        },
        {
          id: "gate-clip",
          kind: "video",
          view: "card",
          video: "clip",
          poster: "knight",
          transcript: "The gate opens at dawn.",
          pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        },
        {
          id: "gate-history",
          kind: "longText",
          view: "card",
          title: "The gate",
          body: "Built in **1400**,\nrebuilt later.\n\nThe second part.",
          pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        },
      ]
    : [];
  if (storyBlocks) {
    await writer.add(
      "content/clip.webm",
      new Uint8ArrayReader(
        new Uint8Array(
          readFileSync(new URL("./fixtures/tiny-clip.webm", import.meta.url)),
        ),
      ),
    );
  }
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
        version: 4,
        minor: 0,
        title: "E2E castle",
        order: "fixed",
        assets: [
          { id: "knight", path: "content/knight.png", width: 1, height: 1 },
          { id: "voice", path: "content/voice.mp3" },
          { id: "arch", path: "content/arch.glb" },
          ...(worldBlocks
            ? [imageAsset("gate-photo", "content/gate-photo.png", 1, 1)]
            : []),
          ...(storyBlocks ? [{ id: "clip", path: "content/clip.webm" }] : []),
        ],
        stations: [
          {
            id: "gate",
            title: "The gate",
            ...(storyBlocks
              ? { description: "The castle's main gate, built in 1400." }
              : {}),
            geo: geo(2, 1),
            activateRadiusM: 30,
            foundRadiusM: 5,
            hint: "arrow",
            blocks: [
              pinBlock("gate-pin", "Gate sign", {
                createdAtIso: "2026-10-19T08:00:00.000Z",
                pose: { position: [0, 1.5, 1], rotation: [0, 0, 0, 1] },
              }),
              ...gateWorld,
              ...gateStory,
              {
                id: "sir-kay",
                kind: "character",
                view: "stage",
                name: "Sir Kay",
                image: "knight",
                caption: "Halt, traveller!",
                voice: "voice",
                pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              },
              textCard("farewell-text", "The gate", "Farewell."),
              textCard("welcome-text", "The gate", "Welcome inside."),
            ],
            steps: [
              ...(storyBlocks
                ? [
                    showStep("sign", "gate-story-sign"),
                    showStep("clip", "gate-clip"),
                    showStep("history", "gate-history"),
                  ]
                : []),
              showStep("knight", "sir-kay"),
              {
                id: "ask",
                action: {
                  kind: "choice",
                  prompt: "Enter the castle?",
                  options: [
                    { id: "no", label: "Not today", goto: "farewell" },
                    { id: "yes", label: "Yes", goto: "welcome" },
                  ],
                },
                advance: { mode: "tap" },
              },
              showStep("farewell", "farewell-text"),
              showStep("welcome", "welcome-text"),
            ],
          },
          {
            id: "well",
            title: "The well",
            geo: geo(30, 0),
            activateRadiusM: 20,
            foundRadiusM: 5,
            hint: "arrow",
            blocks: [
              pinBlock("well-pin", "Well sign", {
                createdAtIso: "2026-10-19T08:00:00.000Z",
                pose: { position: [0, 1.5, 1], rotation: [0, 0, 0, 1] },
              }),
              {
                id: "old-arch",
                kind: "model",
                view: "stage",
                asset: "arch",
                title: "The old arch.",
                pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              },
            ],
            steps: [showStep("arch", "old-arch")],
          },
          {
            id: "tower",
            title: "The tower",
            geo: geo(0, 300),
            activateRadiusM: 20,
            foundRadiusM: 5,
            hint: "arrow",
            blocks: [textCard("top-text", "The tower", "The top.")],
            steps: [showStep("top", "top-text")],
          },
        ],
      }),
    ),
  );
  return writer.close();
}

/**
 * The "Old town walk" of the radar-and-list prototype
 * (`public/prototypes/visitor-walk-4-radar-and-list/`): its four stations
 * at its spots (the prototype's x east, z south, here north and east),
 * found within the prototype's radius, offered within 60 m, each a story
 * of the prototype's lines that advance by themselves after 6 s (the
 * fakes' timers, so a spec moves them on). The printed code is the
 * stations tour's (2 m north, 1 m east).
 */
async function buildWalkZip(order) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  await writer.add("session.json", new TextReader('{"kind":"e2e-walk"}'));
  await writer.add(
    await e2eQrLevelEntryName(),
    new TextReader(
      JSON.stringify({
        version: 1,
        qr: {
          physicalSizeM: 0.2,
          geo: {
            lat: 47.5 + 2 * DEG_PER_M_LAT,
            lon: 8.7 + 1 * DEG_PER_M_LON,
            alt: 400,
            rotation: MEASURED_CODE_ROTATION,
          },
        },
      }),
    ),
  );
  const geo = (north, east) => ({
    lat: 47.5 + north * DEG_PER_M_LAT,
    lon: 8.7 + east * DEG_PER_M_LON,
    alt: 400,
    headingDeg: 0,
  });
  const station = (id, title, north, east, radiusM, lines) => ({
    id,
    title,
    geo: geo(north, east),
    activateRadiusM: 60,
    foundRadiusM: radiusM,
    hint: "arrow",
    blocks: lines.map((text, i) =>
      textCard(`${id}-line-${String(i)}`, title, text),
    ),
    steps: lines.map((_text, i) =>
      showStep(`${id}-${String(i)}`, `${id}-line-${String(i)}`, {
        advance: { mode: "auto", afterS: 6 },
      }),
    ),
  });
  await writer.add(
    "tour.json",
    new TextReader(
      JSON.stringify({
        version: 4,
        minor: 0,
        title: "Old town walk",
        order,
        assets: [],
        stations: [
          station("gate", "The gate", 28, 0, 10, [
            "Until 1840 this gate was shut every night at dusk.",
            "Traders who came late slept outside the walls, beside their carts.",
            "Look up: the hinges of the old doors are still in the stone.",
          ]),
          station("well", "The well", 82, 34, 12, [
            "Everyone came here - for water first, and for the news second.",
            "The shaft is nineteen metres deep and was dug by hand.",
            "In dry summers the queue reached the far end of the square.",
          ]),
          station("tower", "The tower", 170, -48, 12, [
            "The watchman rang the bell for fire, for flood and for weddings.",
            "Its stairs have 142 steps; the top ones are new.",
          ]),
          station("garden", "The garden", 240, 46, 14, [
            "This garden was planted for medicine, not for beauty.",
            "Every bed still grows a herb from the old list.",
            "This is the last station - thank you for walking with us.",
          ]),
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
 * captures taken AFTER the zero - so the capture-time join (the editor's
 * debug layer, `debug-captures.ts`) accepts and places both captures.
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
          geo: {
            lat: 47.5001,
            lon: 8.7001,
            alt: 400,
            rotation: MEASURED_CODE_ROTATION,
          },
        },
      }),
    ),
  );
  return writer.close();
}

/**
 * A tour zip whose `tour.json` carries debug camera captures
 * (`captureSpots`, 7 fixes: an earlier app wrote them at a creator's open;
 * the field is gone from the format and the reader ignores it) in
 * stations of their own, one of which
 * also holds a pin; the captured frames, a level, and a walk
 * (`session.json`, an action). A visitor draws the pin and none of the
 * frames, and takes no cover from one.
 */
async function buildBakedZip() {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  const spot = (i) => ({
    image: `images/frame-${String(i)}.png`,
    station: `walk-${String(i)}`,
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  });
  await writer.add(
    "tour.json",
    new TextReader(
      JSON.stringify({
        version: 4,
        minor: 0,
        stations: [
          stationAt("walk-0", { lat: 47.50002, lon: 8.7, alt: 400 }, [
            pinBlock("bakedpin01", "A pin beside the captures", {
              createdAtIso: "2026-09-08T12:00:00.000Z",
            }),
          ]),
          stationAt("walk-1", { lat: 47.50011, lon: 8.7, alt: 400 }),
        ],
        captureSpots: {
          fixes: 7,
          gpsAccuracyMedianM: 3,
          captures: [spot(0), spot(1)],
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
          geo: {
            lat: 47.5001,
            lon: 8.7001,
            alt: 400,
            rotation: MEASURED_CODE_ROTATION,
          },
        },
      }),
    ),
  );
  return writer.close();
}

/**
 * A tour in the earlier format 3, written literally (no writer of this
 * app writes it any more): one station holding a pin as an item. The app
 * refuses it, and deletes the draft it kept for it.
 */
async function buildV3Zip() {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  await writer.add(
    "tour.json",
    new TextReader(
      JSON.stringify({
        version: 3,
        minor: 0,
        // Its own id, as a 3.x save wrote it: the editor kept its draft
        // under `local-file:tour:<id>` (B2a review finding 1).
        tourId: "OlderTour3",
        title: "An older tour",
        stations: [
          {
            id: "st-old",
            geo: { lat: 47.50009, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
            activateRadiusM: 50,
            foundRadiusM: 25,
            hint: "arrow",
            steps: [],
            items: [
              {
                id: "oldpin",
                kind: "pin",
                label: "An older pin",
                createdAtIso: "2026-09-08T12:00:00.000Z",
                pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              },
            ],
          },
        ],
      }),
    ),
  );
  return writer.close();
}

/** A real, decodable grey PNG of `width` x 1 px. */
function greyPng(width) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  const row = Buffer.alloc(1 + width, 0x80);
  row[0] = 0; // no filter
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(row)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/** The details tour (W2): two placed photos, the second the cover. */
async function buildDetailsZip() {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  const photo = (id, lat) => ({
    ...capturedPhoto(id, { createdAtIso: "2026-10-17T00:00:00.000Z" }),
    geo: { lat, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  });
  await writer.add(
    "tour.json",
    new TextReader(
      JSON.stringify({
        version: 4,
        minor: 0,
        title: "Harbour Lights",
        description: "Six places along the old harbour.",
        cover: "second",
        contact: "guide@example.org",
        assets: [
          imageAsset("first", "content/first.png", 1, 1),
          imageAsset("second", "content/second.png", 3, 1),
        ],
        stations: [
          inOwnStation(photo("first", 47.5)),
          inOwnStation(photo("second", 47.5001)),
        ],
      }),
    ),
  );
  await writer.add("content/first.png", new Uint8ArrayReader(greyPng(1)));
  await writer.add("content/second.png", new Uint8ArrayReader(greyPng(3)));
  return writer.close();
}

/**
 * A tour not finished yet: a `tour.json` with a name and a contact but no
 * station, and the fixture's measured code - a creator who hung the code
 * and hosted the file before placing anything. Its visitor reads that the
 * tour is not finished, with the contact, and is never asked for the code.
 */
async function buildUnfinishedZip() {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  await writer.add(
    "tour.json",
    new TextReader(
      JSON.stringify({
        version: 4,
        minor: 0,
        title: "Harbour Lights",
        contact: "guide@example.org",
        stations: [],
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
          geo: {
            lat: 47.5001,
            lon: 8.7001,
            alt: 400,
            rotation: MEASURED_CODE_ROTATION,
          },
        },
      }),
    ),
  );
  return writer.close();
}

const zipBytes = await buildZip();
const detailsZipBytes = await buildDetailsZip();
const unfinishedZipBytes = await buildUnfinishedZip();
const bakedZipBytes = await buildBakedZip();
const plainZipBytes = await buildZip({ withLevel: false });
const noGpsZipBytes = await buildZip({ needsNoGps: true });
const recordingZipBytes = await buildRecordingZip();
const stationsZipBytes = await buildStationsZip();
const stationsNoCodeZipBytes = await buildStationsZip({ withCode: false });
const blocksZipBytes = await buildStationsZip({ worldBlocks: true });
const storyBlocksZipBytes = await buildStationsZip({ storyBlocks: true });
const v3ZipBytes = await buildV3Zip();
const walkZipBytes = await buildWalkZip("any");
const walkFixedZipBytes = await buildWalkZip("fixed");
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
  if (url.pathname === "/ranges-ok/details-tour.zip") {
    handleArchive(req, res, "ranges-ok", detailsZipBytes, '"e2e-details-v1"');
    return;
  }
  if (url.pathname === "/ranges-ok/unfinished-tour.zip") {
    handleArchive(
      req,
      res,
      "ranges-ok",
      unfinishedZipBytes,
      '"e2e-unfinished-v1"',
    );
    return;
  }
  if (url.pathname === "/ranges-ok/stations-tour.zip") {
    handleArchive(req, res, "ranges-ok", stationsZipBytes, '"e2e-stations-v1"');
    return;
  }
  if (url.pathname === "/ranges-ok/stations-tour-no-code.zip") {
    handleArchive(
      req,
      res,
      "ranges-ok",
      stationsNoCodeZipBytes,
      '"e2e-stations-nc-v1"',
    );
    return;
  }
  if (url.pathname === "/ranges-ok/story-blocks-tour.zip") {
    handleArchive(
      req,
      res,
      "ranges-ok",
      storyBlocksZipBytes,
      '"e2e-story-blocks-v1"',
    );
    return;
  }
  if (url.pathname === "/ranges-ok/blocks-tour.zip") {
    handleArchive(req, res, "ranges-ok", blocksZipBytes, '"e2e-blocks-v1"');
    return;
  }
  if (url.pathname === "/ranges-ok/v3-tour.zip") {
    handleArchive(req, res, "ranges-ok", v3ZipBytes, '"e2e-v3-v1"');
    return;
  }
  if (url.pathname === "/ranges-ok/walk-tour.zip") {
    handleArchive(req, res, "ranges-ok", walkZipBytes, '"e2e-walk-v1"');
    return;
  }
  if (url.pathname === "/ranges-ok/walk-tour-fixed.zip") {
    handleArchive(req, res, "ranges-ok", walkFixedZipBytes, '"e2e-walk-f-v1"');
    return;
  }
  if (url.pathname === "/ranges-ok/sample-tour.zip") {
    // The committed sample tour (public/samples, owner decision S-D9).
    handleArchive(req, res, "ranges-ok", sampleZipBytes, '"e2e-sample-v1"');
    return;
  }
  if (url.pathname === "/ranges-ok/no-gps-tour.zip") {
    handleArchive(req, res, "ranges-ok", noGpsZipBytes, '"e2e-no-gps-v1"');
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
