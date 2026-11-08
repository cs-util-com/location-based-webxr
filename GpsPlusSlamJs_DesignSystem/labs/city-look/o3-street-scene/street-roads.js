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
  /**
   * The mitre style's limit on the ratio of the mitre length to the half
   * width, `1 / cos(t / 2)` at a turn of t: above it the outer side is
   * bevelled. 2 bevels turns over 120 degrees.
   */
  mitreLimit: 2,
  /**
   * The mitre style's kerb fade where a way runs into another, metres: the
   * kerb is off inside the other way's half width and ramps back in over
   * this length.
   */
  kerbTaperM: 1,
});

/** The two ways a ribbon joins its segments (`buildRibbons`'s `joinStyle`). */
export const JOIN_STYLES = Object.freeze(["discs", "mitre"]);

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

/**
 * One way's continuous strip with mitre joins (the mitre style). `points` are
 * ENU metres without consecutive duplicates, `half` the half width, `breaks`
 * the indices of interior points shared with another way. Returns:
 *
 * - `triangles`: `[a, b, c]`, counter-clockwise in ENU, each vertex
 *   `{ x, y, offset, index }` with `offset` +half on the left edge and -half
 *   on the right (every strip vertex lies on an edge line) and `index` the
 *   point it belongs to;
 * - `discs`: the indices that take a round disc instead: the ends, the
 *   breaks and the fallbacks;
 * - `mitres`, `bevels`, `fallbacks` (counts) and `maxOvershootM`, the
 *   furthest a mitre corner reaches past the round join (`h / cos(t/2) - h`).
 *
 * At an interior point both sides meet at the mitre point, on the bisector of
 * the two segment normals at `h / cos(t/2)`. Above `mitreLimit` the outer
 * side is bevelled: its two plain corners plus one fill triangle; the inner
 * side keeps the mitre point. Where the inner mitre point would run more than
 * half way along either neighbouring segment (`h tan(t/2)`), two joins could
 * cross on a short segment and fold the strip, so the point falls back to a
 * disc and the strip breaks there, as at a junction.
 */
