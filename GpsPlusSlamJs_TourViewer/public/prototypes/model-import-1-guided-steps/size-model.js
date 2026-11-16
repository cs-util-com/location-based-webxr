// The byte arithmetic of the guided model import: where a .glb's bytes are
// (pictures against shape), how the shelf's optimizer would store the
// geometry, which format each picture is written in, and the distance at
// which a coarser level of detail takes over. Pure functions, no DOM.
//
// The geometry layout and the picture rules follow the editor's asset
// shelf (model-quantize.ts, model-textures.ts and model-lod.ts): positions
// as 16-bit (or 8-bit) integers in 4-byte strides, normals and tangents as
// 8-bit, texture coordinates as 16-bit when they lie in 0..1, index lists
// 16-bit below 65 535 vertices. The page proposes more coarser levels than
// the shelf saves today (it saves two, a quarter and a sixteenth): see
// LEVEL_RULE.

const JPEG = "image/jpeg";
const PNG = "image/png";
export const WEBP = "image/webp";

/** The shelf's picture qualities and the 8-bit option's error budget. */
export const SHELF = {
  colourQuality: 0.85,
  dataQuality: 0.92,
  position8Error: 0.01,
  defaultSide: 1024,
};

/** The picture sizes offered, largest first. "Original" re-encodes at the
 *  picture's own size (the shelf never enlarges). */
export const TEXTURE_STEPS = [
  { id: "original", label: "Original", side: Infinity },
  { id: "2048", label: "2048 px", side: 2048 },
  { id: "1024", label: "1024 px", side: 1024 },
  { id: "512", label: "512 px", side: 512 },
  { id: "256", label: "256 px", side: 256 },
  { id: "128", label: "128 px", side: 128 },
];

/** How the distance levels are chosen. Candidates halve the triangles of
 *  the one before, from the author's level down to the fewest the
 *  simplifier reaches (and never below `minTriangles`). A candidate is
 *  saved when its largest deviation has grown by `minGrowth` over the
 *  last saved level: a level that deviates barely more than the one
 *  before would take over at almost the same distance, so it would cost
 *  bytes and save no drawing. When that leaves fewer than `minLevels`,
 *  the growth asked for is lowered step by step (to 1.2, then to any
 *  growth at all), so a model that can be reduced gets at least six.
 *  At most `maxLevels` are saved. */
export const LEVEL_RULE = {
  ratio: 0.5,
  minGrowth: 1.4,
  minLevels: 6,
  maxLevels: 10,
  minTriangles: 8,
};

/** A phone held upright, for the switching distances: its screen height
 *  in device pixels. The preview camera's field of view is used with it. */
export const PHONE_SCREEN_PX = 2000;

/** The candidate triangle counts for the distance levels below an author's
 *  level of `top` triangles, largest first (`top` itself included), down
 *  to `floor` (the fewest the simplifier reaches). */
export function levelTargets(top, floor, rule = LEVEL_RULE) {
  const least = Math.max(1, floor, rule.minTriangles);
  const out = [Math.max(1, Math.round(top))];
  let t = out[0];
  while (out.length < 64) {
    t = Math.round(t * rule.ratio);
    if (t < least) {
      break;
    }
    out.push(t);
  }
  return out;
}

/** Which measured candidates ({ count, error }, largest count first, the
 *  author's level first) are saved, by LEVEL_RULE. Returns their indices.
 *  Candidates whose count does not drop, or whose error does not grow,
 *  are never saved: they would never be drawn. */
export function chooseLevels(candidates, rule = LEVEL_RULE) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }
  const pick = (growth) => {
    const kept = [0];
    for (
      let i = 1;
      i < candidates.length && kept.length < rule.maxLevels;
      i++
    ) {
      const last = candidates[kept[kept.length - 1]];
      const c = candidates[i];
      const grew =
        last.error > 0 ? c.error >= last.error * growth : c.error > 0;
      if (c.count < last.count && c.error > last.error && grew) {
        kept.push(i);
      }
    }
    return kept;
  };
  let kept = pick(rule.minGrowth);
  for (const growth of [1.2, 1]) {
    if (kept.length >= rule.minLevels) {
      break;
    }
    kept = pick(growth);
  }
  return kept;
}

/** The positions stored as 8-bit integers the way the preview stores them
 *  (one grid over the bounding box's longest side, centred on the box),
 *  and the largest distance any point moves. */
export function compactPositions(positions, center, maxExtent) {
  const out = new Float32Array(positions.length);
  if (!(maxExtent > 0)) {
    out.set(positions);
    return { positions: out, maxError: 0 };
  }
  const scale = maxExtent / 2 / 127;
  let worst = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    let d2 = 0;
    for (let c = 0; c < 3; c++) {
      const q = Math.max(
        -127,
        Math.min(127, Math.round((positions[i + c] - center[c]) / scale)),
      );
      out[i + c] = center[c] + q * scale;
      d2 += (out[i + c] - positions[i + c]) ** 2;
    }
    worst = Math.max(worst, d2);
  }
  return { positions: out, maxError: Math.sqrt(worst) };
}

