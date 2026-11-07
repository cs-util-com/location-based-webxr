/**
 * O3's street objects, decided from the mapped data alone: which nodes are
 * lamps, benches, bins and bollards (with what is guessed about each), where
 * zebra stripes lie, and which items a distance cut keeps. Pure: no three.js
 * and no DOM.
 *
 * @see street-objects.js.md
 */

export const FURNITURE_PARAMS = Object.freeze({
  /** A mast lamp's height without a `height` tag (OSM2World's default). */
  lampHeightM: 5,
  /** A wall-mounted lamp's head, metres above the ground. */
  wallLampHeightM: 4,
  /** A lamp hung on a wire over the street. */
  suspendedLampHeightM: 6,
  /** A bollard without a `height` tag. */
  bollardHeightM: 0.9,
  /** Items further than this from the eye are not drawn, metres. */
  cutM: 80,
});

export const MARK_PARAMS = Object.freeze({
  /** One stripe plus one gap, along the crossing, metres. */
  pitchM: 1,
  /** A stripe's width along the crossing. */
  barM: 0.5,
  /** A stripe's length across the crossing, when no `width` is mapped. */
  zebraWidthM: 3,
  /** How close a node must lie to a way's vertex to sit on it. */
  snapM: 0.05,
});

const ZEBRA_MARKINGS = new Set([
  "zebra",
  "ladder",
  "zebra:double",
  "ladder:skewed",
]);

/** Whether a crossing's tags say there is zebra paint on the ground. */
export function isZebraTags(tags = {}) {
  return (
    ZEBRA_MARKINGS.has(tags["crossing:markings"]) ||
    tags.crossing === "zebra" ||
    tags.crossing_ref === "zebra"
  );
}

/** A positive length from a tag (`7`, `7 m`), or undefined. */
function metres(raw) {
  if (raw === undefined) return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(m)?\s*$/.exec(String(raw));
  if (!match) return undefined;
  const value = Number(match[1]);
  return value > 0 ? value : undefined;
}

function kindOf(tags) {
  if (tags.highway === "street_lamp") {
    if (tags.lamp_mount === "wall") return "lamp-wall";
    if (tags.lamp_mount === "suspended") return "lamp-suspended";
    return "lamp";
  }
  if (tags.amenity === "bench") return "bench";
  if (tags.amenity === "waste_basket") return "bin";
  if (tags.barrier === "bollard") return "bollard";
  return null;
}

const DEFAULT_HEIGHT = {
  lamp: FURNITURE_PARAMS.lampHeightM,
  "lamp-wall": FURNITURE_PARAMS.wallLampHeightM,
  "lamp-suspended": FURNITURE_PARAMS.suspendedLampHeightM,
  bollard: FURNITURE_PARAMS.bollardHeightM,
};

/**
 * The furniture among `nodes` (`{ key, type, tags, x, y }`, ENU metres), in
 * input order: `{ key, kind, x, y, yawRad, heightM, guessed }`. `guessed`
 * names what is not mapped (`height`, `yaw`); benches and bins take their
 * model's own size, so their height is not listed. `rand(key)` is the
 * harness's seeded random.
 */
export function furnitureOf(nodes, rand) {
  const items = [];
  for (const n of nodes) {
    if (n.type !== "node") continue;
    const tags = n.tags ?? {};
    const kind = kindOf(tags);
    if (!kind) continue;
    const guessed = [];
    let heightM;
    if (kind in DEFAULT_HEIGHT) {
      heightM = metres(tags.height);
      if (heightM === undefined) {
        heightM = DEFAULT_HEIGHT[kind];
        guessed.push("height");
      }
    }
    const direction = Number(tags.direction);
    let yawRad;
    if (tags.direction !== undefined && Number.isFinite(direction)) {
      // Compass degrees, clockwise from north; a y-rotation is anticlockwise.
      yawRad = (-direction * Math.PI) / 180;
    } else {
      yawRad = rand(n.key) * Math.PI * 2;
      guessed.push("yaw");
    }
    items.push({ key: n.key, kind, x: n.x, y: n.y, yawRad, heightM, guessed });
  }
  return items;
}

/** Indices of `items` within `cutM` of `eye` in plan. */
export function nearWithin(items, eye, cutM) {
  const out = [];
  items.forEach((item, i) => {
    if (Math.hypot(item.x - eye.x, item.y - eye.y) <= cutM) out.push(i);
  });
  return out;
}

/** Stripes centred along a polyline at the pitch, each across it. */
function stripesAlong(points, lengthM) {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = lengths.reduce((s, l) => s + l, 0);
  const count = Math.floor(total / MARK_PARAMS.pitchM);
  if (count === 0) return [];
  const start =
    (total - count * MARK_PARAMS.pitchM) / 2 + MARK_PARAMS.pitchM / 2;
  const out = [];
  for (let k = 0; k < count; k += 1) {
    let along = start + k * MARK_PARAMS.pitchM;
    let i = 0;
    while (i < lengths.length - 1 && along > lengths[i]) {
      along -= lengths[i];
      i += 1;
    }
    const a = points[i];
    const b = points[i + 1];
    const t = lengths[i] > 0 ? along / lengths[i] : 0;
    const dx = (b.x - a.x) / (lengths[i] || 1);
    const dy = (b.y - a.y) / (lengths[i] || 1);
    out.push({
      cx: a.x + (b.x - a.x) * t,
      cy: a.y + (b.y - a.y) * t,
      // The stripe's long axis: across the walking direction.
      ux: -dy,
      uy: dx,
      lengthM,
      widthM: MARK_PARAMS.barM,
    });
  }
  return out;
}

const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= MARK_PARAMS.snapM;

/**
 * Zebra stripes: along every zebra-marked crossing way (`{ key, tags, points
 * }`), and across the road under every zebra-marked crossing node that no
 * striped way passes through. `roads` carry `widthM`; a node on no road is
 * skipped rather than given a guessed direction.
 */
export function zebraStripes(crossingWays, nodes, roads) {
  const stripes = [];
  const striped = [];
  for (const way of crossingWays) {
    if (!isZebraTags(way.tags)) continue;
    const width = metres(way.tags.width) ?? MARK_PARAMS.zebraWidthM;
    stripes.push(...stripesAlong(way.points, width));
    striped.push(...way.points);
  }
  for (const n of nodes) {
    if (n.type !== "node" || !isZebraTags(n.tags)) continue;
    if (striped.some((p) => near(p, n))) continue;
    const road = roads.find((r) => r.points.some((p) => near(p, n)));
    if (!road) continue;
    const i = road.points.findIndex((p) => near(p, n));
    const a = road.points[Math.max(0, i - 1)];
    const b = road.points[Math.min(road.points.length - 1, i + 1)];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    const half = road.widthM / 2;
    // A line across the road through the node, walked like a crossing way.
    stripes.push(
      ...stripesAlong(
        [
          { x: n.x + uy * half, y: n.y - ux * half },
          { x: n.x - uy * half, y: n.y + ux * half },
        ],
        MARK_PARAMS.zebraWidthM,
      ),
    );
  }
  return stripes;
}
