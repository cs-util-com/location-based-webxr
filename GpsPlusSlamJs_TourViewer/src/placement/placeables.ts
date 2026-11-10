/**
 * Everything the 3D editor can place, as one shape: a PLACEABLE. A free
 * block in a view the world shows, or a station, each with its pose in
 * the world and in its holder, what its row says about turning, lifting
 * and its dots (`placement-rows.ts`), and whether it is locked. The gizmo,
 * the gestures, the keys and the inspector read a placeable and never ask
 * what kind of thing it is; this module is the only place that walks a
 * station's children (through its plain folders) to make them.
 *
 * Pure: no three.js, no page state but the stations' locks the caller
 * hands in.
 *
 * @see placeables.ts.md
 */
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import {
  composeTourFolderPath,
  type TourFolderFrame,
} from "gps-plus-slam-app-framework/ar/tour-folder-pose";
import type { TourLocalPose } from "gps-plus-slam-app-framework/ar/tour-items";
import type {
  TourBlock,
  TourManifest,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  isTourBlockChild,
  isTourFolder,
  type TourStationChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { STATION_PREFIX } from "../editor/editor-model.js";
import {
  STATION_PLACEMENT,
  blockPlacement,
  type ExtentSpec,
  type ViewPlacement,
} from "./placement-rows.js";

/** What the document can name and write a placement back to: one arm
 *  per kind of HOLDER, never per block kind. */
export type PlaceRef =
  | { readonly kind: "block"; readonly id: string }
  | { readonly kind: "station"; readonly id: string };

/** A placeable's dots: what they change, and the value now. */
export type PlaceExtent = ExtentSpec & { readonly value: number };

export interface Placeable {
  readonly ref: PlaceRef;
  /** Its key in the page's selection (`<id>`, `station:<id>`). */
  readonly selection: string;
  /** Its station (a station: itself). */
  readonly stationId: string;
  /** The plain folders holding it, outermost first (none: the station's
   *  top; a station: none). */
  readonly folderPath: readonly string[];
  /** Its pose in the world, composed through its folders and station. */
  readonly geo: QrGeoPose;
  /** Its pose in its holder (the innermost folder, else the station), as
   *  the file stores it; null for a station, whose frame is the earth. */
  readonly local: TourLocalPose | null;
  /** The scale its holders apply to it (1: none). */
  readonly inheritedScale: number;
  readonly turns: boolean;
  readonly lifts: boolean;
  /** Its dots; null: none. */
  readonly extent: PlaceExtent | null;
  /** Only its dots may be dragged (a station the creator locked). */
  readonly locked: boolean;
  /** The block ids whose drawings follow it: itself for a block, none for
   *  a station (its whole drawing moves). */
  readonly members: readonly string[];
}

/** What the page knows that the tour does not. */
export interface PlaceScope {
  /** Whether a station's pose is locked (the page's view state). */
  readonly stationLocked?: (stationId: string) => boolean;
}

/** `row`'s dots read from `holder` (a block, a station); null with no
 *  dots, or a value the holder lacks. */
function extentOf(row: ViewPlacement, holder: object): PlaceExtent | null {
  const spec = row.extent;
  if (spec === undefined) return null;
  const value: unknown = (holder as Readonly<Record<string, unknown>>)[
    spec.field
  ];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return { ...spec, value };
}

/** A posed block standing in `station` inside `folders` (outermost
 *  first), or null for a view the world does not show. */
function blockPlaceable(
  block: TourBlock,
  station: TourStation,
  folders: readonly (TourFolderFrame & { readonly id: string })[],
): Placeable | null {
  const row = blockPlacement(block.kind, block.view);
  if (row === null || !row.posed) return null;
  return {
    ref: { kind: "block", id: block.id },
    selection: block.id,
    stationId: station.id,
    folderPath: folders.map((f) => f.id),
    geo: itemGeoPose(composeTourFolderPath(folders, block.pose), station.geo),
    local: block.pose,
    inheritedScale: 1,
    turns: row.turns,
    lifts: row.lifts,
    extent: extentOf(row, block),
    locked: false,
    members: [block.id],
  };
}

/** The posed blocks of `children` (a station's, or a folder's inside
 *  `folders`), through every plain folder, in document order. Stories
 *  are left out: their blocks are steps, not free blocks. */
function walk(
  children: readonly TourStationChild[],
  station: TourStation,
  folders: readonly (TourFolderFrame & { readonly id: string })[],
): Placeable[] {
  return children.flatMap((child): Placeable[] => {
    if (isTourBlockChild(child)) {
      const placeable = blockPlaceable(child, station, folders);
      return placeable === null ? [] : [placeable];
    }
    if (!isTourFolder(child)) return [];
    return walk(child.children, station, [...folders, child]);
  });
}

/** The posed blocks of `station`, wherever its plain folders hold them:
 *  what the world shows of it, each with its pose and handles. */
export function posedBlocks(station: TourStation): readonly Placeable[] {
  return walk(station.children, station, []);
}

/** `station` as a placeable. */
function stationPlaceable(station: TourStation, scope: PlaceScope): Placeable {
  return {
    ref: { kind: "station", id: station.id },
    selection: `${STATION_PREFIX}${station.id}`,
    stationId: station.id,
    folderPath: [],
    geo: station.geo,
    local: null,
    inheritedScale: 1,
    turns: STATION_PLACEMENT.turns,
    lifts: STATION_PLACEMENT.lifts,
    extent: extentOf(STATION_PLACEMENT, station),
    locked: scope.stationLocked?.(station.id) === true,
    members: [],
  };
}

/** Every placeable of `tour`: each station, then its posed blocks. */
export function placeablesOf(
  tour: Pick<TourManifest, "stations">,
  scope: PlaceScope = {},
): readonly Placeable[] {
  return tour.stations.flatMap((station) => [
    stationPlaceable(station, scope),
    ...posedBlocks(station),
  ]);
}

/** The placeable the page's `selection` names; null for one that names
 *  nothing placeable (a code, a card, a block the tour lacks). */
export function placeableOf(
  tour: Pick<TourManifest, "stations">,
  selection: string,
  scope: PlaceScope = {},
): Placeable | null {
  if (selection.startsWith(STATION_PREFIX)) {
    const id = selection.slice(STATION_PREFIX.length);
    const station = tour.stations.find((s) => s.id === id);
    return station === undefined ? null : stationPlaceable(station, scope);
  }
  for (const station of tour.stations) {
    const found = posedBlocks(station).find((p) => p.selection === selection);
    if (found !== undefined) return found;
  }
  return null;
}
