/**
 * Street furniture from mapped nodes: street lamps (on a mast, on a wall or
 * hung over the street), bollards, benches and waste baskets, each with where
 * it stands, which way it faces, how tall it is, and the list of what the map
 * did not say and was guessed.
 *
 * WHY ONLY NODES. A lamp, a bollard, a bench and a bin are point objects in
 * OSM. A bench or a bollard row mapped as a way is rare, and inventing point
 * objects along it would be a guess dressed as data; such ways stay with the
 * barrier builder, which draws a mapped line as a line.
 *
 * WHY THE GUESSES ARE LISTED. The scene draws every item the same way whether
 * its height was tagged or defaulted, so `guessed` is the only place the
 * difference survives (a debug view or a test reads it).
 *
 * Pure data: no three.js. The renderer is `three/street-furniture.ts`.
 *
 * @see street-furniture.ts.md
 */

import {
  featureKey,
  type LatLng,
  type OsmFeature,
  type OsmFeatureKey,
} from "../model/osm-feature.js";
import type { Bbox } from "../spatial/clip.js";
import { parseLengthMetres } from "./building-heights.js";
import type { EnuFrame, EnuPoint } from "./enu.js";
import { stableRotationY } from "./stable-jitter.js";

/** The kinds a consumer can ask for (`CityOptions.furniture`). */
export type FurnitureKind = "lamp" | "bollard" | "bench" | "bin";

/** Every kind, in the order the city builds them by default. */
export const FURNITURE_KINDS: readonly FurnitureKind[] = [
  "lamp",
  "bollard",
  "bench",
  "bin",
];

/** The drawn model: a lamp's mount picks one of three. */
export type FurnitureModel =
  "lamp" | "lamp-wall" | "lamp-suspended" | "bollard" | "bench" | "bin";

/**
 * The height of a model without a `height` tag, metres: OSM2World's 5 m
 * mast, a wall lamp's head at 4 m, a lamp hung over the street at 6 m, a
 * 0.9 m bollard. Benches and bins are absent: they draw their POI model at
 * its own real-world size.
 */
export const FURNITURE_DEFAULT_HEIGHT_M = {
  lamp: 5,
  "lamp-wall": 4,
  "lamp-suspended": 6,
  bollard: 0.9,
} as const satisfies Partial<Record<FurnitureModel, number>>;

/** A tagged height above this is refused as a typo (a mast lamp is ~4-12 m). */
export const MAX_FURNITURE_HEIGHT_M = 30;

/** What the map did not say about an item. */
export type FurnitureGuess = "height" | "yaw";

/** One item of street furniture. */
export interface FurniturePlacement {
  readonly key: OsmFeatureKey;
  readonly kind: FurnitureKind;
  readonly model: FurnitureModel;
  /** Metres east/north of the frame origin. */
  readonly position: EnuPoint;
  /** Ground height at the item, metres. */
  readonly groundHeightM: number;
  /** Rotation about the vertical axis, radians, anticlockwise from above. */
  readonly yawRad: number;
  /**
   * The drawn height, metres, for lamps and bollards (their model is
   * stretched to it). Absent for benches and bins, drawn at their model's
   * own size.
   */
  readonly heightM?: number;
  /** What was guessed, in the order height, yaw; empty when all was mapped. */
  readonly guessed: readonly FurnitureGuess[];
}

export interface BuildStreetFurnitureOptions {
  readonly frame: EnuFrame;
  readonly groundHeightM?: (position: LatLng) => number;
  /** The fetched data's box; nothing is placed outside it. Required. */
  readonly window: Bbox;
  /** The kinds to build. Default every kind; empty builds none. */
  readonly kinds?: readonly FurnitureKind[];
}

const KIND_OF_MODEL: Readonly<Record<FurnitureModel, FurnitureKind>> = {
  lamp: "lamp",
  "lamp-wall": "lamp",
  "lamp-suspended": "lamp",
  bollard: "bollard",
  bench: "bench",
  bin: "bin",
};

/**
 * The model for a node's tags, or undefined when it is not furniture. A
 * lamp wins over the other kinds on a node tagged as two (a lamp post that
 * is also a bollard is drawn as the lamp).
 */
export function furnitureModelOf(
  tags: Readonly<Record<string, string>>,
): FurnitureModel | undefined {
  if (tags["highway"] === "street_lamp") {
    if (tags["lamp_mount"] === "wall") return "lamp-wall";
    if (tags["lamp_mount"] === "suspended") return "lamp-suspended";
    return "lamp";
  }
  if (tags["amenity"] === "bench") return "bench";
  if (tags["amenity"] === "waste_basket") return "bin";
  if (tags["barrier"] === "bollard") return "bollard";
  return undefined;
}

