/**
 * The 3D view's inspector, as data (pure): the selected station's, item's
 * or code's fields as the file holds them, with the values its fields
 * edit. The DOM is `shell-inspector.ts`'s.
 *
 * - A station: its name (its own, empty when untitled), "Station n of
 *   N", its description, the pictures its card may show (its photos and
 *   the tour's images) and the one it shows, its found and preload radii
 *   and how many of its items stand outside the circle, and where it
 *   stands: metres east and north of the 3D view's origin (given, else
 *   the tour's centre, `tour-origin.ts`), its height over the ellipsoid
 *   and its heading, and whether that position is locked (every station
 *   is, until unlocked); with the ground known, how far it and its items
 *   stand off it.
 * - An item (pin, photo, 3D model): its name (a pin's text to edit), its
 *   kind and station, a model's size, its offset in the station's frame
 *   and its heading there, and how far it stands off the ground.
 * - A code: its name, its line, its print size and where it stands, in
 *   the same metres.
 *
 * @see inspector-model.ts.md
 */
import type {
  TourAsset,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import { objectLook, type ObjectLook } from "../../object-describe.js";
import { stationTitle } from "../../station-run.js";
import {
  ownedAssetIds,
  storyBlocksOf,
  worldBlocks,
  type WorldBlock,
} from "../../tour-document.js";
import {
  BLOCK_KIND_LABEL,
  blockFields,
  blockTitle,
  type BlockField,
} from "../block-fields.js";
import { eastNorthOf, tourCentre } from "../tour-origin.js";
import { stationImagePath } from "./tree-model.js";

/** Where something stands: as the 3D view frames it, and as the file
 *  says its height and heading. */
export interface InspectorPosition {
  /** Metres east of the tour's centre (the 3D view's origin). */
  readonly eastM: number;
  /** Metres north of the tour's centre. */
  readonly northM: number;
  /** Over the ellipsoid (m), as the file writes heights. */
  readonly altM: number;
  /** Clockwise from north; null when the file gives none. */
  readonly headingDeg: number | null;
}

/** A picture a station's card may show. */
interface InspectorImage {
  /** What the station's `image` names: a photo item's or an image
   *  asset's id. */
  readonly id: string;
  /** Its content path (`content/<id>.jpg`). */
  readonly path: string;
  /** A photo's caption, else "Photo"; "Tour image" for an asset. */
  readonly label: string;
}

/** The ground's ellipsoidal height at a place (m), as the 3D view has it
 *  loaded; null where none has loaded. */
export type InspectorGround = (place: {
  readonly lat: number;
  readonly lon: number;
}) => number | null;

/** How far off the ground counts as off it (m). */
export const ON_GROUND_M = 0.05;

interface StationInspector {
  readonly kind: "station";
  readonly title: string;
  /** Its own title as the file holds it; empty for an untitled one (the
   *  title then is its stand-in, "Station n"). */
  readonly name: string;
  readonly sub: string;
  /** Its place in the tour (1-based) and the tour's station count: the
   *  inspector's Earlier and Later. */
  readonly place: { readonly number: number; readonly count: number };
  readonly description: string | null;
  readonly imagePath: string | null;
  /** The pictures the card may show: the station's photos, then the
   *  tour's image assets. */
  readonly images: readonly InspectorImage[];
  /** The one the card shows now (`imagePath`'s), or null. */
  readonly imageId: string | null;
  readonly foundRadiusM: number;
  readonly activateRadiusM: number;
  /** Its items standing outside the found radius (a radius lowered under
   *  them leaves them there). */
  readonly outside: number;
  /** Its items standing more than `ON_GROUND_M` off the ground; null
   *  while the ground under any of them has not loaded. */
  readonly offGround: number | null;
  /** Its point's height over the ground (m); null before the ground there
   *  has loaded. */
  readonly groundOffM: number | null;
  /** Null for a station the file does not place. */
  readonly position: InspectorPosition | null;
  /** Its position, height and heading may not be edited (the page's view
   *  state, `isStationLocked`): its gizmo is its radius dots alone. */
  readonly locked: boolean;
  /** The blocks its story shows, in the station's order, by kind and
   *  name (`blockTitle`): listed, not edited, here. */
  readonly story: readonly InspectorStoryBlock[];
}

/** A block a station's story shows, as its inspector lists it. */
interface InspectorStoryBlock {
  readonly id: string;
  /** Its kind in the block model's words ("Long text"). */
  readonly kind: string;
  /** Text, never markup: it comes from a file anyone can write. */
  readonly title: string;
}

interface ItemInspector {
  readonly kind: "item";
  readonly itemKind: ObjectLook;
  readonly title: string;
  readonly sub: string;
  /** Its station's id. */
  readonly stationId: string;
  /** A pin's text, the field to edit; null for a photo or a model (their
   *  caption is not edited here). */
  readonly text: string | null;
  /** A model's largest side (m); null for a pin or a photo. */
  readonly sizeM: number | null;
  /** Its other text fields to type, per kind (`block-fields.ts`, B2c): a
   *  short text's description, a picture's title, caption and alt text, a
   *  model's title. */
  readonly fields: readonly BlockField[];
  /** In the station's frame (m). */
  readonly offset: {
    readonly northM: number;
    readonly upM: number;
    readonly eastM: number;
  };
  /** Relative to the station; null for a rotation that is no number. */
  readonly headingDeg: number | null;
  /** Its height over the ground (m); null before the ground there has
   *  loaded. */
  readonly groundOffM: number | null;
}

interface CodeInspector {
  readonly kind: "code";
  readonly title: string;
  readonly sub: string;
  readonly printSizeM: number | null;
  /** Null for a code with no stored position, or one not placed. */
  readonly position: InspectorPosition | null;
}

export type InspectorModel = StationInspector | ItemInspector | CodeInspector;

/** The bottom bar's hint for the selection: the handles its gizmo has in
 *  the 3D view, or how to select when nothing is. A code is read-only
 *  there (no handles). */
export function inspectorHint(model: InspectorModel | null): string {
  if (model === null) {
    return "Click a station, an item or a code; drag to orbit, right-drag to pan, wheel to zoom; right-click the ground for a new station";
  }
  if (model.kind === "station") {
    return model.locked
      ? `${model.title} - a white dot for the radius; its position is locked (unlock it under Position to move or turn it)`
      : `${model.title} - drag the middle to move (its items follow), a white dot for the radius, the round arrow to turn`;
  }
  if (model.kind === "item") {
    const resize = model.itemKind === "model" ? ", a white dot to resize" : "";
    return `${model.title} - drag the middle to move along the ground, the round arrow to turn${resize}`;
  }
  return `${model.title} - read-only here; F frames it, Esc deselects`;
}

/** A code as the inspector reads it. */
export interface InspectorCode {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
  readonly geo: {
    readonly lat: number;
    readonly lon: number;
    readonly alt: number;
    readonly headingDeg?: number;
    readonly rotation?: readonly [number, number, number, number];
  } | null;
  readonly printSizeM: number | null;
}

/**
 * The bearing (degrees clockwise from north, 0-360) a rotation in a
 * north-up-east frame turns the frame's north axis to; null when the
 * rotation is not finite or turns north straight up or down.
 */
export function headingOfRotation(
  rotation: readonly [number, number, number, number] | readonly number[],
): number | null {
  const [x = 0, y = 0, z = 0, w = 1] = rotation;
  if (![x, y, z, w].every(Number.isFinite)) return null;
  // The north axis (1, 0, 0) turned: its north and east parts.
  const north = 1 - 2 * (y * y + z * z);
  const east = 2 * (x * z - w * y);
  if (Math.hypot(north, east) < 1e-9) return null;
  const deg = (Math.atan2(east, north) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

function positionOf(
  geo: NonNullable<InspectorCode["geo"]>,
  origin: { readonly lat: number; readonly lng: number } | null,
): InspectorPosition | null {
  const at = origin === null ? null : eastNorthOf(geo, origin);
  if (at === null || !Number.isFinite(geo.alt)) return null;
  const heading =
    geo.headingDeg ??
    (geo.rotation === undefined ? null : headingOfRotation(geo.rotation));
  return { ...at, altM: geo.alt, headingDeg: heading };
}

/** A photo's caption, or "Photo". */
function photoLabel(label: string | undefined): string {
  const caption = label?.trim() ?? "";
  return caption === "" ? "Photo" : caption;
}

/** The pictures `station`'s card may show (its photos, then the tour's
 *  image assets that are no captured photo's own, `owned`), and the one
 *  it shows (`stationImagePath`'s rule). */
function cardImages(
  station: TourStation,
  assets: readonly TourAsset[],
  owned: ReadonlySet<string>,
): { images: InspectorImage[]; imageId: string | null } {
  const images: InspectorImage[] = [
    ...worldBlocks(station).flatMap((i) => {
      if (i.kind !== "picture") return [];
      const path = assets.find(
        (a) => a.id === i.image && a.kind === "image",
      )?.path;
      return path === undefined
        ? []
        : [{ id: i.id, path, label: photoLabel(i.caption) }];
    }),
    ...assets.flatMap((a) =>
      a.kind === "image" && !owned.has(a.id)
        ? [{ id: a.id, path: a.path, label: "Tour image" }]
        : [],
    ),
  ];
  const shown = stationImagePath(station, assets);
  const named = images.find((i) => i.id === station.image && i.path === shown);
  return {
    images,
    imageId: named?.id ?? images.find((i) => i.path === shown)?.id ?? null,
  };
}

/** A height off the ground as the inspector shows it: in tenths of a
 *  metre, 0 within `ON_GROUND_M`. The ground changes by centimetres while
 *  finer tiles arrive; a model that carried the raw height would change
 *  with each of them, and the inspector would be drawn again for nothing
 *  it shows. */
function shownOff(m: number): number {
  return Math.abs(m) <= ON_GROUND_M ? 0 : Math.round(m * 10) / 10;
}

/** `geo`'s height over the ground (m, as shown: `shownOff`), or null
 *  where none has loaded. */
function offGroundOf(
  geo: { readonly lat: number; readonly lon: number; readonly alt: number },
  groundAt: InspectorGround | undefined,
): number | null {
  const ground = groundAt?.({ lat: geo.lat, lon: geo.lon }) ?? null;
  return ground === null || !Number.isFinite(ground)
    ? null
    : shownOff(geo.alt - ground);
}

/** `item`'s height over the ground; null for one that cannot be placed
 *  or before the ground under it has loaded. */
function itemOffGround(
  item: WorldBlock,
  station: TourStation,
  groundAt: InspectorGround | undefined,
): number | null {
  if (groundAt === undefined) return null;
  try {
    return offGroundOf(itemGeoPose(item.pose, station.geo), groundAt);
  } catch {
    return null;
  }
}

/** The inspector for `selected` (the page's selection id), or null when
 *  nothing is selected or the tour does not have it. */
export function buildInspector(input: {
  readonly selected: string | null;
  readonly stations: readonly TourStation[];
  readonly assets: readonly TourAsset[];
  readonly codes: readonly InspectorCode[];
  /** The stations whose position is unlocked, by id; every other station
   *  is locked (none given: all are). */
  readonly unlockedStations?: readonly string[];
  /** The 3D view's origin, fixed when it opened; none given: the tour's
   *  centre now (the same, until a station moves). */
  readonly origin?: { readonly lat: number; readonly lng: number } | null;
  /** The ground as the 3D view has it loaded; none given: unknown. */
  readonly groundAt?: InspectorGround;
}): InspectorModel | null {
  const { selected, stations, groundAt } = input;
  if (selected === null) return null;
  // The 3D view's origin: the same centre its frame is built on.
  const origin =
    input.origin ??
    tourCentre(
      stations,
      input.codes.flatMap((c) => (c.geo === null ? [] : [c.geo])),
    );
  if (selected.startsWith("station:")) {
    const id = selected.slice("station:".length);
    const index = stations.findIndex((s) => s.id === id);
    const station = stations[index];
    if (station === undefined) return null;
    const description = station.description?.trim() ?? "";
    const offs = worldBlocks(station).map((item) =>
      itemOffGround(item, station, groundAt),
    );
    return {
      kind: "station",
      title: stationTitle(station, index + 1),
      name: station.title?.trim() ?? "",
      sub: `Station ${String(index + 1)} of ${String(stations.length)}`,
      place: { number: index + 1, count: stations.length },
      description: description === "" ? null : description,
      imagePath: stationImagePath(station, input.assets),
      ...cardImages(station, input.assets, ownedAssetIds({ stations })),
      foundRadiusM: station.foundRadiusM,
      activateRadiusM: station.activateRadiusM,
      outside: worldBlocks(station).filter(
        (i) =>
          Math.hypot(i.pose.position[0], i.pose.position[2]) >
          station.foundRadiusM,
      ).length,
      offGround: offs.includes(null)
        ? null
        : offs.filter((m) => m !== null && Math.abs(m) > ON_GROUND_M).length,
      groundOffM: offGroundOf(station.geo, groundAt),
      position: positionOf(station.geo, origin),
      locked: !(input.unlockedStations ?? []).includes(id),
      story: storyBlocksOf(station).map((block) => ({
        id: block.id,
        kind: BLOCK_KIND_LABEL[block.kind],
        title: blockTitle(block),
      })),
    };
  }
  for (const [index, station] of stations.entries()) {
    const item = worldBlocks(station).find((i) => i.id === selected);
    if (item === undefined) continue;
    const [northM, upM, eastM] = item.pose.position;
    return {
      kind: "item",
      itemKind: objectLook(item.kind),
      title: blockTitle(item),
      sub: `${BLOCK_KIND_LABEL[item.kind]} in ${stationTitle(station, index + 1)}`,
      stationId: station.id,
      text: item.kind === "shortText" ? item.caption : null,
      sizeM: item.kind === "model" ? (item.sizeM ?? null) : null,
      fields: blockFields(item),
      offset: { northM, upM, eastM },
      headingDeg: headingOfRotation(item.pose.rotation),
      groundOffM: itemOffGround(item, station, groundAt),
    };
  }
  const code = input.codes.find((c) => c.id === selected);
  if (code === undefined) return null;
  return {
    kind: "code",
    title: code.title,
    sub: code.meta,
    printSizeM: code.printSizeM,
    position: code.geo === null ? null : positionOf(code.geo, origin),
  };
}