/** Compact points are on by default when the error they add stays below
 *  `visiblePx` on the phone screen for a visitor `closestM` metres away,
 *  the closest a visitor usually stands to a placed model. */
export const COMPACT_RULE = { closestM: 1, visiblePx: 1 };

/** A length in metres as pixels on the phone at `distance` metres. */
export function screenPixels(metres, distance, fovDeg) {
  const tan = Math.tan((fovDeg * Math.PI) / 180 / 2);
  return (metres * PHONE_SCREEN_PX) / (2 * tan * distance);
}

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** A .glb's JSON and binary chunk. Throws a plain-language error on a
 *  file that is not a binary glTF 2.0. */
export function readGlb(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) {
    throw new Error("this file is too short to be a 3D model");
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) {
    throw new Error("this is not a .glb file (binary glTF 2.0)");
  }
  let at = 12;
  let json = null;
  let bin = new Uint8Array(0);
  while (at + 8 <= buffer.byteLength) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const body = new Uint8Array(
      buffer,
      at + 8,
      Math.min(length, buffer.byteLength - at - 8),
    );
    if (type === JSON_CHUNK) {
      json = JSON.parse(new TextDecoder().decode(body));
    } else if (type === BIN_CHUNK) {
      bin = body;
    }
    at += 8 + length;
  }
  if (json === null || typeof json !== "object") {
    throw new Error("the model's description is missing");
  }
  return { json, bin, total: buffer.byteLength };
}

const list = (json, key) => (Array.isArray(json[key]) ? json[key] : []);

/** The image a texture reference ({ index }) draws from, or null. */
function imageOf(json, info) {
  const texture = list(json, "textures")[info?.index];
  const source =
    texture?.source ?? texture?.extensions?.EXT_texture_webp?.source;
  return Number.isInteger(source) ? source : null;
}

/** The plain name of a material slot, for the page's sentences. */
const SLOT_ROLES = {
  baseColorTexture: "colour",
  emissiveTexture: "glow",
  normalTexture: "bumps",
  metallicRoughnessTexture: "shine",
  occlusionTexture: "shadows",
};

function markUse(uses, image, how, role) {
  if (image === null) {
    return;
  }
  const use = uses.get(image) ?? {
    colour: false,
    data: false,
    alpha: false,
    roles: new Set(),
  };
  use[how] = true;
  if (role) {
    use.roles.add(role);
  }
  uses.set(image, use);
}

/** Material slots besides the base colour: where each lives, how the
 *  shelf treats it, and its plain name. */
const OTHER_SLOTS = [
  { pbr: false, key: "emissiveTexture", how: "colour" },
  { pbr: true, key: "metallicRoughnessTexture", how: "data" },
  { pbr: false, key: "normalTexture", how: "data" },
  { pbr: false, key: "occlusionTexture", how: "data" },
];

/** How each image is used, by image index, as the shelf decides it. */
export function imageUses(json) {
  const uses = new Map();
  for (const item of list(json, "materials")) {
    const material = item ?? {};
    const pbr = material.pbrMetallicRoughness ?? {};
    const base = imageOf(json, pbr.baseColorTexture);
    markUse(uses, base, "colour", SLOT_ROLES.baseColorTexture);
    if (["BLEND", "MASK"].includes(material.alphaMode)) {
      markUse(uses, base, "alpha");
    }
    for (const slot of OTHER_SLOTS) {
      const info = (slot.pbr ? pbr : material)[slot.key];
      markUse(uses, imageOf(json, info), slot.how, SLOT_ROLES[slot.key]);
    }
  }
  return uses;
}

/** The format a picture is written in (the shelf's rule): alpha keeps
 *  PNG, a data map keeps PNG when it came as PNG, the rest goes lossy. */
export function textureFormat(use, mime, webp) {
  const lossy = webp ? WEBP : JPEG;
  if (use.alpha) {
    return { type: PNG, quality: 1 };
  }
  if (use.data) {
    return mime === PNG
      ? { type: PNG, quality: 1 }
      : { type: lossy, quality: SHELF.dataQuality };
  }
  return { type: lossy, quality: SHELF.colourQuality };
}

/** The pictures the optimizer may rewrite: in the binary chunk, JPEG or
 *  PNG, used by a material. Each with its bytes and use. */
export function pictureEntries(glb) {
  const uses = imageUses(glb.json);
  const views = list(glb.json, "bufferViews");
  const out = [];
  list(glb.json, "images").forEach((image, index) => {
    const view = views[image?.bufferView];
    const use = uses.get(index);
    if (!view || !use || (image.mimeType !== JPEG && image.mimeType !== PNG)) {
      return;
    }
    const start = view.byteOffset ?? 0;
    out.push({
      index,
      mime: image.mimeType,
      bytes: glb.bin.slice(start, start + view.byteLength),
      use,
      roles: [...use.roles],
    });
  });
  return out;
}

