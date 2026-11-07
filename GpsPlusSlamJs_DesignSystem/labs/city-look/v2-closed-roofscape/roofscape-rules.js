/**
 * V2's decisions, all pure: which building gets an invented roof, how high it
 * stands, which muted tones it takes, which of its walls are shared with a
 * neighbour, and which roof it ends up with. Everything invented is seeded from
 * the OSM id. No three.js.
 *
 * @see roofscape-rules.js.md
 */
import { seededRandom } from "../city-look-model.js";

import {
  orientRings,
  planArea,
  RoofFailure,
  ringArea,
  roofSkeleton,
  triangularEnds,
  triangulateFace,
} from "./roof-skeleton.js";

/** The variant's parameters, in one place, each swept in the report. */
export const PARAMS = Object.freeze({
  heightLimitM: 14,
  simplifyToleranceM: 0.05,
  jitterM: 0.002,
  /** Share of the houses with gable ends; the rest are hipped. */
  gableShare: 0.72,
  gableMinM: 3,
  gableMaxM: 16,
  /** The slope, as rise over run: about 32 to 42 degrees. */
  tanMin: 0.62,
  tanMax: 0.9,
  /** A wide house flattens to this slope first, about 20 degrees. */
  tanFloor: 0.36,
  maxRiseM: 5.5,
  /** Two walls closer than this count as one shared wall. */
  sharedGapM: 0.4,
  sharedMinShare: 0.5,
  /** A real eave: how far a slope reaches past its wall. */
  overhangM: 0.32,
  areaTolerance: 0.004,
});

/** Muted, related tones. Sandstone and plaster, clay and slate. */
const WALLS = [
  "#dccfba",
  "#d6c8b2",
  "#d0c5b3",
  "#ddcdb2",
  "#cbbfae",
  "#d8c5a8",
];
const ROOFS = [
  "#8c6152",
  "#7c5a4e",
  "#96705f",
  "#86604f",
  "#7f6a60",
  "#6b625e",
  "#5c5a5c",
];

const NEVER_PITCHED = new Set([
  "roof",
  "parking",
  "garages",
  "carport",
  "kiosk",
  "ruins",
  "construction",
  "grandstand",
  "stadium",
  "greenhouse",
  "bunker",
  "container",
  "tent",
  "service",
]);
const SMALL = new Set(["garage", "shed", "hut", "cabin"]);
const LARGE = new Set([
  "apartments",
  "residential",
  "dormitory",
  "hotel",
  "office",
  "university",
  "school",
]);
const SACRED = new Set(["church", "chapel"]);

const COLOUR_NAMES = new Set([
  "white",
  "grey",
  "gray",
  "silver",
  "black",
  "brown",
  "red",
  "maroon",
  "beige",
  "tan",
  "yellow",
  "orange",
  "ivory",
]);

const firstNumber = (raw) => {
  const match = /^\s*(\d+(?:\.\d+)?)\s*m?\s*$/i.exec(raw ?? "");
  return match ? Number(match[1]) : undefined;
};

/** The height a tag states, without a roof; undefined when none does. */
function taggedHeightM(tags) {
  const height = firstNumber(tags.height);
  if (height !== undefined && height > 0) return height;
  const levels = Number(tags["building:levels"]);
  return levels > 0 ? levels * 3 : undefined;
}

/**
 * Why a building stays exactly as today, or null when it gets an invented roof.
 * `hasParts`: an outline with `building:part` volumes inside it.
 */
export function keepReason(tags, { hasParts, heightLimitM, belowSurface }) {
  if (tags["building:part"] && tags["building:part"] !== "no") return "part";
  if (belowSurface) return "below surface";
  if (hasParts) return "parts";
  if (tags["roof:shape"]) return "tagged roof";
  if (tags["roof:height"] || tags["roof:levels"]) return "tagged roof";
  if (firstNumber(tags.min_height) > 0) return "floating";
  if (Number(tags["building:min_level"]) > 0) return "floating";
  if (NEVER_PITCHED.has(tags.building)) return "no roof by class";
  const height = taggedHeightM(tags);
  return height !== undefined && height > heightLimitM ? "tall" : null;
}

const between = (key, salt, [low, high]) =>
  low + seededRandom(`${key}/${salt}`) * (high - low);

const pick = (list, key, salt) =>
  list[Math.floor(seededRandom(`${key}/${salt}`) * list.length)];

