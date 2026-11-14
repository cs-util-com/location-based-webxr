/**
 * The city look lab's pure logic: the link's parameters, the fixed cameras,
 * the seeds and the stand-in heat scores. No three.js and no DOM, so a node
 * test reaches all of it.
 *
 * @see city-look-model.js.md
 */

/** How far each new frame's gap moves the smoothed frame time. */
const FRAME_MS_SMOOTHING = 0.1;

/** The street camera's eye above the ground, in metres. */
export const EYE_HEIGHT_M = 1.7;

/** The fixtures by short name; the first is the default. */
export const SCENES = Object.freeze([
  "lucerne",
  "heidelberg",
  "midtown",
  "parkslope",
  "reuss",
  "woodland",
]);

/** The cameras; the first is the default. */
export const VIEWS = Object.freeze(["landing", "bird", "street"]);

/** How far a street's view target lies ahead of the eye (an orbit pivot). */
const STREET_TARGET_M = 0.5;

/** Streets a person stands in. A service lane or a path is not one. */
const STREET_CLASSES = new Set([
  "residential",
  "living_street",
  "unclassified",
  "tertiary",
  "pedestrian",
]);

/** The two fixed views over the fixture's centre, in render axes. */
const FIXED_POSES = {
  landing: { position: [-130, 150, 210], target: [0, 8, 0] },
  bird: { position: [-90, 400, 150], target: [0, 0, 0] },
};

/**
 * A scene's own fixed views, where the shared one would not work. Midtown's
 * towers reach 325 m: the shared landing pose at 150 m stands next to one and
 * sees a wall, so Midtown's landing stands back over the edge of the data,
 * looking in along the same line. Heidelberg's nearest street faces a wall
 * 4 m away, so its street view stands in the Hauptstrasse, about 25 m from
 * the centre, looking east along it.
 */
const SCENE_POSES = {
  midtown: {
    landing: { position: [-330, 380, 530], target: [0, 40, 0] },
  },
  heidelberg: {
    street: {
      position: [16.3, EYE_HEIGHT_M, -19.4],
      target: [16.79, EYE_HEIGHT_M, -19.49],
    },
  },
};

/**
 * Where a view stands: `{ position, target }` as `[x, y, z]` in render axes
 * (east, up, minus north). `street` is the pose of `streetCamera`, needed
 * only for the street view; `scene` picks a scene's own view where it has
 * one, the street view included. RangeError for an unknown view or a missing
 * pose.
 */
export function cameraPose(view, street, scene) {
  const own = SCENE_POSES[scene]?.[view];
  if (view === "street") {
    if (own) return own;
    if (!street) throw new RangeError("the street view needs its pose");
    return street;
  }
  const pose = own ?? FIXED_POSES[view];
  if (!pose) throw new RangeError(`unknown view: ${view}`);
  return pose;
}

/**
 * The smoothed time between animation frames, from the frames' own timestamps:
 * `previous` is the last frame's, or null on the first. A gap that is not
 * positive leaves `current` as it is, and it stays null until a real gap exists.
 */
export function smoothedFrameMs(current, previous, now) {
  if (previous === null) return current;
  const gap = now - previous;
  if (!(gap > 0)) return current;
  return current === null
    ? gap
    : current + (gap - current) * FRAME_MS_SMOOTHING;
}

/** The divider's share of the width, kept off both edges; NaN is the middle. */
export function clampSplit(x) {
  const value = Number(x);
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.95, Math.max(0.05, value));
}

/** A linked pose further out than this is a typo, not a camera (the sky's radius). */
const CAM_LIMIT_M = 5000;

/** Eye and target closer than this give the orbit no direction. */
const CAM_MIN_SPAN_M = 0.05;

/**
 * A linked camera, `cam=ex,ey,ez,tx,ty,tz` in metres and render axes, as
 * `{ position, target }`; null for anything else (not six finite numbers,
 * further out than the sky, or eye on the target). Never throws.
 */
export function parseCameraOverride(raw) {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",");
  if (parts.length !== 6) return null;
  const values = parts.map((part) =>
    part.trim() === "" ? Number.NaN : Number(part),
  );
  if (!values.every((v) => Number.isFinite(v) && Math.abs(v) <= CAM_LIMIT_M)) {
    return null;
  }
  const position = values.slice(0, 3);
  const target = values.slice(3);
  const span = Math.hypot(...position.map((v, i) => v - target[i]));
  return span < CAM_MIN_SPAN_M ? null : { position, target };
}

/** Eyes below this stand in the street: they may look up and come close. */
const STREET_EYE_M = 10;

/**
 * OrbitControls limits for a linked pose, so its first update keeps the
 * camera where the link put it: the distance range holds the pose's own
 * distance with room to zoom both ways, and the polar limit holds its angle.
 * An eye in the street may look up; one above it stays above the ground.
 */
export function freeOrbitLimits({ position, target }) {
  const offset = position.map((v, i) => v - target[i]);
  const distance = Math.hypot(...offset);
  if (!(distance > 0)) {
    return {
      minDistance: 30,
      maxDistance: 1500,
      maxPolarAngle: Math.PI * 0.49,
    };
  }
  const polar = Math.acos(Math.min(1, Math.max(-1, offset[1] / distance)));
  const street = position[1] < STREET_EYE_M;
  return {
    minDistance: Math.min(
      distance,
      street ? 0.1 : Math.max(0.5, distance / 10),
    ),
    maxDistance: Math.max(distance, Math.min(1500, distance * 6)),
    maxPolarAngle: Math.min(
      Math.PI * 0.95,
      Math.max(Math.PI * (street ? 0.62 : 0.49), polar),
    ),
  };
}

