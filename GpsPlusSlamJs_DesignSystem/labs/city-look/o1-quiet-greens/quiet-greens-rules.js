/**
 * O1 quiet greens, the pure part: what a tree is from its tags, its size and
 * its muted colour, a barrier's colour and size, and where cosmetic trees go
 * inside mapped woods, orchards and tree rows. No three.js, no DOM.
 *
 * @see quiet-greens-rules.js.md
 */
import { seededRandom } from "../city-look-model.js";

/** Every number the page rests on, in one place, so a sweep can name it. */
export const PARAMS = Object.freeze({
  /** The page's default-height toggle; the first is today's `DEFAULT_TREE_HEIGHT_M`. */
  treeHeightsM: Object.freeze([8, 10, 12]),
  /** An untagged tree is the default times 0.75 to 1.25, as the library does. */
  heightJitter: 0.25,
  /** An untagged crown is this times the height, as the library does. */
  crownRatio: 0.6,
  /** Tagged values outside these are refused, not drawn. */
  maxTreeHeightM: 60,
  maxCrownM: 40,
  /** The trunk-and-crown LOD: nearer than this, the detailed tree. */
  lodNearM: 120,
  /** Cosmetic woods: twice OSM2World's 1 tree per 100 m2 (0.01 read as a park, swept), and a hard cap. */
  woodDensityPerM2: 0.02,
  woodCap: 3000,
  /** Wood trees are taller than street trees; an invented factor. */
  forestHeightFactor: 1.5,
  orchardSpacingM: 6,
  orchardHeightM: 4.5,
  rowSpacingM: 8,
  /** A row tree within this of a mapped tree is the mapped tree. */
  rowClearM: 4,
  /** Lightness spread per tree, plus or minus half of this. */
  colourJitter: 0.16,
});

const FEET_M = 0.3048;

/**
 * A length tag in metres: `12`, `12 m`, `12.5m`, `25'`, `3'6"`. Undefined for
 * anything else, and for a value that is not above zero.
 */
export function parseLengthM(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim().replace(",", ".");
  let metres;
  const feet = /^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/.exec(text);
  if (feet) {
    metres = Number(feet[1]) * FEET_M + Number(feet[2] ?? 0) * 0.0254;
  } else {
    const plain = /^(-?\d+(?:\.\d+)?)\s*(m|metres?|meters?)?$/i.exec(text);
    if (!plain) return undefined;
    metres = Number(plain[1]);
  }
  return Number.isFinite(metres) && metres > 0 ? metres : undefined;
}

/** `leaf_type` and the older `wood`, both controlled vocabularies. */
const LEAF_TYPES = {
  broadleaved: "broadleaved",
  deciduous: "broadleaved",
  needleleaved: "needleleaved",
  coniferous: "needleleaved",
  mixed: "mixed",
};

/**
 * Genera whose leaf type is not in doubt. A mapped genus is read, never
 * guessed: an untagged tree stays unknown (DEC-R4-10).
 */
const NEEDLE_GENERA = new Set([
  "Abies",
  "Cedrus",
  "Chamaecyparis",
  "Cupressus",
  "Juniperus",
  "Larix",
  "Metasequoia",
  "Picea",
  "Pinus",
  "Pseudotsuga",
  "Sequoia",
  "Sequoiadendron",
  "Taxodium",
  "Taxus",
  "Thuja",
  "Tsuga",
]);
const DECIDUOUS_NEEDLE_GENERA = new Set(["Larix", "Metasequoia", "Taxodium"]);
const BROAD_GENERA = new Set([
  "Acer",
  "Aesculus",
  "Ailanthus",
  "Alnus",
  "Betula",
  "Carpinus",
  "Castanea",
  "Catalpa",
  "Celtis",
  "Cornus",
  "Corylus",
  "Crataegus",
  "Fagus",
  "Fraxinus",
  "Gleditsia",
  "Juglans",
  "Liquidambar",
  "Liriodendron",
  "Magnolia",
  "Malus",
  "Platanus",
  "Populus",
  "Prunus",
  "Pyrus",
  "Quercus",
  "Robinia",
  "Salix",
  "Sorbus",
  "Styphnolobium",
  "Tilia",
  "Ulmus",
  "Zelkova",
]);

