// Writes the anchor field-test tour to public/samples/anchor-test-tour.zip:
// three stations that load the deferred anchors the way a real tour does
// (a tall animated model, a crowd of pins, an edge hint and a character's
// story), at the sample tour's public square. Opened with ?relocate=here
// the stations and their content move to the phone, so the test runs
// anywhere. Every asset is generated here, so there is nothing to license.
//
// Usage (from GpsPlusSlamJs_TourViewer): node scripts/build-anchor-test-tour.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import {
  parseTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  boxGeometry,
  facingFrom,
  ZIP_ENTRY_OPTIONS,
  geoAt,
  glbOf,
  headingTo,
  knightPng,
} from "./build-sample-tour.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "public", "samples", "anchor-test-tour.zip");

/** The tower's height (m): its largest side, so its `sizeM`. */
export const TOWER_HEIGHT_M = 8;
/** The tower's clip: the arm on top swings through 60 degrees and back. */
export const TOWER_CLIP = "swing";
/** How many pins stand at the pin station. */
export const PIN_COUNT = 12;
/** The pins' ring around the station (m). */
const PIN_RING_M = 4;
/** The one wide pin label: 40 characters, the caption's limit. */
export const WIDE_CAPTION = "A very wide label, as wide as it can be!";

const FLAT = [0, 0, 0, 1];

/**
 * A grey mast `TOWER_HEIGHT_M` tall with an arm on top that swings about
 * its own axis (clip `swing`, 2 s, looping): a tall model whose drawn
 * shape changes every frame, the hardest case for a view test.
 */
export function towerGlb() {
  const mastPos = [];
  const mastIdx = [];
  boxGeometry(
    0,
    (TOWER_HEIGHT_M - 0.5) / 2,
    0,
    0.4,
    TOWER_HEIGHT_M - 0.5,
    0.4,
    mastPos,
    mastIdx,
  );
  const armPos = [];
  const armIdx = [];
  // The arm's own frame sits on the mast's top; it reaches 1.5 m to one side.
  boxGeometry(0.75, 0.25, 0, 3, 0.5, 0.3, armPos, armIdx);
  const times = [0, 1, 2];
  const half = (deg) => (deg * Math.PI) / 360;
  const quat = (deg) => [0, 0, Math.sin(half(deg)), Math.cos(half(deg))];
  const turns = [...quat(-30), ...quat(30), ...quat(-30)];
  const chunks = [
    new Float32Array(mastPos),
    new Uint16Array(mastIdx),
    new Float32Array(armPos),
    new Uint16Array(armIdx),
    new Float32Array(times),
    new Float32Array(turns),
  ].map((a) => {
    const b = Buffer.from(a.buffer);
    return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  });
  let offset = 0;
  const bufferViews = chunks.map((c, i) => {
    const view = { buffer: 0, byteOffset: offset, byteLength: c.length };
    offset += c.length;
    if (i === 0 || i === 2) view.target = 34962;
    if (i === 1 || i === 3) view.target = 34963;
    return view;
  });
  const bounds = (p) => ({
    min: [0, 1, 2].map((k) => Math.min(...p.filter((_, i) => i % 3 === k))),
    max: [0, 1, 2].map((k) => Math.max(...p.filter((_, i) => i % 3 === k))),
  });
  const grey = (v) => ({
    pbrMetallicRoughness: {
      baseColorFactor: [v, v, v * 0.95, 1],
      metallicFactor: 0,
      roughnessFactor: 0.9,
    },
  });
  const gltf = {
    asset: { version: "2.0", generator: "build-anchor-test-tour.mjs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { mesh: 0, name: "mast", children: [1] },
      {
        mesh: 1,
        name: "arm",
        translation: [0, TOWER_HEIGHT_M - 0.5, 0],
        rotation: quat(-30),
      },
    ],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
      },
      {
        primitives: [{ attributes: { POSITION: 2 }, indices: 3, material: 1 }],
      },
    ],
    materials: [grey(0.6), grey(0.8)],
    buffers: [{ byteLength: offset }],
    bufferViews,
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: mastPos.length / 3,
        type: "VEC3",
        ...bounds(mastPos),
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: mastIdx.length,
        type: "SCALAR",
      },
      {
        bufferView: 2,
        componentType: 5126,
        count: armPos.length / 3,
        type: "VEC3",
        ...bounds(armPos),
      },
      {
        bufferView: 3,
        componentType: 5123,
        count: armIdx.length,
        type: "SCALAR",
      },
      {
        bufferView: 4,
        componentType: 5126,
        count: times.length,
        type: "SCALAR",
        min: [0],
        max: [2],
      },
      { bufferView: 5, componentType: 5126, count: times.length, type: "VEC4" },
    ],
    animations: [
      {
        name: TOWER_CLIP,
        samplers: [{ input: 4, output: 5, interpolation: "LINEAR" }],
        channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
      },
    ],
  };
  return glbOf(gltf, Buffer.concat(chunks));
}