/** A metre value as the link writes it: 10 cm, no trailing zeros, no minus zero. */
const camNumber = (value) => String(Math.round(value * 10) / 10 + 0);

/**
 * A page's state from its link: `{ scene, view, split, heat, cam }`. `split`
 * is the divider's share, or null for the full view (`split=off`). `cam` is a
 * linked pose (`parseCameraOverride`) that replaces the view's, or null. An
 * unknown or missing value takes the default, so a mistyped link still shows
 * a page.
 */
export function parseCityLookParams(search, { defaultSplit = null } = {}) {
  const params = new URLSearchParams(search);
  const pick = (name, allowed) => {
    const value = params.get(name);
    return allowed.includes(value) ? value : allowed[0];
  };
  const rawSplit = params.get("split");
  let split = defaultSplit;
  if (rawSplit === "off") {
    split = null;
  } else if (rawSplit !== null && Number.isFinite(Number(rawSplit))) {
    split = clampSplit(rawSplit);
  }
  return {
    scene: pick("scene", SCENES),
    view: pick("view", VIEWS),
    split,
    heat: params.get("heat") === "1",
    roofs: params.get("roofs") === "library",
    cam: parseCameraOverride(params.get("cam")),
  };
}

/** The link's search string for a state, read back by `parseCityLookParams`. */
export function cityLookSearch({
  scene,
  view,
  split,
  heat,
  roofs = false,
  cam = null,
}) {
  const params = new URLSearchParams({ scene, view });
  params.set("split", split === null ? "off" : split.toFixed(3));
  if (heat) params.set("heat", "1");
  if (roofs) params.set("roofs", "library");
  // Commas stay plain, so a linked pose stays readable in the address bar.
  const pose = cam
    ? `&cam=${[...cam.position, ...cam.target].map(camNumber).join(",")}`
    : "";
  return `?${params}${pose}`;
}

/**
 * A stable number in [0, 1) for a key: FNV-1a over the string, then a mix so
 * neighbouring OSM ids land far apart. Key it on the OSM id (`featureKey`),
 * never on an index, which moves when the data changes.
 */
export function seededRandom(key) {
  let hash = 0x811c9dc5;
  for (const char of String(key)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  }
  hash = Math.imul(hash ^ (hash >>> 15), hash | 1);
  hash ^= hash + Math.imul(hash ^ (hash >>> 7), hash | 61);
  return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
}

/**
 * A made-up heat fraction in [0, 1] for a cell: broad hot and cold areas plus
 * a per-cell jitter, so the whole ramp shows. NOT a score: the page labels it
 * a stand-in.
 */
export function standInFraction(cell, { x, y }) {
  const area = 0.5 + 0.5 * Math.sin(x / 70 + 1.3) * Math.cos(y / 90 - 0.4);
  return 0.7 * area + 0.3 * seededRandom(cell);
}

/** The way's vertices as local `{ x, y }`, or none for a non-way feature. */
function streetPoints(feature, frame) {
  const tags = feature.tags ?? {};
  if (feature.type !== "way" || !Array.isArray(feature.geometry)) return [];
  if (!STREET_CLASSES.has(tags.highway)) return [];
  const raised = (key) => tags[key] !== undefined && tags[key] !== "no";
  if (raised("tunnel") || raised("bridge")) return [];
  return feature.geometry.map((point) => frame.toEnu(point));
}

/** Walks a way's segments and yields each with the length on either side. */
function* segments(points) {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let walked = 0;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i];
    if (length > 0) {
      yield {
        from: points[i],
        to: points[i + 1],
        length,
        before: walked + length / 2,
        after: total - walked - length / 2,
      };
    }
    walked += length;
  }
}

/**
 * A person standing in the street nearest the centre: the eye at
 * `EYE_HEIGHT_M` on the middle of that segment, looking along the road towards
 * its longer part. Ties go to the lower OSM id, so the order of the features
 * does not matter. Without a street, the eye stands at the centre looking
 * north.
 */
export function streetCamera(features, frame) {
  let best = null;
  for (const feature of features) {
    for (const segment of segments(streetPoints(feature, frame))) {
      const x = (segment.from.x + segment.to.x) / 2;
      const y = (segment.from.y + segment.to.y) / 2;
      const distance = Math.hypot(x, y);
      const closer =
        !best ||
        distance < best.distance ||
        (distance === best.distance && feature.id < best.id);
      if (closer) best = { distance, id: feature.id, x, y, segment };
    }
  }
  if (!best) {
    return {
      position: [0, EYE_HEIGHT_M, 0],
      target: [0, EYE_HEIGHT_M, -STREET_TARGET_M],
    };
  }
  const { x, y, segment } = best;
  const sign = segment.after >= segment.before ? 1 : -1;
  const ahead = (sign * STREET_TARGET_M) / segment.length;
  return {
    position: [x, EYE_HEIGHT_M, 0 - y],
    target: [
      x + ahead * (segment.to.x - segment.from.x),
      EYE_HEIGHT_M,
      0 - (y + ahead * (segment.to.y - segment.from.y)),
    ],
  };
}