/**
 * The yaw for an OSM `direction` in compass degrees (clockwise from north):
 * `-degrees` in radians, since a rotation about +y is anticlockwise seen
 * from above. Undefined for anything that is not a plain decimal number of
 * degrees: cardinal letters, ranges, lists, exponents, empty.
 */
export function compassYawRad(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\s*-?\d+(?:\.\d+)?\s*$/.test(raw)) return undefined;
  return (-Number(raw) * Math.PI) / 180;
}

/**
 * The street furniture among `features`, in input order. RangeError for a
 * missing window or an unknown kind.
 */
export function buildStreetFurniture(
  features: Iterable<OsmFeature>,
  options: BuildStreetFurnitureOptions,
): FurniturePlacement[] {
  const kinds = checkedKinds(options);
  const out: FurniturePlacement[] = [];
  if (kinds.size === 0) return out;
  for (const feature of features) {
    if (feature.type !== "node") continue;
    const model = furnitureModelOf(feature.tags);
    if (model === undefined) continue;
    const kind = KIND_OF_MODEL[model];
    if (!kinds.has(kind) || !inWindow(options.window, feature.position)) {
      continue;
    }
    out.push(placementOf(feature, model, kind, options));
  }
  return out;
}

function placementOf(
  feature: OsmFeature & { readonly type: "node" },
  model: FurnitureModel,
  kind: FurnitureKind,
  options: BuildStreetFurnitureOptions,
): FurniturePlacement {
  const key = featureKey(feature);
  const tags = feature.tags as Record<string, string>;
  const guessed: FurnitureGuess[] = [];
  const height = heightOf(model, tags["height"]);
  if (height?.guessed === true) guessed.push("height");
  const mappedYaw = compassYawRad(tags["direction"]);
  if (mappedYaw === undefined) guessed.push("yaw");
  return {
    key,
    kind,
    model,
    position: options.frame.toEnu(feature.position),
    groundHeightM: finiteOrZero(options.groundHeightM?.(feature.position)),
    // The shared seeded yaw, so a bench drawn as a POI marker and as
    // furniture faces the same way.
    yawRad: mappedYaw ?? stableRotationY(key),
    ...(height === undefined ? {} : { heightM: height.metres }),
    guessed,
  };
}

/** A lamp's or bollard's height: the tag when plausible, else the default. */
function heightOf(
  model: FurnitureModel,
  raw: string | undefined,
): { metres: number; guessed: boolean } | undefined {
  if (!(model in FURNITURE_DEFAULT_HEIGHT_M)) return undefined;
  const tagged = parseLengthMetres(raw);
  if (tagged !== undefined && tagged > 0 && tagged <= MAX_FURNITURE_HEIGHT_M) {
    return { metres: tagged, guessed: false };
  }
  const fallback =
    FURNITURE_DEFAULT_HEIGHT_M[
      model as keyof typeof FURNITURE_DEFAULT_HEIGHT_M
    ];
  return { metres: fallback, guessed: true };
}

function checkedKinds(
  options: BuildStreetFurnitureOptions,
): ReadonlySet<FurnitureKind> {
  if (options.window === undefined) {
    throw new RangeError(
      "buildStreetFurniture needs a window (the fetched bbox)",
    );
  }
  const kinds = options.kinds ?? FURNITURE_KINDS;
  for (const kind of kinds) {
    if (!FURNITURE_KINDS.includes(kind)) {
      throw new RangeError(`unknown furniture kind ${String(kind)}`);
    }
  }
  return new Set(kinds);
}

function inWindow(window: Bbox, p: LatLng): boolean {
  return (
    p.lat >= window.south &&
    p.lat <= window.north &&
    p.lng >= window.west &&
    p.lng <= window.east
  );
}

/**
 * The indices of `items` within `cutM` metres of `eye` in plan (inclusive),
 * in order; `Infinity` keeps every item. RangeError for a cut that is not a
 * positive number.
 */
export function furnitureWithinCut(
  items: readonly { readonly position: EnuPoint }[],
  eye: EnuPoint,
  cutM: number,
): number[] {
  if (!(cutM > 0)) {
    throw new RangeError(`the furniture cut must be positive, got ${cutM}`);
  }
  const out: number[] = [];
  items.forEach((item, i) => {
    const d = Math.hypot(item.position.x - eye.x, item.position.y - eye.y);
    if (d <= cutM) out.push(i);
  });
  return out;
}

/** A ground that is missing or not a number reads as 0, as for the markings. */
function finiteOrZero(height: number | undefined): number {
  return height !== undefined && Number.isFinite(height) ? height : 0;
}