// The stations, in metres from the sample tour's column, at its spots (and
// their ellipsoidal heights, `build-sample-tour.mjs.md`).
const AT_TOWER = [0, 0];
const AT_PINS = [-10, 28];
const AT_HINT = [25, 12];

/** The pin station's pins: a ring around the spot, the first one wide. */
function pins() {
  return Array.from({ length: PIN_COUNT }, (_, i) => {
    const a = (2 * Math.PI * i) / PIN_COUNT;
    const round = (v) => Math.round(v * 1000) / 1000 || 0;
    return {
      id: `pin-${String(i + 1)}`,
      kind: "shortText",
      view: "pin",
      caption: i === 0 ? WIDE_CAPTION : `Pin ${String(i + 1)}`,
      pose: {
        position: [
          round(PIN_RING_M * Math.cos(a)),
          0,
          round(PIN_RING_M * Math.sin(a)),
        ],
        rotation: FLAT,
      },
    };
  });
}

export function buildAnchorTestTour() {
  const knight = knightPng();
  return {
    tour: {
      version: 5,
      minor: 0,
      title: "Anchor field test",
      // Any order: the test walks the stations as it likes.
      order: "any",
      assets: [
        {
          id: "knight",
          path: "content/knight.png",
          width: knight.width,
          height: knight.height,
        },
        { id: "tower", path: "content/tower.glb" },
      ],
      stations: [
        {
          id: "tower",
          title: "A: the tower",
          description:
            "A tall model whose arm swings. Walk around it and look away and back.",
          geo: geoAt(...AT_TOWER, 561.5),
          activateRadiusM: 30,
          foundRadiusM: 5,
          hint: "arrow",
          children: [
            {
              id: "tower-model",
              kind: "model",
              view: "placed",
              asset: "tower",
              sizeM: TOWER_HEIGHT_M,
              title: "The swinging tower",
              animation: { name: TOWER_CLIP, autoplay: true },
              pose: { position: [3, 0, 0], rotation: FLAT },
            },
          ],
        },
        {
          id: "pins",
          title: "B: the pins",
          description:
            "Twelve pins in a ring, one with a wide label. Turn on the spot.",
          geo: geoAt(...AT_PINS, 559.9),
          activateRadiusM: 30,
          foundRadiusM: 5,
          hint: "arrow",
          children: pins(),
        },
        {
          id: "hint",
          title: "C: the edge hint",
          description:
            "A short text that keeps to the screen's edge, and a knight's story.",
          geo: geoAt(...AT_HINT, 561.9),
          activateRadiusM: 30,
          foundRadiusM: 5,
          hint: "arrow",
          children: [
            {
              id: "hint-text",
              kind: "shortText",
              view: "edgeHint",
              caption: "Look here",
              pose: { position: [0, 1.5, 4], rotation: FLAT },
            },
            {
              id: "hint-story",
              kind: "folder",
              role: "story",
              title: "The knight",
              children: [
                {
                  id: "hint-knight",
                  kind: "character",
                  view: "bubble",
                  name: "Sir Konrad",
                  image: "knight",
                  caption: "Look away from me and back: I should not jump.",
                  pose: facingFrom(headingTo(AT_HINT, AT_PINS)),
                  advance: { mode: "tap" },
                },
              ],
            },
          ],
        },
      ],
    },
    files: {
      "content/knight.png": knight.bytes,
      "content/tower.glb": towerGlb(),
    },
  };
}

export async function buildAnchorTestTourZip() {
  const { tour, files } = buildAnchorTestTour();
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  const options = ZIP_ENTRY_OPTIONS;
  // Through the format's own reader and writer: a tour the reader
  // refuses fails the build, not the phone.
  await writer.add(
    "tour.json",
    new TextReader(serializeTourManifest(parseTourManifest(tour))),
    options,
  );
  for (const [name, bytes] of Object.entries(files)) {
    await writer.add(
      name,
      new Uint8ArrayReader(new Uint8Array(bytes)),
      options,
    );
  }
  return writer.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bytes = await buildAnchorTestTourZip();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, bytes);
  console.log(`wrote ${OUT} (${String(bytes.length)} bytes)`);
}