export function mitreStrip(
  points,
  half,
  { breaks, mitreLimit = ROAD_PARAMS.mitreLimit },
) {
  const n = points.length;
  const dirs = [];
  for (let i = 0; i + 1 < n; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    dirs.push({ x: (b.x - a.x) / len, y: (b.y - a.y) / len, len });
  }
  const at = (k, nx, ny, scale, offset) => ({
    x: points[k].x + nx * scale,
    y: points[k].y + ny * scale,
    offset,
    index: k,
  });
  // Plain cross-sections: perpendicular to one segment.
  const plain = (k, d) => ({
    left: at(k, -d.y, d.x, half, half),
    right: at(k, -d.y, d.x, -half, -half),
  });
  const starts = [];
  const ends = [];
  const triangles = [];
  const discs = [0];
  const result = { mitres: 0, bevels: 0, fallbacks: 0, maxOvershootM: 0 };
  starts[0] = plain(0, dirs[0]);
  for (let k = 1; k + 1 < n; k += 1) {
    const p = points[k];
    const dIn = dirs[k - 1];
    const dOut = dirs[k];
    const cross = dIn.x * dOut.y - dIn.y * dOut.x;
    const dot = dIn.x * dOut.x + dIn.y * dOut.y;
    const halfTurn = Math.abs(Math.atan2(cross, dot)) / 2;
    const reach = half * Math.tan(halfTurn);
    const folds =
      halfTurn >= Math.PI / 2 - 1e-9 ||
      reach > 0.5 * Math.min(dIn.len, dOut.len);
    if (breaks.has(k) || folds) {
      if (!breaks.has(k)) result.fallbacks += 1;
      ends[k - 1] = plain(k, dIn);
      starts[k] = plain(k, dOut);
      discs.push(k);
      continue;
    }
    // The bisector of the two left normals, scaled to reach both edge lines.
    const mx = -dIn.y - dOut.y;
    const my = dIn.x + dOut.x;
    const norm = Math.hypot(mx, my);
    const length = half / Math.cos(halfTurn);
    const left = at(k, mx / norm, my / norm, length, half);
    const right = at(k, mx / norm, my / norm, -length, -half);
    if (length / half <= mitreLimit) {
      result.mitres += 1;
      result.maxOvershootM = Math.max(result.maxOvershootM, length - half);
      ends[k - 1] = { left, right };
      starts[k] = { left, right };
      continue;
    }
    result.bevels += 1;
    const inPlain = plain(k, dIn);
    const outPlain = plain(k, dOut);
    if (cross > 0) {
      // A left turn: the right side is outside.
      ends[k - 1] = { left, right: inPlain.right };
      starts[k] = { left, right: outPlain.right };
      triangles.push([left, inPlain.right, outPlain.right]);
    } else {
      ends[k - 1] = { left: inPlain.left, right };
      starts[k] = { left: outPlain.left, right };
      triangles.push([right, outPlain.left, inPlain.left]);
    }
  }
  ends[n - 2] = plain(n - 1, dirs[n - 2]);
  discs.push(n - 1);
  for (let i = 0; i + 1 < n; i += 1) {
    const s = starts[i];
    const e = ends[i];
    triangles.push([s.right, e.right, e.left], [s.right, e.left, s.left]);
  }
  return { triangles, discs, ...result };
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
 * The mitre style's kerb fade for one way. Where the way passes through or
 * ends at a junction, its kerb is off along the way for the widest other
 * half width there (`reach`), ramps back in over `kerbTaperM`, and is full
 * beyond. Cross-sections are inserted on the segments at `reach` and
 * `reach + kerbTaperM` from each junction (collinear points, so the strip
 * takes them as straight mitres), and `kerb[i]` is the factor 0..1 at each
 * point. A way that visits a point twice counts its own half width there.
 */
function kerbFade(points, wayIndex, junctions, halvesAt, ownHalf) {
  const taper = ROAD_PARAMS.kerbTaperM;
  const along = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    along.push(along[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const stops = [];
  points.forEach((point, i) => {
    const key = pointKey(point);
    if (!junctions.has(key)) return;
    const others = halvesAt.get(key).filter((h) => h.wayIndex !== wayIndex);
    const reach = others.length
      ? Math.max(...others.map((h) => h.half))
      : ownHalf;
    stops.push({ at: along[i], reach });
  });
  const factor = (s) => {
    let f = 1;
    for (const { at, reach } of stops) {
      const d = Math.abs(s - at);
      f = Math.min(f, Math.max(0, Math.min(1, (d - reach) / taper)));
    }
    return f;
  };
  // Every distance where the factor changes slope, kept 5 cm off the points
  // and off each other, so no segment becomes degenerate.
  const total = along[along.length - 1];
  const cuts = [];
  for (const s of stops
    .flatMap(({ at, reach }) => [
      at - reach,
      at + reach,
      at - reach - taper,
      at + reach + taper,
    ])
    .sort((a, b) => a - b)) {
    if (s <= 0.05 || s >= total - 0.05) continue;
    if (along.some((a) => Math.abs(a - s) <= 0.05)) continue;
    if (cuts.length && s - cuts[cuts.length - 1] <= 0.05) continue;
    cuts.push(s);
  }
  const out = [points[0]];
  const kerb = [factor(0)];
  let c = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = along[i] - along[i - 1];
    for (; c < cuts.length && cuts[c] < along[i]; c += 1) {
      const t = (cuts[c] - along[i - 1]) / length;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      kerb.push(factor(cuts[c]));
    }
    out.push(b);
    kerb.push(factor(along[i]));
  }
  return { points: out, kerb };
}

/**
 * Ribbons for `ways` (`{ key, tags, points: [{ x, y }] }`, ENU metres) as flat
 * arrays: `positions` (render axes), `colours` (0..1, sRGB values),
 * `street` (offset from the centre or the disc's centre, half width, edge
 * width, metres, per vertex) and `stats`. `widthOf(tags)` and
 * `colourOf(tags)` are the library's `roadWidthM` and `roadColour`.
 * `straightDeg` 0 is today's geometry exactly. `maxGapM` (optional) also
 * keeps a disc whose dropping would open a chord wider than it.
 * `joinStyle` `"discs"` (the default) is that geometry; `"mitre"` draws
 * each way as one strip (`mitreStrip`) with discs at ends and junctions only,
 * and ignores `straightDeg` and `maxGapM`. RangeError for another style.
 */
export function buildRibbons(
  ways,
  {
    widthOf,
    colourOf,
    straightDeg = ROAD_PARAMS.straightDeg,
    maxGapM = Infinity,
    joinStyle = "discs",
    mitreLimit = ROAD_PARAMS.mitreLimit,
  } = {},
) {
  if (!JOIN_STYLES.includes(joinStyle)) {
    throw new RangeError(`unknown join style ${String(joinStyle)}`);
  }
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
    joinTriangles: 0,
    mitres: 0,
    bevels: 0,
    fallbacks: 0,
    maxOvershootM: 0,
  };
  const cleaned = ways
    .map((w) => ({ ...w, points: dedupe(w.points) }))
    .filter((w) => w.points.length >= 2);
  const junctions = junctionKeys(cleaned);
  // Per junction key, each way's half width there: the kerb fade's reach.
  const halvesAt = new Map();
  if (joinStyle === "mitre") {
    cleaned.forEach(({ tags, points }, wayIndex) => {
      for (const point of points) {
        const key = pointKey(point);
        if (!junctions.has(key)) continue;
        if (!halvesAt.has(key)) halvesAt.set(key, []);
        halvesAt.get(key).push({ wayIndex, half: widthOf(tags) / 2 });
      }
    });
  }

  for (const [wayIndex, way] of cleaned.entries()) {
    const { key, tags } = way;
    let { points } = way;
    stats.ways += 1;
    stats.points += points.length;
    const half = widthOf(tags) / 2;
    const rgb = rgbOf(streetColour(tags, colourOf(tags)));
    const edge = PATHS.has(tags.highway) ? p.pathEdgeM : p.carEdgeM;
    const quadY =
      rankOf(tags) * p.rankStepM + p.discDropM + keyFraction(key) * p.tieLiftM;
    const discY = quadY - p.discDropM;
    const disc = (point, discEdge = edge) => {
      stats.discsKept += 1;
      const centre = [point.x, point.y, discY, 0, half, discEdge];
      const rim = (step) => {
        const angle = (step / p.discSegments) * Math.PI * 2;
        return [
          point.x + Math.cos(angle) * half,
          point.y + Math.sin(angle) * half,
          discY,
          half,
          half,
          discEdge,
        ];
      };
      for (let step = 0; step < p.discSegments; step += 1) {
        pushTriangle(out, rgb, centre, rim(step), rim(step + 1));
        stats.discTriangles += 1;
      }
    };

    if (joinStyle === "mitre") {
      const faded = kerbFade(points, wayIndex, junctions, halvesAt, half);
      points = faded.points;
      const breaks = new Set();
      for (let i = 1; i + 1 < points.length; i += 1) {
        if (junctions.has(pointKey(points[i]))) breaks.add(i);
      }
      const strip = mitreStrip(points, half, { breaks, mitreLimit });
      const vertex = (v) => [
        v.x,
        v.y,
        quadY,
        v.offset,
        half,
        edge * faded.kerb[v.index],
      ];
      for (const [a, b, c] of strip.triangles) {
        pushTriangle(out, rgb, vertex(a), vertex(b), vertex(c));
      }
      stats.quadTriangles += 2 * (points.length - 1);
      stats.joinTriangles += strip.bevels;
      stats.mitres += strip.mitres;
      stats.bevels += strip.bevels;
      stats.fallbacks += strip.fallbacks;
      stats.maxOvershootM = Math.max(stats.maxOvershootM, strip.maxOvershootM);
      for (const i of strip.discs) disc(points[i], edge * faded.kerb[i]);
      continue;
    }

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
      disc(point);
    });
  }

  return {
    positions: Float32Array.from(out.positions),
    colours: Float32Array.from(out.colours),
    street: Float32Array.from(out.street),
    stats,
  };
}
