// Pure size rules of the model bench: what the editor's model optimizer
// writes, restated for a page that cannot import its TypeScript. Every
// number here mirrors a constant of the shelf (src/editor/asset-shelf/):
// - optimizer-settings.ts: colour JPEG 0.85, data JPEG 0.92, 16-bit
//   positions (8-bit on request, 1 % budget), 8-bit normals, 16-bit texture
//   coordinates, keepAbove 0.9;
// - model-textures.ts: which images are colour, data or alpha, and the
//   format each is written in;
// - model-lod.ts: a saved chain of two coarser levels, each a quarter of
//   the one before, none under 64 triangles;
// - model-quantize.ts: every integer vertex attribute padded to 4 bytes,
//   16-bit indices while the vertices fit.
// Texture bytes are measured (the texture worker encodes them as the
// shelf's picture device does); geometry bytes are counted from the level.

export const COLOUR_QUALITY = 0.85;
export const DATA_QUALITY = 0.92;
/** The shelf keeps the original when the made file is above this share. */
export const KEEP_ABOVE = 0.9;
export const CHAIN_RATIO = 4;
export const CHAIN_LEVELS = 2;
export const CHAIN_MIN_TRIANGLES = 64;
/** The texture steps, largest first; "original" never resizes. */
export const TEXTURE_STEPS = [
  { id: "original", side: 16384, label: "Original" },
  { id: "2048", side: 2048, label: "2048" },
  { id: "1024", side: 1024, label: "1024" },
  { id: "512", side: 512, label: "512" },
  { id: "256", side: 256, label: "256" },
  { id: "128", side: 128, label: "128" },
];
/** The shelf's default texture side. */
export const DEFAULT_TEXTURE_STEP = "1024";

const JPEG = "image/jpeg";
const PNG = "image/png";

/** A GLB's JSON chunk and binary chunk, or throws in words. */
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
  const binStart = 20 + jsonLength + 8;
  const bin = bytes.subarray(binStart);
  return { json, jsonLength, bin };
}

const textureImage = (json, info) => {
  const texture = json.textures?.[info?.index];
  const source =
    texture?.source ?? texture?.extensions?.EXT_texture_webp?.source;
  return Number.isInteger(source) ? source : null;
};

/** How each image index is used: colour, data, alpha (the shelf's
 *  `imageUses`, core slots only, extension textures counted as data). */
