/**
 * Everything the 3D editor can place, as one shape: a PLACEABLE. A free
 * block in a view the world shows, a plain folder, or a station, each
 * with its pose in
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
  composedTourFolderScale,
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
  type TourFolder,
  type TourStationChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { FOLDER_PREFIX, STATION_PREFIX } from "../editor/editor-model.js";
import {
  CONTAINER_PLACEMENT,
  STATION_PLACEMENT,
  blockPlacement,
  type ExtentSpec,
  type ViewPlacement,
} from "./placement-rows.js";

/** What the document can name and write a placement back to: one arm
 *  per kind of HOLDER, never per block kind. */
export type PlaceRef =
  | { readonly kind: "block"; readonly id: string }
  | { readonly kind: "folder"; readonly id: string }
  | { readonly kind: "station"; readonly id: string };

/** A placeable's dots: what they change, and the value now. */
export type PlaceExtent = ExtentSpec & { readonly value: number };

export interface Placeable {
  readonly ref: PlaceRef;
  /** Its key in the page's selection (`<id>`, `folder:<id>`,
   *  `station:<id>`). */
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
  /** Its pose in its station's frame, composed through its folders: where
   *  it stands from the station's anchor; null for a station. */
  readonly inStation: TourLocalPose | null;
  /** The scale its holders apply to it (1: none). */
  readonly inheritedScale: number;
  readonly turns: boolean;
  readonly lifts: boolean;
  /** Its dots; null: none. */
  readonly extent: PlaceExtent | null;
  /** Its bend (degrees, 0 where none is written) for what bends (its
   *  row's `bends`); absent otherwise. */
  readonly bendDeg?: number;
  /** Only its dots may be dragged (a station the creator locked). */
  readonly locked: boolean;
  /** The block ids whose drawings follow it: itself for a block, the
   *  posed blocks it holds at any depth for a folder, none for a station
   *  (its whole drawing moves). */
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

/** A bending block's bend as written: 0 for none or one not finite (the
 *  drawing's own reading). */
function bendOf(block: object): number {
  const value: unknown = (block as Readonly<Record<string, unknown>>).bendDeg;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
  const inStation = composeTourFolderPath(folders, block.pose);
  return {
    ref: { kind: "block", id: block.id },
    selection: block.id,
    stationId: station.id,
    folderPath: folders.map((f) => f.id),
    geo: itemGeoPose(inStation, station.geo),
    local: block.pose,
    inStation,
    inheritedScale: composedTourFolderScale(folders),
    turns: row.turns,
    lifts: row.lifts,
    extent: extentOf(row, block),
    ...(row.bends === true ? { bendDeg: bendOf(block) } : {}),
    locked: false,
    members: [block.id],
  };
}

/** A posed block with the placeable it is: for the readers that need
 *  the block's own fields beside its place (its title, its texts). */
export interface PosedBlock {
  readonly block: TourBlock;
  readonly place: Placeable;
}

/** The posed blocks of `children` (a station's, or a folder's inside
 *  `folders`), through every plain folder, in document order. Stories
 *  are left out: their blocks are steps, not free blocks. */
function walk(
  children: readonly TourStationChild[],
  station: TourStation,
  folders: readonly (TourFolderFrame & { readonly id: string })[],
): PosedBlock[] {
  return children.flatMap((child): PosedBlock[] => {
    if (isTourBlockChild(child)) {
      const place = blockPlaceable(child, station, folders);
      return place === null ? [] : [{ block: child, place }];
    }
    if (!isTourFolder(child)) return [];
    return walk(child.children, station, [...folders, child]);
  });
}

/** The posed blocks of `station` with their blocks, wherever its plain
 *  folders hold them, in document order. */
export function posedEntries(station: TourStation): readonly PosedBlock[] {
  return walk(station.children, station, []);
}

/** The posed blocks of `station`, wherever its plain folders hold them:
 *  what the world shows of it, each with its pose and handles. */
export function posedBlocks(station: TourStation): readonly Placeable[] {
  return posedEntries(station).map((e) => e.place);
}

/** The pose of a folder with none: its holder's frame. */
const NO_POSE: TourLocalPose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
};

/** The plain folder ending `chain` (its holders, outermost first, then
 *  itself) of `station` as a placeable: its pivot is its origin, its dots
 *  its scale. */
function folderPlaceable(
  station: TourStation,
  chain: readonly TourFolder[],
): Placeable | null {
  const folder = chain.at(-1);
  if (folder === undefined) return null;
  const holders = chain.slice(0, -1);
  const local = folder.pose ?? NO_POSE;
  const inStation = composeTourFolderPath(holders, local);
  return {
    ref: { kind: "folder", id: folder.id },
    selection: `${FOLDER_PREFIX}${folder.id}`,
    stationId: station.id,
    folderPath: holders.map((f) => f.id),
    geo: itemGeoPose(inStation, station.geo),
    local,
    inStation,
    inheritedScale: composedTourFolderScale(holders),
    turns: CONTAINER_PLACEMENT.turns,
    lifts: CONTAINER_PLACEMENT.lifts,
    extent: extentOf(CONTAINER_PLACEMENT, { scale: folder.scale ?? 1 }),
    locked: false,
    members: walk(folder.children, station, chain).map((e) => e.block.id),
  };
}

/** The chain down to the plain folder `id` in `children` (below
 *  `above`), or null. */
function folderChainIn(
  children: readonly TourStationChild[],
  id: string,
  above: readonly TourFolder[],
): readonly TourFolder[] | null {
  for (const child of children) {
    if (!isTourFolder(child)) continue;
    const chain = [...above, child];
    if (child.id === id) return chain;
    const inner = folderChainIn(child.children, id, chain);
    if (inner !== null) return inner;
  }
  return null;
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
    inStation: null,
    inheritedScale: 1,
    turns: STATION_PLACEMENT.turns,
    lifts: STATION_PLACEMENT.lifts,
    extent: extentOf(STATION_PLACEMENT, station),
    locked: scope.stationLocked?.(station.id) === true,
    members: [],
  };
}

/** Every placeable of `tour`: each station, then its posed blocks. Its
 *  plain folders are placeables only by name (`placeableOf`): the world
 *  draws no mark of a folder to pick. */
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
 *  nothing placeable (a code, a card, a block or folder the tour lacks). */
export function placeableOf(
  tour: { readonly stations: readonly TourStation[] },
  selection: string,
  scope: PlaceScope = {},
): Placeable | null {
  if (selection.startsWith(STATION_PREFIX)) {
    const id = selection.slice(STATION_PREFIX.length);
    const station = tour.stations.find((s) => s.id === id);
    return station === undefined ? null : stationPlaceable(station, scope);
  }
  if (selection.startsWith(FOLDER_PREFIX)) {
    const id = selection.slice(FOLDER_PREFIX.length);
    for (const station of tour.stations) {
      const chain = folderChainIn(station.children, id, []);
      if (chain !== null) return folderPlaceable(station, chain);
    }
    return null;
  }
  for (const station of tour.stations) {
    const found = posedBlocks(station).find((p) => p.selection === selection);
    if (found !== undefined) return found;
  }
  return null;
}

/** The posed block `id` of `station` with its block; null for one the
 *  station does not hold in a posed view. */
export function posedEntryOf(
  station: TourStation,
  id: string,
): PosedBlock | null {
  return posedEntries(station).find((e) => e.block.id === id) ?? null;
}
