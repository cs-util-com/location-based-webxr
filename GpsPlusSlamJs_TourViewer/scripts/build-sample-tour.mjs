// Writes the sample station tour (owner decision S-D9, 2026-10-05) to
// public/samples/marienplatz-tour.zip: three stations at Marienplatz in
// Munich, a well-known public place, so no private location reaches the
// public repository. Every asset is generated here (a pixel-art knight, a
// short fanfare, a grey arch), so there is nothing to license.
//
// Usage (from GpsPlusSlamJs_TourViewer): node scripts/build-sample-tour.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "public", "samples", "marienplatz-tour.zip");
/** A fixed date, so a rebuild with unchanged content gives the same bytes. */
const FIXED_DATE = new Date(Date.UTC(2026, 9, 5, 12, 0, 0));

// --- The knight: pixel art, 24 x 40 cells, each 8 x 8 pixels. ---
const KNIGHT = [
  "..........KKKK..........",
  ".........KSSSSK.........",
  "........KSSSSSSK........",
  "........KSKKKKSK........",
  "........KSKEEKSK........",
  "........KSSSSSSK........",
  ".........KSSSSK.........",
  "..........KSSK..........",
  "......KKKKKKKKKKKK......",
  ".....KRRRRRRRRRRRRK.....",
  "....KRRRRRRWWRRRRRRK....",
  "...KSKRRRRRWWRRRRRKSK...",
  "...KSKRRRWWWWWWRRRKSK...",
  "...KSKRRRWWWWWWRRRKSK...",
  "...KSKRRRRRWWRRRRRKSK...",
  "...KSKRRRRRWWRRRRRKSK...",
  "...KSKRRRRRWWRRRRRKSK...",
  "...KSKRRRRRRRRRRRRKSK...",
  "...KSKKKKKKKKKKKKKKSK...",
  "...KSKGGGGGGGGGGGGKSK...",
  "...KGKKKKKKKKKKKKKKGK...",
  "....K.KRRRRRRRRRRK.K....",
  "......KRRRRRRRRRRK......",
  "......KRRRRRRRRRRK......",
  "......KRRRRKKRRRRK......",
  "......KSSSK..KSSSK......",
  "......KSSSK..KSSSK......",
  "......KSSSK..KSSSK......",
  "......KSSSK..KSSSK......",
  "......KSSSK..KSSSK......",
  "......KSSSK..KSSSK......",
  "......KSSSK..KSSSK......",
  "......KSSSK..KSSSK......",
  "......KSSSK..KSSSK......",
  "......KSSSK..KSSSK......",
  "......KSSSK..KSSSK......",
  ".....KKSSSK..KSSSKK.....",
  "....KSSSSSK..KSSSSSK....",
  "....KKKKKKK..KKKKKKK....",
  "........................",
];
const COLOURS = {
  ".": [0, 0, 0, 0],
  K: [30, 30, 36, 255], // outline
  S: [176, 184, 196, 255], // steel
  E: [20, 20, 24, 255], // visor slit
  R: [168, 28, 36, 255], // red tabard
  W: [240, 228, 196, 255], // the cross
  G: [212, 170, 60, 255], // gold belt
};
const SCALE = 8;

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function knightPng() {
  const width = KNIGHT[0].length * SCALE;
  const height = KNIGHT.length * SCALE;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = KNIGHT[Math.floor(y / SCALE)];
    raw[y * (width * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const rgba = COLOURS[row[Math.floor(x / SCALE)]];
      raw.set(rgba, y * (width * 4 + 1) + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return {
    width,
    height,
    bytes: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(raw, { level: 9 })),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  };
}

// --- The fanfare: three rising notes, 16 kHz mono 16-bit WAV. ---
function fanfareWav() {
  const rate = 16_000;
  const notes = [
    [523.25, 0.25],
    [659.25, 0.25],
    [783.99, 0.6],
  ];
  const samples = [];
  for (const [freq, seconds] of notes) {
    const count = Math.round(rate * seconds);
    for (let i = 0; i < count; i += 1) {
      const envelope = Math.min(1, i / 400, (count - i) / 1600);
      samples.push(
        Math.round(
          0.35 * 32767 * envelope * Math.sin((2 * Math.PI * freq * i) / rate),
        ),
      );
    }
  }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// --- The arch: two pillars and a lintel, one grey mesh, a GLB. ---
function boxGeometry(cx, cy, cz, sx, sy, sz, positions, indices) {
  const base = positions.length / 3;
  for (const [x, y, z] of [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ]) {
    positions.push(cx + (x * sx) / 2, cy + (y * sy) / 2, cz + (z * sz) / 2);
  }
  for (const [a, b, c] of [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [3, 7, 6],
    [3, 6, 2],
    [0, 4, 7],
    [0, 7, 3],
    [1, 2, 6],
    [1, 6, 5],
  ]) {
    indices.push(base + a, base + b, base + c);
  }
}

function archGlb() {
  const positions = [];
  const indices = [];
  boxGeometry(-1.2, 1.25, 0, 0.5, 2.5, 0.5, positions, indices);
  boxGeometry(1.2, 1.25, 0, 0.5, 2.5, 0.5, positions, indices);
  boxGeometry(0, 2.75, 0, 2.9, 0.5, 0.5, positions, indices);
  const pos = Buffer.from(new Float32Array(positions).buffer);
  const idx = Buffer.from(new Uint16Array(indices).buffer);
  const bin = Buffer.concat([
    pos,
    idx,
    Buffer.alloc((4 - (idx.length % 4)) % 4),
  ]);
  const min = [0, 1, 2].map((k) =>
    Math.min(...positions.filter((_, i) => i % 3 === k)),
  );
  const max = [0, 1, 2].map((k) =>
    Math.max(...positions.filter((_, i) => i % 3 === k)),
  );
  const gltf = {
    asset: { version: "2.0", generator: "build-sample-tour.mjs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "arch" }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.62, 0.6, 0.56, 1],
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 },
      {
        buffer: 0,
        byteOffset: pos.length,
        byteLength: idx.length,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: "VEC3",
        min,
        max,
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: indices.length,
        type: "SCALAR",
      },
    ],
  };
  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(json.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4); // "JSON"
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4); // "BIN\0"
  return Buffer.concat([header, jsonHead, json, binHead, bin]);
}

// --- The tour. Marienplatz, Munich: the Mariensaeule (the column) and two
// spots about 30 m from it. Ground altitude about 519 m.
const COLUMN = { lat: 48.137393, lon: 11.575493 };
const M_PER_DEG = 111_320;
function geoAt(northM, eastM) {
  return {
    lat: COLUMN.lat + northM / M_PER_DEG,
    lon:
      COLUMN.lon + eastM / (M_PER_DEG * Math.cos((COLUMN.lat * Math.PI) / 180)),
    alt: 519,
    headingDeg: 0,
  };
}

export function buildSampleTour() {
  const knight = knightPng();
  return {
    tour: {
      version: 2,
      title: "The knight of Marienplatz (sample)",
      order: "fixed",
      objects: [],
      assets: [
        {
          id: "knight",
          path: "content/knight.png",
          width: knight.width,
          height: knight.height,
        },
        { id: "fanfare", path: "content/fanfare.wav" },
        { id: "arch", path: "content/arch.glb" },
      ],
      stations: [
        {
          id: "column",
          title: "The column",
          anchor: { geo: geoAt(0, 0) },
          activateRadiusM: 30,
          foundRadiusM: 5,
          steps: [
            {
              id: "greet",
              block: {
                kind: "character",
                name: "Sir Konrad",
                image: "knight",
                caption:
                  "Halt, traveller! I guard this square. Will you help me find the old gate?",
                voice: "fanfare",
              },
            },
            {
              id: "ask",
              block: {
                kind: "choice",
                prompt: "Help the knight?",
                options: [
                  { id: "yes", label: "Of course", goto: "thanks" },
                  { id: "no", label: "Not right now", goto: "later" },
                ],
              },
            },
            {
              id: "later",
              block: {
                kind: "text",
                text: "Sir Konrad sighs. Come back when you can - the gate is a few steps east.",
              },
            },
            {
              id: "thanks",
              block: {
                kind: "text",
                text: "Splendid! Walk about 30 m east, to the corner of the square.",
              },
            },
          ],
        },
        {
          id: "gate",
          title: "The old gate",
          anchor: { geo: geoAt(-10, 28) },
          activateRadiusM: 30,
          foundRadiusM: 5,
          steps: [
            {
              id: "arch",
              block: {
                kind: "model",
                asset: "arch",
                caption: "Here stood the old gate. Imagine riding through it.",
              },
            },
          ],
        },
        {
          id: "steps",
          title: "The town hall steps",
          anchor: { geo: geoAt(25, 12) },
          activateRadiusM: 30,
          foundRadiusM: 5,
          steps: [
            {
              id: "farewell",
              block: {
                kind: "character",
                name: "Sir Konrad",
                image: "knight",
                caption: "You found every place. Farewell, and thank you!",
              },
            },
          ],
        },
      ],
    },
    files: {
      "content/knight.png": knight.bytes,
      "content/fanfare.wav": fanfareWav(),
      "content/arch.glb": archGlb(),
    },
  };
}

export async function buildSampleTourZip() {
  const { tour, files } = buildSampleTour();
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  const options = { lastModDate: FIXED_DATE };
  await writer.add(
    "tour.json",
    new TextReader(`${JSON.stringify(tour, null, 2)}\n`),
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
  const bytes = await buildSampleTourZip();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, bytes);
  console.log(`wrote ${OUT} (${String(bytes.length)} bytes)`);
}