function genusOf(tags) {
  for (const key of ["genus", "species", "taxon"]) {
    const value = tags[key];
    if (typeof value !== "string" || value.trim() === "") continue;
    const word = value.trim().split(/\s+/)[0];
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  return undefined;
}

/**
 * What a tree (or a wood) is from its tags: `{ leafType, leafCycle, source }`.
 * `leafType` is broadleaved, needleleaved, mixed (areas) or unknown;
 * `leafCycle` deciduous, evergreen or unknown; `source` names the tag that
 * decided the type, or `none`.
 */
export function treeClass(tags = {}) {
  let leafType = "unknown";
  let source = "none";
  for (const key of ["leaf_type", "wood"]) {
    const value = LEAF_TYPES[tags[key]];
    if (value) {
      leafType = value;
      source = key;
      break;
    }
  }
  const genus = genusOf(tags);
  if (leafType === "unknown" && genus) {
    if (NEEDLE_GENERA.has(genus)) leafType = "needleleaved";
    else if (BROAD_GENERA.has(genus)) leafType = "broadleaved";
    if (leafType !== "unknown") source = "genus";
  }
  let leafCycle = "unknown";
  if (tags.leaf_cycle === "deciduous" || tags.leaf_cycle === "semi_deciduous") {
    leafCycle = "deciduous";
  } else if (
    tags.leaf_cycle === "evergreen" ||
    tags.leaf_cycle === "semi_evergreen"
  ) {
    leafCycle = "evergreen";
  } else if (genus && DECIDUOUS_NEEDLE_GENERA.has(genus)) {
    leafCycle = "deciduous";
  }
  return { leafType, leafCycle, source };
}

/** Max minus min channel of an sRGB colour, the metric of DEC-R4-5. */
export function chroma(hex) {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** The muted tree palette, sRGB. Chroma 20-35 against today's 62. */
const TREE_PALETTE = {
  "broadleaved/deciduous": 0x7b8663,
  "broadleaved/unknown": 0x77845f,
  "broadleaved/evergreen": 0x5f6e55,
  "needleleaved/evergreen": 0x52665c,
  "needleleaved/unknown": 0x55685d,
  "needleleaved/deciduous": 0x80875f,
  unknown: 0x737c66,
};

/** `c` pulled towards its own grey by `tint` (1 keeps it, 0 is grey). */
function tinted(hex, tint, lightness) {
  const channels = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const grey = (channels[0] + channels[1] + channels[2]) / 3;
  const out = channels.map((c) => {
    const v = (grey + (c - grey) * tint) * lightness;
    return Math.max(0, Math.min(255, Math.round(v)));
  });
  return (out[0] << 16) | (out[1] << 8) | out[2];
}

/**
 * A tree's sRGB colour: the class's muted green, a seeded lightness spread
 * from its key, and `tint` (0 to about 1.3) scaling the chroma for the sweep.
 */
export function treeColour(
  { leafType, leafCycle },
  key,
  { tint = 1, jitter = PARAMS.colourJitter } = {},
) {
  const base =
    leafType === "broadleaved" || leafType === "needleleaved"
      ? TREE_PALETTE[`${leafType}/${leafCycle}`]
      : TREE_PALETTE.unknown;
  const lightness = 1 + (seededRandom(`${key}|l`) - 0.5) * jitter;
  return tinted(base, tint, lightness);
}

/**
 * A tree's size in metres: `{ heightM, crownM, trunkRadiusM, heightTagged }`.
 * Tagged `height`, `diameter_crown` and `circumference` win; an untagged
 * height is the default times a seeded factor, so the default toggle moves
 * untagged trees only.
 */
export function treeSize(tags = {}, key, { defaultHeightM = 8 } = {}) {
  const tagged = parseLengthM(tags.height);
  const heightTagged = tagged !== undefined && tagged <= PARAMS.maxTreeHeightM;
  const heightM = heightTagged
    ? tagged
    : defaultHeightM *
      (1 -
        PARAMS.heightJitter +
        seededRandom(`${key}|h`) * 2 * PARAMS.heightJitter);
  const crownTag = parseLengthM(tags.diameter_crown);
  const crownM =
    crownTag !== undefined && crownTag <= PARAMS.maxCrownM
      ? crownTag
      : heightM * PARAMS.crownRatio;
  const girth = parseLengthM(tags.circumference);
  const trunkRadiusM =
    girth !== undefined && girth <= 12
      ? girth / (2 * Math.PI)
      : Math.min(0.35, Math.max(0.1, 0.012 * heightM + 0.06));
  return { heightM, crownM, trunkRadiusM, heightTagged };
}

/**
 * The silhouette: broad, needle, or neutral for an untagged tree (DEC-R4-10,
 * "a neutral form"). `untagged: "broad"` draws an unknown as a broadleaf.
 */
export function formOf(leafType, { untagged = "neutral" } = {}) {
  if (leafType === "needleleaved") return "needle";
  if (leafType === "broadleaved") return "broad";
  return untagged === "broad" ? "broad" : "neutral";
}

/** Where the crown starts on its trunk, as a share of the height. */
const CROWN_BASE = { broad: 0.35, neutral: 0.33, needle: 0.18 };

/** Trunk-and-crown: the crown's base and height, summing to the true height. */
export function trunkLayout(form, heightM) {
  const crownBaseM = heightM * (CROWN_BASE[form] ?? CROWN_BASE.neutral);
  return { crownBaseM, crownHeightM: heightM - crownBaseM };
}

/** Barrier colours by kind, sRGB, muted; and by material where tagged. */
const BARRIER_STYLE = {
  hedge: { colour: 0x6a785d, heightM: 2, thicknessM: 0.8 },
  wall: { colour: 0xa59e93, heightM: 2, thicknessM: 0.4 },
  city_wall: { colour: 0x9b9081, heightM: 6, thicknessM: 1.2 },
  retaining_wall: { colour: 0x9d9d98, heightM: 1, thicknessM: 0.4 },
  fence: { colour: 0x7d7366, heightM: 1.2, thicknessM: 0.12 },
};
const MATERIAL_COLOUR = {
  brick: 0x9a7262,
  stone: 0xa49a8a,
  dry_stone: 0xa49a8a,
  sandstone: 0xa8907a,
  concrete: 0xa0a09c,
  wood: 0x8a7660,
  metal: 0x7c8186,
  chain_link: 0x7c8186,
  steel: 0x7c8186,
};

/**
 * A barrier's look: `{ kind, colour, heightM, thicknessM, heightTagged,
 * taggedColour }`. Tagged `height` and `width` win. The 2 m of walls and
 * hedges is the owner's (DEC-R11-2); the others are this page's guesses.
 * `taggedColour` is the raw `colour` tag for the renderer to parse.
 */
export function barrierStyle(tags = {}) {
  const kind =
    tags.historic === "citywalls" ? "city_wall" : (tags.barrier ?? "wall");
  const style = BARRIER_STYLE[kind] ?? BARRIER_STYLE.wall;
  const material =
    tags.material ??
    tags.fence_type ??
    (kind === "wall" ? tags.wall : undefined);
  const height = parseLengthM(tags.height);
  const width = parseLengthM(tags.width);
  return {
    kind,
    colour:
      kind === "hedge"
        ? style.colour
        : (MATERIAL_COLOUR[material] ?? style.colour),
    heightM: height ?? style.heightM,
    thicknessM: width ?? style.thicknessM,
    heightTagged: height !== undefined,
    taggedColour: tags.colour ?? tags["building:colour"] ?? null,
  };
}

/** Even-odd point in polygon over all rings: outer and holes alike. */
export function pointInRings({ x, y }, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (
        a.y > y !== b.y > y &&
        x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function boundsOf(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

const insideClip = (p, clip) =>
  !clip ||
  (p.x >= clip.minX &&
    p.x <= clip.maxX &&
    p.y >= clip.minY &&
    p.y <= clip.maxY);

/**
 * Cosmetic trees inside a mapped wood: one per cell of a world-aligned grid
 * (so two overlapping woods share cells, and `taken` keeps the first), jittered
 * from the area's key. Inside `rings`, inside `clip`, outside `exclude(x, y)`.
 * Each point is `{ x, y, key, cosmetic: true }`.
 */
export function scatterInArea(
  rings,
  key,
  { densityPerM2 = PARAMS.woodDensityPerM2, clip, exclude, taken } = {},
) {
  if (!(densityPerM2 > 0) || rings.length === 0) return [];
  const step = 1 / Math.sqrt(densityPerM2);
  const box = boundsOf(rings);
  const lo = clip
    ? { x: Math.max(box.minX, clip.minX), y: Math.max(box.minY, clip.minY) }
    : { x: box.minX, y: box.minY };
  const hi = clip
    ? { x: Math.min(box.maxX, clip.maxX), y: Math.min(box.maxY, clip.maxY) }
    : { x: box.maxX, y: box.maxY };
  const points = [];
  for (let i = Math.floor(lo.x / step); i * step <= hi.x; i++) {
    for (let j = Math.floor(lo.y / step); j * step <= hi.y; j++) {
      const cell = `${i}:${j}`;
      if (taken?.has(cell)) continue;
      const p = {
        x: (i + 0.15 + 0.7 * seededRandom(`${cell}|x`)) * step,
        y: (j + 0.15 + 0.7 * seededRandom(`${cell}|y`)) * step,
      };
      if (!insideClip(p, clip) || !pointInRings(p, rings)) continue;
      if (exclude?.(p.x, p.y)) continue;
      taken?.add(cell);
      points.push({ ...p, key: `${key}#${cell}`, cosmetic: true });
    }
  }
  return points;
}

/**
 * Cosmetic orchard trees in rows along the outline's longest edge, `spacingM`
 * apart, with a small seeded jitter. Same filters as `scatterInArea`.
 */
export function orchardInArea(
  rings,
  key,
  { spacingM = PARAMS.orchardSpacingM, clip, exclude } = {},
) {
  const outer = rings[0];
  if (!outer || outer.length < 3 || !(spacingM > 0)) return [];
  let angle = 0;
  let longest = -1;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > longest) {
      longest = length;
      angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const origin = outer[0];
  const toLocal = (p) => ({
    u: (p.x - origin.x) * cos + (p.y - origin.y) * sin,
    v: -(p.x - origin.x) * sin + (p.y - origin.y) * cos,
  });
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const p of outer) {
    const { u, v } = toLocal(p);
    minU = Math.min(minU, u);
    minV = Math.min(minV, v);
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, v);
  }
  const points = [];
  for (let i = Math.floor(minU / spacingM); i * spacingM <= maxU; i++) {
    for (let j = Math.floor(minV / spacingM); j * spacingM <= maxV; j++) {
      const cell = `o${i}:${j}`;
      const u =
        (i + 0.5 + (seededRandom(`${key}|${cell}|u`) - 0.5) * 0.16) * spacingM;
      const v =
        (j + 0.5 + (seededRandom(`${key}|${cell}|v`) - 0.5) * 0.16) * spacingM;
      const p = {
        x: origin.x + u * cos - v * sin,
        y: origin.y + u * sin + v * cos,
      };
      if (!insideClip(p, clip) || !pointInRings(p, rings)) continue;
      if (exclude?.(p.x, p.y)) continue;
      points.push({ ...p, key: `${key}#${cell}`, cosmetic: true });
    }
  }
  return points;
}

/**
 * Cosmetic trees along a mapped tree row: every `spacingM`, starting half a
 * step in, dropping any within `clearM` of a mapped tree in `avoid`.
 */
export function alongLine(
  points,
  key,
  {
    spacingM = PARAMS.rowSpacingM,
    avoid = [],
    clearM = PARAMS.rowClearM,
    clip,
  } = {},
) {
  const out = [];
  if (!(spacingM > 0)) return out;
  let next = spacingM / 2;
  let walked = 0;
  let index = 0;
  for (let s = 0; s + 1 < points.length; s++) {
    const a = points[s];
    const b = points[s + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    while (length > 0 && next <= walked + length) {
      const t = (next - walked) / length;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const clear = avoid.every(
        (q) => Math.hypot(q.x - p.x, q.y - p.y) > clearM,
      );
      if (clear && insideClip(p, clip)) {
        out.push({ ...p, key: `${key}#r${index}`, cosmetic: true });
      }
      index++;
      next += spacingM;
    }
    walked += length;
  }
  return out;
}

/**
 * At most `cap` of `points`, the ones with the lowest seeded rank, so a wood
 * thins evenly rather than stopping at an edge; returned in key order.
 */
export function capByRank(points, cap) {
  if (points.length <= cap) return points;
  return points
    .map((p) => ({ p, rank: seededRandom(`${p.key}|rank`) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Math.max(0, cap))
    .map(({ p }) => p)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function distanceToSegment(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/**
 * `(x, y) => true` where a cosmetic tree must not stand: inside a building
 * ring, or within a segment's `halfWidthM` of a road. Bucketed on a grid of
 * `cellM`, so a few thousand queries stay cheap.
 */
export function makeExclusion({ rings = [], segments = [], cellM = 16 } = {}) {
  const buckets = new Map();
  const add = (box, item) => {
    for (
      let i = Math.floor(box.minX / cellM);
      i <= Math.floor(box.maxX / cellM);
      i++
    ) {
      for (
        let j = Math.floor(box.minY / cellM);
        j <= Math.floor(box.maxY / cellM);
        j++
      ) {
        const id = `${i}:${j}`;
        if (!buckets.has(id)) buckets.set(id, []);
        buckets.get(id).push(item);
      }
    }
  };
  for (const ring of rings) {
    if (ring.length >= 3) add(boundsOf([ring]), { ring });
  }
  for (const segment of segments) {
    const { a, b, halfWidthM } = segment;
    add(
      {
        minX: Math.min(a.x, b.x) - halfWidthM,
        minY: Math.min(a.y, b.y) - halfWidthM,
        maxX: Math.max(a.x, b.x) + halfWidthM,
        maxY: Math.max(a.y, b.y) + halfWidthM,
      },
      { segment },
    );
  }
  return (x, y) => {
    const items = buckets.get(
      `${Math.floor(x / cellM)}:${Math.floor(y / cellM)}`,
    );
    if (!items) return false;
    return items.some(({ ring, segment }) =>
      ring
        ? pointInRings({ x, y }, [ring])
        : distanceToSegment(x, y, segment.a, segment.b) < segment.halfWidthM,
    );
  };
}

/** The LOD of a tree at `distanceM` from the eye. */
export function lodOf(distanceM, nearM = PARAMS.lodNearM) {
  return distanceM < nearM ? "near" : "far";
}