/** Walls' height: the tag's if there is one, else seeded by class and size. */
export function eaveHeightM(tags, areaM2, key) {
  const tagged = taggedHeightM(tags);
  if (tagged !== undefined) return tagged;
  if (SMALL.has(tags.building) || areaM2 < 35) {
    return between(key, "eave", [2.5, 3.1]);
  }
  if (SACRED.has(tags.building)) return between(key, "eave", [6.5, 8.5]);
  if (LARGE.has(tags.building) || areaM2 > 450) {
    return between(key, "eave", [8, 10.5]);
  }
  if (areaM2 < 70) return between(key, "eave", [3, 3.8]);
  return between(key, "eave", [5, 6.2]);
}

const usableColour = (raw) => {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  return COLOUR_NAMES.has(value) ? value : undefined;
};

/** `{ wall, roof }`: a colour the map carries, else a seeded muted tone. */
export function coloursFor(tags, key) {
  return {
    wall: usableColour(tags["building:colour"]) ?? pick(WALLS, key, "wall"),
    roof: usableColour(tags["roof:colour"]) ?? pick(ROOFS, key, "roof"),
  };
}

const pointLineGap = (p, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
};

/** Drops corners nearer than `toleranceM` to the line past them. */
export function simplifyRing(ring, toleranceM) {
  const out = [...ring];
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    let weakest = -1;
    let gap = toleranceM;
    out.forEach((p, i) => {
      const a = out[(i + out.length - 1) % out.length];
      const b = out[(i + 1) % out.length];
      const g = pointLineGap(p, a, b);
      if (g < gap) {
        gap = g;
        weakest = i;
      }
    });
    if (weakest >= 0) {
      out.splice(weakest, 1);
      changed = true;
    }
  }
  return out;
}

/**
 * A ring ready for the skeleton: simplified, then moved by millimetres, seeded,
 * so two walls are never exactly parallel and no two events are exactly equal.
 */
export function prepareRing(
  ring,
  toleranceM,
  key,
  ringIndex,
  jitterM = PARAMS.jitterM,
) {
  return simplifyRing(ring, toleranceM).map((p, i) => ({
    x: p.x + (seededRandom(`${key}/${ringIndex}/${i}/x`) - 0.5) * 2 * jitterM,
    y: p.y + (seededRandom(`${key}/${ringIndex}/${i}/y`) - 0.5) * 2 * jitterM,
  }));
}

/** For each wall of `ring`: does it stand against another building's wall? */
export function sharedWalls(ring, owner, segments, gapM = PARAMS.sharedGapM) {
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) return false;
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    let covered = 0;
    for (const s of segments) {
      if (s.owner === owner) continue;
      const sx = s.b.x - s.a.x;
      const sy = s.b.y - s.a.y;
      const sLength = Math.hypot(sx, sy);
      if (sLength === 0) continue;
      if (Math.abs(dx * sy - dy * sx) / sLength > 0.2) continue;
      const u0 = (s.a.x - a.x) * dx + (s.a.y - a.y) * dy;
      const u1 = (s.b.x - a.x) * dx + (s.b.y - a.y) * dy;
      const from = Math.max(0, Math.min(u0, u1));
      const to = Math.min(length, Math.max(u0, u1));
      if (to <= from) continue;
      const mid = (from + to) / 2;
      const q = { x: a.x + dx * mid, y: a.y + dy * mid };
      if (pointLineGap(q, s.a, s.b) > gapM) continue;
      covered += to - from;
    }
    return covered >= length * PARAMS.sharedMinShare;
  });
}

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/** A roof that covers exactly the footprint, or a RoofFailure. */
function soundRoof(rings, options, triangulate) {
  const roof = roofSkeleton(rings, options);
  const area =
    ringArea(rings[0]) +
    rings.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0);
  const covered = planArea(roof, triangulate);
  if (Math.abs(covered - area) > area * PARAMS.areaTolerance) {
    throw new RoofFailure("the roof does not cover its footprint");
  }
  for (const face of roof.faces) {
    if (face.vertical) continue;
    for (const [a, b, c] of triangulateFace(face, triangulate)) {
      const mid = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
      if (!pointInRing(mid, rings[0])) {
        throw new RoofFailure("a slope over air");
      }
      if (rings.slice(1).some((hole) => pointInRing(mid, hole))) {
        throw new RoofFailure("a slope over the courtyard");
      }
    }
  }
  return roof;
}

const attempt = (make) => {
  try {
    return make();
  } catch (error) {
    if (error instanceof RoofFailure) return null;
    throw error;
  }
};

const wallLength = (ring, i) => {
  const a = ring[i];
  const b = ring[(i + 1) % ring.length];
  return Math.hypot(b.x - a.x, b.y - a.y);
};

