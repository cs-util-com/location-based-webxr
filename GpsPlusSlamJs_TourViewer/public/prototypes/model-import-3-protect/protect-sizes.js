// Pure size rules of the protect prototype: what the editor's model
// optimizer writes, restated for a static page that cannot import its
// TypeScript. Each rule names the shelf file it follows
// (src/editor/asset-shelf/):
// - optimizer-settings.ts: colour JPEG 0.85, data JPEG 0.92, 16-bit
//   positions (8-bit on request), 8-bit normals, 16-bit texture
//   coordinates, the original kept above 90 % of its size;
// - model-textures.ts: which images are colour, data or alpha;
// - model-lod.ts: two coarser saved levels, each a quarter of the one
//   before, none under 64 triangles;
// - model-quantize.ts: integer vertex attributes padded to 4 bytes,
//   16-bit indices while the vertices fit.
// Picture bytes are measured by the picture worker; shape bytes are
// counted from the level shown.

export const KEEP_ABOVE = 0.9;
export const CHAIN_RATIO = 4;
export const CHAIN_LEVELS = 2;
export const CHAIN_MIN_TRIANGLES = 64;

/** The picture steps, largest first; "original" never resizes. */
export const PICTURE_STEPS = [
  { id: "original", side: 16384, label: "Original" },
  { id: "2048", side: 2048, label: "2048" },
  { id: "1024", side: 1024, label: "1024" },
  { id: "512", side: 512, label: "512" },
  { id: "256", side: 256, label: "256" },
  { id: "128", side: 128, label: "128" },
];
export const DEFAULT_PICTURE_STEP = "1024";

const JPEG = "image/jpeg";
const PNG = "image/png";

/** A GLB's JSON and binary chunk, or throws in words. */
export function readGlb(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20) {
    throw new Error("this file is too short to be a 3D model");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) {
    throw new Error("this file is not a binary glTF (.glb) model");
  }
  const jsonLength = view.getUint32(12, true);
  if (20 + jsonLength > bytes.length) {
    throw new Error("this model file is cut short");
  }
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  );
  return { json, jsonLength, bin: bytes.subarray(20 + jsonLength + 8) };
}

const imageOf = (json, info) => {
  const texture = json.textures?.[info?.index];
  const source =
    texture?.source ?? texture?.extensions?.EXT_texture_webp?.source;
  return Number.isInteger(source) ? source : null;
};

/** How each image is used: colour, data, alpha. */
export function imageUses(json) {
  const uses = new Map();
  const mark = (info, how) => {
    const image = imageOf(json, info);
    if (image === null) {
      return;
    }
    const use = uses.get(image) ?? { colour: false, data: false, alpha: false };
    use[how] = true;
    uses.set(image, use);
  };
  for (const material of json.materials ?? []) {
    const pbr = material.pbrMetallicRoughness ?? {};
    mark(pbr.baseColorTexture, "colour");
    if (material.alphaMode === "BLEND" || material.alphaMode === "MASK") {
      mark(pbr.baseColorTexture, "alpha");
    }
    mark(material.emissiveTexture, "colour");
    mark(pbr.metallicRoughnessTexture, "data");
    mark(material.normalTexture, "data");
    mark(material.occlusionTexture, "data");
  }
  return uses;
}

/** The format an image is written in: alpha and PNG data maps stay PNG,
 *  everything else the lossy type at its quality. */
export function pictureFormat(use, mime, webp) {
  const lossy = webp ? "image/webp" : JPEG;
  if (use.alpha) {
    return { type: PNG, quality: 1 };
  }
  if (use.data) {
    return mime === PNG
      ? { type: PNG, quality: 1 }
      : { type: lossy, quality: 0.92 };
  }
  return { type: lossy, quality: 0.85 };
}

