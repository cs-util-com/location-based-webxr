/**
 * O3's roads: the library's ribbon (a quad per segment, a round disc at the
 * joins, DEC-R2-13), with the disc dropped at near-straight interior points
 * only, a vertical order by class, and the per-vertex data the kerb-edge
 * shading reads. Pure: no three.js and no DOM, so a node test reaches all of it.
 *
 * @see street-roads.js.md
 */

export const ROAD_PARAMS = Object.freeze({
  /** Segments of a join disc, as `roads.ts`'s `DISC_SEGMENTS`. */
  discSegments: 8,
  /** Interior points turning less than this lose their disc (degrees). */
  straightDeg: 10,
  /** Height between two class ranks, metres (depth must separate them). */
  rankStepM: 0.02,
  /** How far a way's discs sit under its own quads, metres. */
  discDropM: 0.01,
  /** Largest per-way lift inside a rank, so equal ranks do not z-fight. */
  tieLiftM: 0.008,
  /** Width of the darkened edge on a car road, metres. */
  carEdgeM: 0.22,
  /** Width of the darkened edge on a path, metres. */
  pathEdgeM: 0.08,
});

/** A separately mapped sidewalk: the footway's warm family, lighter. */
export const SIDEWALK_RGB = 0xc6b49c;

const RANKS = {
  footway: 0,
  path: 0,
  steps: 0,
  pedestrian: 0,
  cycleway: 0,
  bridleway: 0,
  platform: 0,
  track: 1,
  service: 1,
  residential: 2,
  living_street: 2,
  unclassified: 2,
};
const TOP_RANK = 3;

const PATHS = new Set(["footway", "path", "steps", "pedestrian", "cycleway"]);

/** A way's class rank: who covers whom where two ways overlap. */
export function rankOf(tags) {
  return RANKS[tags?.highway] ?? TOP_RANK;
}

/**
 * A way's colour: `base` (the library's `roadColour`) except a separately
 * mapped sidewalk, which stays in the pedestrian family (the class wins,
 * DEC-R7b-4) but reads as paved concrete, lighter than a path.
 */
export function streetColour(tags, base) {
  if (tags?.highway === "footway" && tags.footway === "sidewalk") {
    return SIDEWALK_RGB;
  }
  return base;
}

/** Whether a way is drawn as a ribbon: `roads.ts`'s `isRoad`, for ways. */
export function isStreetWay(feature) {
  if (feature?.type !== "way") return false;
  const tags = feature.tags ?? {};
  if (tags.highway === undefined) return false;
  if (tags.tunnel === "yes" || tags.covered === "yes") return false;
  if (tags.area === "yes") return false;
  return Array.isArray(feature.geometry) && feature.geometry.length >= 2;
}

/** The turn at `b` between the directions a->b and b->c, 0..180 degrees. */
export function turnDegrees(a, b, c) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const cross = ux * vy - uy * vx;
  const dot = ux * vx + uy * vy;
  return Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
}

/** The bare-ground chord at the outside of a join left without its disc. */
export function wedgeGapM(halfWidthM, turnDeg) {
  return 2 * halfWidthM * Math.sin((turnDeg * Math.PI) / 360);
}

const pointKey = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

/** Points two or more ways share (or one way visits twice): the junctions. */
export function junctionKeys(ways) {
  const seen = new Map();
  for (const { points } of ways) {
    const own = new Set();
    for (const p of points) {
      const key = pointKey(p);
      if (own.has(key)) {
        seen.set(key, 2);
        continue;
      }
      own.add(key);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([key]) => key));
}

/** Drops consecutive duplicates, which make a segment degenerate. */
function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

/** A stable [0, 1) per key, so a way's tie lift never moves. */
function keyFraction(key) {
  let hash = 0x811c9dc5;
  for (const char of String(key)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  }
  return (hash >>> 0) / 4294967296;
}

function sink() {
  return { positions: [], colours: [], street: [] };
}

/**
 * Appends one triangle, wound to face up in render axes (east, up, minus
 * north). `v` is `[x, y, height, offset, half, edge]` in ENU metres.
 */