/** The wing ends that take a gable: long enough, no two side by side. */
function gableEnds(roof, ring, shared) {
  const candidates = triangularEnds(roof)
    .filter((i) => !shared[i])
    .filter((i) => {
      const length = wallLength(ring, i);
      return length >= PARAMS.gableMinM && length <= PARAMS.gableMaxM;
    })
    .sort((a, b) => wallLength(ring, b) - wallLength(ring, a) || a - b);
  const chosen = new Set();
  for (const i of candidates) {
    const before = (i + ring.length - 1) % ring.length;
    const after = (i + 1) % ring.length;
    if (!chosen.has(before) && !chosen.has(after)) chosen.add(i);
  }
  return chosen;
}

/** One weight per wall of the outer ring; holes all slope. */
function weightsFor(rings, zero) {
  return [rings[0].map((_, i) => (zero.has(i) ? 0 : 1))];
}

/**
 * Where a ring's corners go when each wall moves outwards by its own offset,
 * or null for a corner that cannot follow (two nearly straight walls with
 * different offsets, or a mitre far longer than the offset).
 */
export function offsetRing(ring, offsets) {
  const longest = Math.max(...offsets);
  const normal = (i) => {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.y - a.y) / length, y: (a.x - b.x) / length };
  };
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const before = (i + ring.length - 1) % ring.length;
    const n1 = normal(before);
    const n2 = normal(i);
    const d1 = offsets[before];
    const d2 = offsets[i];
    const det = n1.x * n2.y - n1.y * n2.x;
    const p = ring[i];
    if (Math.abs(det) < 0.02) {
      if (Math.abs(d1 - d2) > 1e-9) return null;
      out.push({ x: p.x + n1.x * d1, y: p.y + n1.y * d1 });
      continue;
    }
    const x = (d1 * n2.y - d2 * n1.y) / det;
    const y = (n1.x * d2 - n2.x * d1) / det;
    if (Math.hypot(x, y) > 4 * longest + 1e-9) return null;
    out.push({ x: p.x + x, y: p.y + y });
  }
  return out;
}

/** The rings the eaves follow: slopes reach past the wall, gables do not. */
function eaveRings(rings, zero, overhangM) {
  if (overhangM <= 0) return null;
  const out = rings.map((ring, r) =>
    offsetRing(
      ring,
      ring.map((_, i) => (r === 0 && zero.has(i) ? 0 : overhangM)),
    ),
  );
  return out.includes(null) ? null : out;
}

/**
 * The best roof a footprint takes, most house-like first:
 * gables and shared walls, then shared walls alone, then a plain hip. Null when
 * none is sound: that house stays flat. The slope flattens before the roof gets
 * taller than `maxRiseM`, and past the floor it stops with a flat top. A real
 * eave reaches `overhangM` past the wall; a footprint that cannot take one keeps
 * its roof flush.
 */
function bestRoof(
  rings,
  shared,
  { wantsGable, tan, triangulate, overhangM, maxRiseM },
) {
  const sharedSet = new Set();
  shared.forEach((is, i) => is && sharedSet.add(i));
  const run = (over, zero, maxT) =>
    attempt(() =>
      soundRoof(over, { weights: weightsFor(rings, zero), maxT }, triangulate),
    );

  let zero = sharedSet;
  let roof = run(rings, zero);
  if (!roof) {
    zero = new Set();
    roof = run(rings, zero);
  }
  if (!roof) return null;
  let style = zero.size > 0 ? "shared" : "hip";

  if (wantsGable) {
    const ends = gableEnds(roof, rings[0], shared);
    if (ends.size > 0) {
      const withEnds = new Set([...zero, ...ends]);
      if (run(rings, withEnds)) {
        zero = withEnds;
        style = "gable";
      }
    }
  }

  const finish = (over) => {
    const whole = run(over, zero);
    if (!whole) return null;
    const fitted = Math.min(tan, maxRiseM / whole.ridgeT);
    if (fitted >= PARAMS.tanFloor) {
      return { roof: whole, roofRings: over, tan: fitted, style };
    }
    // Too wide for a whole roof: a hip to the limit, a flat top after it.
    const maxT = maxRiseM / PARAMS.tanFloor;
    const cut = run(over, sharedSet, maxT);
    if (!cut) return null;
    return { roof: cut, roofRings: over, tan: PARAMS.tanFloor, style: "cut" };
  };
  const eaved = eaveRings(rings, zero, overhangM);
  return (eaved && finish(eaved)) ?? finish(rings);
}