/** The longest side of a JPEG or PNG, read from its header; 0 when it
 *  cannot be read. */
export function imageSide(bytes, mime) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) {
    return 0;
  }
  const be16 = (i) => (bytes[i] << 8) | bytes[i + 1];
  if (mime === PNG) {
    const be32 = (i) => be16(i) * 65536 + be16(i + 2);
    return Math.max(be32(16), be32(20));
  }
  let at = 2;
  while (at + 9 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      return Math.max(be16(at + 5), be16(at + 7));
    }
    at += 2 + be16(at + 2);
  }
  return 0;
}

/** Where the original file's bytes are: pictures (every image in the
 *  binary chunk), shape (the rest of the binary chunk) and the remainder
 *  (description, headers, padding). */
export function byteShares(glb) {
  const views = list(glb.json, "bufferViews");
  let pictures = 0;
  for (const image of list(glb.json, "images")) {
    pictures += views[image?.bufferView]?.byteLength ?? 0;
  }
  const binary = views.reduce((s, v) => s + (v?.byteLength ?? 0), 0);
  return {
    total: glb.total,
    pictures,
    shape: Math.max(0, binary - pictures),
    other: Math.max(0, glb.total - binary),
  };
}

/** Which lever comes first: the larger share of the original's bytes. */
export function recommendFirst(shares) {
  const lever = shares.pictures + shares.shape;
  const pictureShare = lever > 0 ? shares.pictures / lever : 0;
  return pictureShare >= 0.5
    ? { first: "pictures", share: shares.pictures / shares.total }
    : { first: "shape", share: shares.shape / shares.total };
}

const pad4 = (n) => (n + 3) & ~3;

/** The geometry bytes the shelf would write for one primitive: `vertices`
 *  used by the saved levels, `triangles` over all saved levels. */
export function geometryBytes(g) {
  const position = g.positionBits === 8 ? 4 : 8;
  const normal = g.normal ? 4 : 0;
  const uv = g.uv ? (g.uvInUnit ? 4 : 8) : 0;
  const tangent = g.tangent ? 4 : 0;
  const index = g.vertices <= 65534 ? 2 : 4;
  return (
    g.vertices * (position + normal + uv + tangent) +
    pad4(g.triangles * 3 * index)
  );
}

/** The description's extra bytes for the saved levels and the
 *  quantization node, measured on the shelf's output at a few hundred. */
export const LEVELS_JSON_BYTES = 400;

/** The original's description and padding, carried over as they are. */
export function overheadBytes(shares) {
  return shares.other + LEVELS_JSON_BYTES;
}

/** "1.6 MB", "412 KB", "980 B" (powers of 1000, as file managers show). */
export function formatBytes(n) {
  if (!Number.isFinite(n)) {
    return "-";
  }
  if (n >= 1e6) {
    return (n / 1e6).toFixed(n >= 1e7 ? 0 : 2) + " MB";
  }
  if (n >= 1e3) {
    return Math.round(n / 1e3) + " KB";
  }
  return Math.round(n) + " B";
}

/** "0.8 mm", "3.2 cm", "1.20 m", for a length in metres. */
export function formatLength(m) {
  if (!(m >= 0)) {
    return "-";
  }
  if (m < 0.01) {
    return (m * 1000).toFixed(m < 0.001 ? 2 : 1) + " mm";
  }
  if (m < 1) {
    return (m * 100).toFixed(1) + " cm";
  }
  return m < 10 ? m.toFixed(2) + " m" : Math.round(m) + " m";
}

/** The detail-drop slider (1..100) as the error allowed on a phone's
 *  screen in pixels: 50 is one pixel (the standard), each 16.5 steps
 *  doubles or halves it, so 1 is about 0.13 px and 100 about 8 px. */
export function pixelBudget(slider) {
  const s = Math.min(100, Math.max(1, Number(slider) || 50));
  return Math.pow(2, (s - 50) / 16.5);
}

/** The viewer distance from which a level whose largest deviation is
 *  `error` (metres) shows at most `budget` pixels on the phone. */
export function switchDistance(error, budget, fovDeg) {
  if (!(error > 0)) {
    return 0;
  }
  const tan = Math.tan((fovDeg * Math.PI) / 180 / 2);
  return (error * PHONE_SCREEN_PX) / (2 * tan * budget);
}

/** The level a viewer at `distance` gets: the coarsest whose switching
 *  distance is reached. `levels` carry their `error`. */
export function levelAt(levels, distance, budget, fovDeg) {
  let pick = 0;
  levels.forEach((level, i) => {
    if (distance >= switchDistance(level.error, budget, fovDeg)) {
      pick = i;
    }
  });
  return pick;
}