export function pushTriangle(out, rgb, a, b, c) {
  const crossY =
    (-b[1] + a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (-c[1] + a[1]);
  const corners = crossY > 0 ? [a, b, c] : [a, c, b];
  for (const [x, y, height, offset, half, edge] of corners) {
    out.positions.push(x, height, -y);
    out.colours.push(rgb[0], rgb[1], rgb[2]);
    out.street.push(offset, half, edge);
  }
}

/** Packed `0xrrggbb` to linear-ish 0..1 floats (sRGB as three reads it). */
export function rgbOf(packed) {
  return [
    ((packed >> 16) & 0xff) / 255,
    ((packed >> 8) & 0xff) / 255,
    (packed & 0xff) / 255,
  ];
}

/**
 * Ribbons for `ways` (`{ key, tags, points: [{ x, y }] }`, ENU metres) as flat
 * arrays: `positions` (render axes), `colours` (0..1, sRGB values),
 * `street` (offset from the centre or the disc's centre, half width, edge
 * width, metres, per vertex) and `stats`. `widthOf(tags)` and
 * `colourOf(tags)` are the library's `roadWidthM` and `roadColour`.
 * `straightDeg` 0 is today's geometry exactly. `maxGapM` (optional) also
 * keeps a disc whose dropping would open a chord wider than it.
 */
export function buildRibbons(
  ways,
  {
    widthOf,
    colourOf,
    straightDeg = ROAD_PARAMS.straightDeg,
    maxGapM = Infinity,
  } = {},
) {
  const p = ROAD_PARAMS;
  const out = sink();
  const stats = {
    ways: 0,
    points: 0,
    discsKept: 0,
    discsDropped: 0,
    quadTriangles: 0,
    discTriangles: 0,
    maxGapM: 0,
    gapAreaM2: 0,
  };
  const cleaned = ways
    .map((w) => ({ ...w, points: dedupe(w.points) }))
    .filter((w) => w.points.length >= 2);
  const junctions = junctionKeys(cleaned);

  for (const { key, tags, points } of cleaned) {
    stats.ways += 1;
    stats.points += points.length;
    const half = widthOf(tags) / 2;
    const rgb = rgbOf(streetColour(tags, colourOf(tags)));
    const edge = PATHS.has(tags.highway) ? p.pathEdgeM : p.carEdgeM;
    const quadY =
      rankOf(tags) * p.rankStepM + p.discDropM + keyFraction(key) * p.tieLiftM;
    const discY = quadY - p.discDropM;

    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = (-(b.y - a.y) / length) * half;
      const ny = ((b.x - a.x) / length) * half;
      const al = [a.x + nx, a.y + ny, quadY, half, half, edge];
      const ar = [a.x - nx, a.y - ny, quadY, -half, half, edge];
      const bl = [b.x + nx, b.y + ny, quadY, half, half, edge];
      const br = [b.x - nx, b.y - ny, quadY, -half, half, edge];
      pushTriangle(out, rgb, al, bl, ar);
      pushTriangle(out, rgb, bl, br, ar);
      stats.quadTriangles += 2;
    }

    points.forEach((point, i) => {
      const end = i === 0 || i === points.length - 1;
      if (!end && !junctions.has(pointKey(point))) {
        const turn = turnDegrees(points[i - 1], point, points[i + 1]);
        if (turn < straightDeg && wedgeGapM(half, turn) <= maxGapM) {
          stats.discsDropped += 1;
          const gap = wedgeGapM(half, turn);
          stats.maxGapM = Math.max(stats.maxGapM, gap);
          stats.gapAreaM2 +=
            0.5 * half * half * Math.sin((turn * Math.PI) / 180);
          return;
        }
      }
      stats.discsKept += 1;
      const centre = [point.x, point.y, discY, 0, half, edge];
      const rim = (step) => {
        const angle = (step / p.discSegments) * Math.PI * 2;
        return [
          point.x + Math.cos(angle) * half,
          point.y + Math.sin(angle) * half,
          discY,
          half,
          half,
          edge,
        ];
      };
      for (let step = 0; step < p.discSegments; step += 1) {
        pushTriangle(out, rgb, centre, rim(step), rim(step + 1));
        stats.discTriangles += 1;
      }
    });
  }

  return {
    positions: Float32Array.from(out.positions),
    colours: Float32Array.from(out.colours),
    street: Float32Array.from(out.street),
    stats,
  };
}