/** Marks every outline holding a part: its volumes replace it. */
function outlinesWithParts(entries) {
  const parts = entries.filter(
    (e) => e.tags["building:part"] && e.tags["building:part"] !== "no",
  );
  const owners = new Set();
  for (const part of parts) {
    const ring = part.rings[0] ?? [];
    const mid = ring.reduce(
      (sum, p) => ({
        x: sum.x + p.x / ring.length,
        y: sum.y + p.y / ring.length,
      }),
      { x: 0, y: 0 },
    );
    for (const entry of entries) {
      if (entry === part || !entry.tags.building) continue;
      if (pointInRing(mid, entry.rings[0])) owners.add(entry.key);
    }
  }
  return owners;
}

function bounds(ring) {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** Wider than any shared-wall gap: only a pre-filter. */
const NEIGHBOUR_REACH_M = 1;

function nearbySegments(box, all) {
  const m = NEIGHBOUR_REACH_M;
  return all.filter(
    (s) =>
      s.box.maxX >= box.minX - m &&
      s.box.minX <= box.maxX + m &&
      s.box.maxY >= box.minY - m &&
      s.box.minY <= box.maxY + m,
  );
}

function segmentsOf(entries) {
  return entries.flatMap((entry) =>
    entry.rings.flatMap((ring) => {
      const box = bounds(ring);
      return ring.map((a, i) => ({
        a,
        b: ring[(i + 1) % ring.length],
        owner: entry.key,
        box,
      }));
    }),
  );
}

function planHouse(entry, area, segments, options) {
  const { key, tags } = entry;
  const tolerance = options.simplifyToleranceM ?? PARAMS.simplifyToleranceM;
  const rings = orientRings(
    entry.rings.map((ring, i) => prepareRing(ring, tolerance, key, i)),
  );
  if (rings.some((ring) => ring.length < 3)) return null;
  const shared = sharedWalls(
    rings[0],
    key,
    nearbySegments(bounds(rings[0]), segments),
    options.sharedGapM,
  );
  const sacred = SACRED.has(tags.building);
  const tan = sacred
    ? 1.2
    : between(key, "pitch", [PARAMS.tanMin, PARAMS.tanMax]);
  const wantsGable =
    sacred ||
    seededRandom(`${key}/gable`) < (options.gableShare ?? PARAMS.gableShare);
  const best = bestRoof(rings, shared, {
    wantsGable,
    tan,
    triangulate: options.triangulate,
    overhangM: options.overhangM ?? PARAMS.overhangM,
    maxRiseM: options.maxRiseM ?? PARAMS.maxRiseM,
  });
  const colours = coloursFor(tags, key);
  const eave = eaveHeightM(tags, area, key);
  if (!best) {
    return {
      key,
      rings,
      roofRings: rings,
      eaveM: eave,
      tan: 0,
      roof: null,
      style: "flat",
      colours,
    };
  }
  const rise = best.roof.ridgeT * best.tan;
  const statedHeight = firstNumber(tags.height);
  // A stated height is the whole building: the roof fits inside it.
  const eaveM =
    statedHeight !== undefined ? Math.max(2, statedHeight - rise) : eave;
  return {
    key,
    rings,
    roofRings: best.roofRings,
    eaveM,
    tan: best.tan,
    roof: best.roof,
    style: best.style,
    colours,
  };
}

/**
 * Plans a fixture. `entries`: `{ key, tags, rings, belowSurface }`, rings in
 * metres, buildings and parts only. Options: `triangulate(contour, holes)`,
 * `heightLimitM`, `simplifyToleranceM`, `gableShare`, `overhangM`, `maxRiseM`,
 * `sharedGapM`, each defaulting to `PARAMS`. Returns `{ plans, counts }`;
 * a plan's `roof` is null for a house the method failed on, which stays flat.
 * Pure and repeatable: the same entries give the same plans.
 */
export function planCity(entries, options) {
  const heightLimitM = options.heightLimitM ?? PARAMS.heightLimitM;
  const owners = outlinesWithParts(entries);
  const segments = segmentsOf(entries);
  const plans = [];
  const counts = {
    buildings: entries.length,
    candidates: 0,
    roofed: 0,
    failed: 0,
    kept: {},
    styles: {},
  };
  for (const entry of entries) {
    const reason = keepReason(entry.tags, {
      hasParts: owners.has(entry.key),
      heightLimitM,
      belowSurface: entry.belowSurface,
    });
    if (reason) {
      counts.kept[reason] = (counts.kept[reason] ?? 0) + 1;
      continue;
    }
    counts.candidates += 1;
    const area = Math.abs(ringArea(entry.rings[0]));
    const plan = planHouse(entry, area, segments, options);
    if (!plan) continue;
    plans.push(plan);
    if (plan.roof) counts.roofed += 1;
    else counts.failed += 1;
    counts.styles[plan.style] = (counts.styles[plan.style] ?? 0) + 1;
  }
  return { plans, counts };
}
