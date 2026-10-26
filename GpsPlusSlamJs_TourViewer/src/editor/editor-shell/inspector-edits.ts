/**
 * A value typed in the 3D view's inspector, as the one edit of the tour it
 * writes (pure). The shell hands the edit to the page, which writes it
 * through the editor session as one undo step.
 *
 * - A station's title, description and found radius: a station edit.
 * - A pin's text (its title box): its text. A photo's or a model's
 *   caption is not edited here.
 * - A station's east and north: its anchor at the place those metres name
 *   from the 3D view's origin (`placeAtEastNorth`), height and turn kept.
 * - An item's east and north: its offset in its station's frame, the
 *   other two and its turn kept.
 * - An item's height: its altitude alone (`height`), its place and turn
 *   exactly as they are; a pose through the station's frame and back
 *   would move it sideways by its rounding.
 * - A heading, of a station or an item: the turn from the heading it has
 *   now, the short way round.
 * - A model's size.
 *
 * And "Put on the ground" and "Put items on the ground" (`groundEdit`):
 * heights at the ground the 3D view has loaded, or null while it has not.
 *
 * @see inspector-edits.ts.md
 */
import type {
  TourItem,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import type { GestureEdit } from "../../editor3d/gesture.js";
import type { StationEdit } from "../../tour-document.js";
import { STATION_PREFIX } from "../editor-model.js";
import { eastNorthOf, placeAtEastNorth } from "../tour-origin.js";
import { headingOfRotation, ON_GROUND_M } from "./inspector-model.js";

/** What a typed value writes. */
export type InspectorEdit =
  /** Nothing: the value is the one the tour has, or the field is not
   *  this selection's. */
  | { readonly kind: "none" }
  /** A value that is no number, said in words; nothing is written. */
  | { readonly kind: "invalid"; readonly reason: string }
  | {
      readonly kind: "station";
      readonly stationId: string;
      readonly edit: StationEdit;
    }
  | { readonly kind: "text"; readonly id: string; readonly text: string }
  /** A pose or a size, written as the 3D view's gestures write them. */
  | { readonly kind: "scene"; readonly edit: GestureEdit }
  /** A turn about up of `deg` clockwise. */
  | { readonly kind: "turn"; readonly selection: string; readonly deg: number }
  /** An item's altitude (ellipsoidal m), its place and turn kept. */
  | { readonly kind: "height"; readonly id: string; readonly alt: number };

const NOT_A_NUMBER = "Type a number, like 12.5";

const NONE: InspectorEdit = { kind: "none" };

/** A plain decimal: a sign, digits and one decimal point or comma. */
const DECIMAL = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;

/** A typed number: a plain decimal, a comma as its decimal point (one
 *  comma always is: "1,000" is 1); blank, or anything else (hex, an
 *  exponent, a second comma or point), is none. */
function typedNumber(value: string): number | null {
  const text = value.trim();
  if (!DECIMAL.test(text)) return null;
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** `deg` as a turn of -180 to 180 degrees. */
function shortTurn(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

const SAME = 1e-9;

function turnTo(
  selection: string,
  now: number | null,
  typed: number,
): InspectorEdit {
  if (now === null) return NONE;
  const deg = shortTurn(typed - now);
  return Math.abs(deg) < SAME ? NONE : { kind: "turn", selection, deg };
}

function stationEdit(
  station: TourStation,
  field: string,
  value: string,
  origin: { readonly lat: number; readonly lng: number } | null,
): InspectorEdit {
  const stationId = station.id;
  if (field === "title")
    return { kind: "station", stationId, edit: { title: value } };
  if (field === "description") {
    return { kind: "station", stationId, edit: { description: value } };
  }
  if (!["radius", "east", "north", "heading"].includes(field)) return NONE;
  const typed = typedNumber(value);
  if (typed === null) return { kind: "invalid", reason: NOT_A_NUMBER };
  if (field === "radius") {
    return Math.abs(typed - station.foundRadiusM) < SAME
      ? NONE
      : { kind: "station", stationId, edit: { foundRadiusM: typed } };
  }
  const selection = `${STATION_PREFIX}${stationId}`;
  if (field === "heading") {
    const now =
      station.geo.headingDeg ??
      (station.geo.rotation === undefined
        ? null
        : headingOfRotation(station.geo.rotation));
    return turnTo(selection, now, typed);
  }
  const at = origin === null ? null : eastNorthOf(station.geo, origin);
  if (at === null || origin === null) return NONE;
  const next =
    field === "east"
      ? { eastM: typed, northM: at.northM }
      : { eastM: at.eastM, northM: typed };
  if (
    Math.abs(next.eastM - at.eastM) < SAME &&
    Math.abs(next.northM - at.northM) < SAME
  ) {
    return NONE;
  }
  const place = placeAtEastNorth(next, origin);
  if (place === null) return NONE;
  return {
    kind: "scene",
    edit: {
      kind: "station-pose",
      id: stationId,
      geo: { ...station.geo, lat: place.lat, lon: place.lon },
    },
  };
}

/** Which axis of the offset (north, up, east) a field types. */
const AXIS: Readonly<Record<string, 0 | 1 | 2>> = {
  north: 0,
  height: 1,
  east: 2,
};

function itemEdit(
  item: TourItem,
  station: TourStation,
  field: string,
  value: string,
): InspectorEdit {
  if (field === "title") {
    return item.kind === "pin"
      ? { kind: "text", id: item.id, text: value }
      : NONE;
  }
  const axis = AXIS[field];
  const known =
    axis !== undefined ||
    field === "heading" ||
    (field === "size" && item.kind === "model");
  if (!known) return NONE;
  const typed = typedNumber(value);
  if (typed === null) return { kind: "invalid", reason: NOT_A_NUMBER };
  if (field === "size" && item.kind === "model") {
    return Math.abs(typed - item.sizeM) < SAME
      ? NONE
      : { kind: "scene", edit: { kind: "size", id: item.id, sizeM: typed } };
  }
  if (field === "heading") {
    return turnTo(item.id, headingOfRotation(item.pose.rotation), typed);
  }
  if (axis === undefined) return NONE;
  if (Math.abs(item.pose.position[axis] - typed) < SAME) return NONE;
  const position: [number, number, number] = [...item.pose.position];
  position[axis] = typed;
  if (field === "height") {
    return {
      kind: "height",
      id: item.id,
      alt: itemGeoPose({ ...item.pose, position }, station.geo).alt,
    };
  }
  return {
    kind: "scene",
    edit: {
      kind: "item-pose",
      id: item.id,
      geo: itemGeoPose({ ...item.pose, position }, station.geo),
    },
  };
}

/**
 * The edit `value` typed into `field` writes for `selected` (the page's
 * selection: `station:<id>` or an item's id), its metres measured from
 * `origin` (the 3D view's; null: a station's place is not typed). Fields:
 * `title`, `description`, `radius`, `east`, `north`, `height`, `heading`,
 * `size`. A selection the tour lacks, a code, and a field the selection
 * has not write nothing.
 */
export function inspectorEdit(input: {
  readonly selected: string;
  readonly stations: readonly TourStation[];
  readonly origin: { readonly lat: number; readonly lng: number } | null;
  readonly field: string;
  readonly value: string;
}): InspectorEdit {
  const { selected, stations, field, value } = input;
  if (selected.startsWith(STATION_PREFIX)) {
    const id = selected.slice(STATION_PREFIX.length);
    const station = stations.find((s) => s.id === id);
    return station === undefined
      ? NONE
      : stationEdit(station, field, value, input.origin);
  }
  for (const station of stations) {
    const item = station.items.find((i) => i.id === selected);
    if (item !== undefined) return itemEdit(item, station, field, value);
  }
  return NONE;
}

/** What "Put on the ground" writes: items' heights in one edit, or a
 *  station's anchor (its pose, so the lock holds it). */
export type GroundEdit =
  | { readonly kind: "none" }
  | {
      readonly kind: "ground-items";
      readonly items: readonly { readonly id: string; readonly alt: number }[];
    }
  | { readonly kind: "scene"; readonly edit: GestureEdit };

const NO_GROUND: GroundEdit = { kind: "none" };

/** The ground's ellipsoidal height at a place; null where none has loaded. */
type GroundAt = (place: {
  readonly lat: number;
  readonly lon: number;
}) => number | null;

/** The items of `station` among `ids` with the ground under each; null
 *  while the ground under any of them has not loaded. */
function groundedItems(
  station: TourStation,
  items: readonly TourItem[],
  groundAt: GroundAt,
): { id: string; alt: number; off: number }[] | null {
  const out: { id: string; alt: number; off: number }[] = [];
  for (const item of items) {
    const geo = itemGeoPose(item.pose, station.geo);
    const ground = groundAt({ lat: geo.lat, lon: geo.lon });
    if (ground === null || !Number.isFinite(ground)) return null;
    out.push({ id: item.id, alt: ground, off: geo.alt - ground });
  }
  return out;
}

/**
 * What "Put on the ground" (`which` "ground": the selected station's
 * anchor, or the selected item) or "Put items on the ground"
 * (`ground-items`: the selected station's items) writes, by the ground
 * `groundAt` has loaded: each at the ground's height under its own place,
 * those already within `ON_GROUND_M` of it left out. Null while the
 * ground under any of them has not loaded (the shell waits); none for a
 * selection the tour lacks, or with nothing off the ground.
 */
export function groundEdit(input: {
  readonly selected: string;
  readonly stations: readonly TourStation[];
  readonly which: "ground" | "ground-items";
  readonly groundAt: GroundAt;
}): GroundEdit | null {
  const { selected, stations, which, groundAt } = input;
  if (selected.startsWith(STATION_PREFIX)) {
    const id = selected.slice(STATION_PREFIX.length);
    const station = stations.find((s) => s.id === id);
    if (station === undefined) return NO_GROUND;
    if (which === "ground-items") {
      const items = groundedItems(station, station.items, groundAt);
      if (items === null) return null;
      const off = items.filter((i) => Math.abs(i.off) > ON_GROUND_M);
      return off.length === 0
        ? NO_GROUND
        : {
            kind: "ground-items",
            items: off.map(({ id: itemId, alt }) => ({ id: itemId, alt })),
          };
    }
    const ground = groundAt({ lat: station.geo.lat, lon: station.geo.lon });
    if (ground === null || !Number.isFinite(ground)) return null;
    if (Math.abs(station.geo.alt - ground) <= ON_GROUND_M) return NO_GROUND;
    return {
      kind: "scene",
      edit: { kind: "station-pose", id, geo: { ...station.geo, alt: ground } },
    };
  }
  if (which !== "ground") return NO_GROUND;
  for (const station of stations) {
    const item = station.items.find((i) => i.id === selected);
    if (item === undefined) continue;
    const [grounded] = groundedItems(station, [item], groundAt) ?? [];
    if (grounded === undefined) return null;
    return Math.abs(grounded.off) <= ON_GROUND_M
      ? NO_GROUND
      : { kind: "ground-items", items: [{ id: item.id, alt: grounded.alt }] };
  }
  return NO_GROUND;
}