export function imageUses(json) {
  const uses = new Map();
  const mark = (info, how) => {
    const image = textureImage(json, info);
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

/** The format an image of `mime` used as `use` is written in (the shelf's
 *  `textureFormat`): alpha stays PNG, a PNG data map stays PNG, everything
 *  else the lossy type at its quality. */
export function textureFormat(use, mime, webp) {
  const lossy = webp ? "image/webp" : JPEG;
  if (use.alpha) {
    return { type: PNG, quality: 1 };
  }
  if (use.data) {
    return mime === PNG
      ? { type: PNG, quality: 1 }
      : { type: lossy, quality: DATA_QUALITY };
  }
  return { type: lossy, quality: COLOUR_QUALITY };
}

/** The image jobs of a model: each image the shelf may rewrite, with its
 *  bytes, mime type and format rule. */
export function imageJobs(json, bin) {
  const uses = imageUses(json);
  const jobs = [];
  (json.images ?? []).forEach((image, index) => {
    const view = json.bufferViews?.[image.bufferView];
    const use = uses.get(index);
    if (!view || !use) {
      return;
    }
    const start = view.byteOffset ?? 0;
    const bytes = bin.subarray(start, start + view.byteLength);
    const mime = image.mimeType;
    jobs.push({
      index,
      bytes,
      mime,
      use,
      rewritable: mime === JPEG || mime === PNG,
    });
  });
  return jobs;
}

/** The bytes the file's images take (what the size bar calls pictures). */
export function originalShares(json, total) {
  let textures = 0;
  for (const image of json.images ?? []) {
    textures += json.bufferViews?.[image.bufferView]?.byteLength ?? 0;
  }
  return { total, textures, geometry: total - textures };
}

/** The chain the shelf saves after the author's level of `triangles`:
 *  the triangle counts of up to two coarser levels. */
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

/**
 * Geometry bytes of a made file, counted the way the shelf writes it.
 * @param {{ vertices: number, triangles: number, chain: number[],
 *   hasNormals: boolean, hasUvs: boolean, hasTangents: boolean,
 *   positionBits: 8 | 16, jsonBytes: number }} m
 */
export function geometryBytes(m) {
  const position = pad4((m.positionBits === 8 ? 1 : 2) * 3);
  const normal = m.hasNormals ? 4 : 0;
  const tangent = m.hasTangents ? 4 : 0;
  const uv = m.hasUvs ? 4 : 0;
  const vertexBytes = m.vertices * (position + normal + tangent + uv);
  const indexSize = m.vertices <= 65534 ? 2 : 4;
  const chainTriangles = m.chain.reduce((s, c) => s + c, 0);
  const indexBytes =
    pad4(3 * m.triangles * indexSize) + pad4(3 * chainTriangles * indexSize);
  // The JSON chunk, its 8-byte chunk headers and the 12-byte file header.
  return vertexBytes + indexBytes + pad4(m.jsonBytes) + 28;
}

/** "1.6 MiB", "412 KiB", "980 B". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "-";
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MiB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KiB`;
  }
  return `${Math.round(bytes)} B`;
}

/** "25 %", "4.2 %". */
export function formatShare(part, whole) {
  const p = (100 * part) / whole;
  return `${p.toFixed(p < 10 ? 1 : 0)} %`;
}

/** "17 456". */
export function formatCount(n) {
  return Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
}

/** "3.2 m", "45 m", "1.2 km". */
export function formatMetres(m) {
  if (m >= 1000) {
    return `${(m / 1000).toFixed(1)} km`;
  }
  if (m >= 10) {
    return `${Math.round(m)} m`;
  }
  if (m >= 1) {
    return `${m.toFixed(1)} m`;
  }
  return `${Math.round(m * 100)} cm`;
}

/** "0.4 mm", "1.2 cm". */
export function formatLength(m) {
  if (m < 0.01) {
    return `${(m * 1000).toFixed(m < 0.001 ? 2 : 1)} mm`;
  }
  if (m < 1) {
    return `${(m * 100).toFixed(1)} cm`;
  }
  return `${m.toFixed(2)} m`;
}

/**
 * A visitor's phone, for the distance levels: about 2400 px tall in
 * portrait and a 60 degree vertical field of view. The level a visitor
 * sees is the coarsest whose largest deviation stays under `budgetPx`.
 */
export const VISITOR_SCREEN_PX = 2400;
export const VISITOR_FOV_DEG = 60;

/** Pixels a metre covers on the visitor's phone at `distance` metres. */
export function pxPerMetre(distance) {
  const half = (VISITOR_FOV_DEG * Math.PI) / 360;
  return VISITOR_SCREEN_PX / (2 * Math.max(distance, 1e-6) * Math.tan(half));
}

/** The distance from which an error of `error` metres is `budgetPx`. */
export function switchDistance(error, budgetPx) {
  const half = (VISITOR_FOV_DEG * Math.PI) / 360;
  return (error * VISITOR_SCREEN_PX) / (2 * Math.tan(half) * budgetPx);
}

/** The "detail drop" slider (0 keeps detail longest, 100 drops soonest)
 *  as a pixel budget, 0.5 to 4 px on a log scale; 1 px at 33. */
export function budgetOf(drop) {
  const t = Math.min(100, Math.max(0, drop)) / 100;
  return 0.5 * Math.pow(8, t);
}

/** Interpolates an error curve (points of { share, error }, any order)
 *  at `share`, in log share; 0 at share 1. */
export function errorAt(curve, share) {
  if (share >= 1 || curve.length === 0) {
    return 0;
  }
  const pts = [{ share: 1, error: 0 }, ...curve].sort(
    (a, b) => b.share - a.share,
  );
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (share <= a.share && share >= b.share) {
      const t =
        (Math.log(a.share) - Math.log(share)) /
        (Math.log(a.share) - Math.log(b.share) || 1);
      return a.error + t * (b.error - a.error);
    }
  }
  return pts[pts.length - 1].error;
}