/** The images the shelf may rewrite, with their bytes and use. */
export function pictureJobs(json, bin) {
  const uses = imageUses(json);
  const jobs = [];
  (json.images ?? []).forEach((image, index) => {
    const view = json.bufferViews?.[image.bufferView];
    const use = uses.get(index);
    if (!view || !use) {
      return;
    }
    const start = view.byteOffset ?? 0;
    jobs.push({
      index,
      bytes: bin.subarray(start, start + view.byteLength),
      mime: image.mimeType,
      use,
      rewritable: image.mimeType === JPEG || image.mimeType === PNG,
    });
  });
  return jobs;
}

/** The original's bytes split into pictures and shape. */
export function originalSplit(json, total) {
  let pictures = 0;
  for (const image of json.images ?? []) {
    pictures += json.bufferViews?.[image.bufferView]?.byteLength ?? 0;
  }
  return { total, pictures, shape: total - pictures };
}

/** The triangle counts of the coarser levels the shelf saves after the
 *  author's level. */
export function chainCounts(triangles, floor = 0) {
  const counts = [];
  let last = triangles;
  for (let i = 0; i < CHAIN_LEVELS; i++) {
    const next = Math.max(floor, Math.round(last / CHAIN_RATIO));
    if (next < CHAIN_MIN_TRIANGLES || next >= last) {
      break;
    }
    counts.push(next);
    last = next;
  }
  return counts;
}

const pad4 = (n) => Math.ceil(n / 4) * 4;

/** Shape bytes of one part as the shelf writes it. */
export function shapeBytes(m) {
  const position = pad4((m.positionBits === 8 ? 1 : 2) * 3);
  const vertexBytes =
    m.vertices * (position + (m.hasNormals ? 4 : 0) + (m.hasUvs ? 4 : 0));
  const indexSize = m.vertices <= 65534 ? 2 : 4;
  const chain = m.chain.reduce((s, c) => s + c, 0);
  return (
    vertexBytes +
    pad4(3 * m.triangles * indexSize) +
    pad4(3 * chain * indexSize)
  );
}

/** "1.6 MB", "412 KB", "980 B" (powers of 1024, as the shelf shows). */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "-";
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

/** "25 %", "4.2 %". */
export function formatShare(part, whole) {
  const p = (100 * part) / Math.max(1, whole);
  return `${p.toFixed(p < 10 ? 1 : 0)} %`;
}

/** "17 456". */
export function formatCount(n) {
  return Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
}

/** "3.2 m", "45 m", "80 cm". */
export function formatMetres(m) {
  if (m >= 10) {
    return `${Math.round(m)} m`;
  }
  if (m >= 1) {
    return `${m.toFixed(1)} m`;
  }
  return `${Math.round(m * 100)} cm`;
}

/** A visitor's phone for the distance levels: 2400 px tall, a 60 degree
 *  vertical field of view. */
export const VISITOR_SCREEN_PX = 2400;
export const VISITOR_FOV_DEG = 60;
const HALF_TAN = Math.tan((VISITOR_FOV_DEG * Math.PI) / 360);

/** Pixels a metre covers on the visitor's phone at `distance` metres. */
export function pxPerMetre(distance) {
  return VISITOR_SCREEN_PX / (2 * Math.max(distance, 1e-6) * HALF_TAN);
}

/** The distance beyond which an error of `error` metres stays under
 *  `budgetPx` on the visitor's phone. */
export function switchDistance(error, budgetPx) {
  return (error * VISITOR_SCREEN_PX) / (2 * HALF_TAN * budgetPx);
}

/**
 * The three distance presets: how many phone pixels a coarser level may
 * be off before it is used. Parameters, not measurements: see the README.
 */
export const DISTANCE_PRESETS = [
  {
    id: "far-sharp",
    label: "Sharp from afar",
    hint: "Full detail far out. Heavier for phones.",
    budgetPx: 0.5,
  },
  {
    id: "balanced",
    label: "Balanced",
    hint: "Coarser levels only once the change is under a pixel.",
    budgetPx: 1,
  },
  {
    id: "near-only",
    label: "Detail up close only",
    hint: "Coarser levels early. Lightest for phones.",
    budgetPx: 3,
  },
];
export const DEFAULT_DISTANCE_PRESET = "balanced";
