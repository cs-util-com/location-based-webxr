/**
 * A tour's content as the Tour Viewer edits it (tour editor plan
 * 2026-10-17-1816, W3, D20, D21): the pages place, move and compare a
 * WORLD view - every free block (a pin, a picture, a placed model) with
 * its geo pose, as the framework's `tourObjects` reads it - and write
 * through this module, which puts every object into the station it names,
 * as a free block at a local pose. A tour has no loose pins.
 *
 * - Every object belongs to a station from the moment it is placed (the
 *   tour document's station rule): the writer assigns nothing and starts
 *   no station. It writes the stations as they are, in their order, each
 *   object in the one it names (or, naming none, the one the tour holds
 *   it in), and refuses an object in no station of the tour.
 * - PLAIN FOLDERS are kept: an object names the folders holding it
 *   (`folder`, the framework's `tourObjects`), and is written into the
 *   innermost of them that its station still has, at a pose in that
 *   folder's frame; one whose folder is gone stands at the station's top.
 *   A folder's own pose and title are the station's (its frame's), and a
 *   folder stays when its last item leaves (a folder may be empty).
 * - At every level groups come first, then items: a station's children
 *   are its stories and plain folders (in the station's order), then its
 *   free blocks at the top (the objects, in their order); a folder's are
 *   its folders, then its blocks.
 * - An object nobody moved keeps its pose VERBATIM (its world pose reads
 *   back as the very numbers it has): a save never nudges a block, which
 *   the rigid moves of a station and of a folder rely on. Nobody moved it
 *   when it stands in the same station and folder, where its stored pose
 *   puts it.
 * - A moved object is re-expressed in its station (`localPoseOf`), then
 *   in its folders (`decomposeTourFolderPath`). So an item moved on its
 *   own changes only its own pose in its folder, never the folder's.
 * - A CAPTURED PHOTO is a picture whose image asset has the picture's own
 *   id (`ownedAssetIds`): the asset is the picture's, listed exactly while
 *   the picture is, so a deleted photo takes its file with it and a cover
 *   or card image naming it goes (as a deleted photo's always did). Any
 *   other asset stays while something names it.
 * - The walk's camera captures are debug data, never in a station.
 * - A station this write EMPTIED (it held free blocks, it holds none) goes
 *   when nothing else keeps it: no title, no story, no description,
 *   no card image that still names a picture (`keepsItself`). It existed
 *   for its elements (D20); left behind, the visitor's guide would still
 *   lead to it. An empty station the tour already had is left alone.
 * - An asset nothing names any more is dropped (`withReferencedAssets`):
 *   no block (a picture's image, a video and its poster, a sound, a model,
 *   a character's image and voice, a picture a long text's body shows),
 *   no station's card image and not the cover.
 *
 * Pure.
 *
 * @see tour-content.ts.md
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import { tourImageIds } from "gps-plus-slam-app-framework/ar/tour-details";
import { tourBlockAssetIds } from "gps-plus-slam-app-framework/ar/tour-kinds";
import type {
  TourAsset,
  TourBlock,
  TourManifest,
  TourObject,
  TourPicture,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  composeTourFolderPath,
  decomposeTourFolderPath,
} from "gps-plus-slam-app-framework/ar/tour-folder-pose";
import type { TourLocalPose } from "gps-plus-slam-app-framework/ar/tour-items";
import {
  itemGeoPose,
  localPoseOf,
  tourFreeBlocks,
  tourObjectBlock,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  isTourBlockChild,
  isTourFolder,
  tourStationBlocks,
  tourStationStoryBlocks,
  tourStories,
  type TourFolder,
  type TourFolderChild,
  type TourStationChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { STATION_RADIUS_M, type StationPoint } from "./station-assign.js";

/**
 * How far out an automatic station starts guiding (m): twice R, so a
 * visitor is told of it before reaching its edge. PROVISIONAL, like R
 * itself: chosen, not measured.
 */
const AUTO_STATION_ACTIVATE_M = 2 * STATION_RADIUS_M;

/** The same geo pose, field by field (=== on numbers, so -0 is 0): an
 *  object nobody moved, compared with what its stored block reads as. */
function sameGeoPose(a: QrGeoPose, b: QrGeoPose): boolean {
  return (
    a.lat === b.lat &&
    a.lon === b.lon &&
    a.alt === b.alt &&
    a.headingDeg === b.headingDeg &&
    (a.rotation === undefined
      ? b.rotation === undefined
      : b.rotation !== undefined &&
        a.rotation.every((v, i) => v === b.rotation?.[i]))
  );
}

/**
 * The object as `station` stores it and the world view reads it back:
 * its geo pose through the station's frame and the folders holding it
 * there (`withTourContent`'s rule) and back, naming those folders. A
 * saved object and the one placed differ by the micrometres of that round
 * trip, so a page comparing a placement with the saved file compares this
 * (the authoring draft's `hostedObjects`).
 */
export function asStored(
  object: TourObject,
  station: Pick<TourStation, "id" | "geo" | "children">,
): TourObject {
  const chain = folderChainOf(object, folderChains(station));
  const local = composeTourFolderPath(
    chain,
    decomposeTourFolderPath(chain, localPoseOf(object.geo, station.geo)),
  );
  const { folder: _folder, ...rest } = object;
  return {
    ...rest,
    station: station.id,
    ...(chain.length === 0 ? {} : { folder: chain.map((f) => f.id) }),
    geo: itemGeoPose(local, station.geo),
  };
}

/** Every plain folder of a station (or a frame) by id, as the chain of
 *  folders down to it: its holders, outermost first, then itself. */
export function folderChains(
  station: Pick<TourStation, "children">,
): Map<string, readonly TourFolder[]> {
  const chains = new Map<string, readonly TourFolder[]>();
  const walk = (
    children: readonly TourStationChild[],
    above: readonly TourFolder[],
  ): void => {
    for (const child of children) {
      if (!isTourFolder(child)) continue;
      const chain = [...above, child];
      chains.set(child.id, chain);
      walk(child.children, chain);
    }
  };
  walk(station.children, []);
  return chains;
}

/** The folders an object is written into: the chain down to the
 *  innermost folder it names, when `chains` (its station's) has it; none
 *  otherwise - a folder gone, or another station's - so it stands at the
 *  top. */
export function folderChainOf(
  object: TourObject,
  chains: ReadonlyMap<string, readonly TourFolder[]>,
): readonly TourFolder[] {
  const innermost = object.folder?.at(-1);
  return innermost === undefined ? [] : (chains.get(innermost) ?? []);
}

/** A plain folder as a frame holds it: its own fields and its plain
 *  folders, none of its blocks (they are objects, `tourObjects`). */
function folderSkeleton(folder: TourFolder): TourFolder {
  return {
    ...folder,
    children: folder.children.filter(isTourFolder).map(folderSkeleton),
  };
}

/** A station's stories and plain folders as its frame holds them
 *  (`folderSkeleton`), in its order: what is not an object. */
export function frameChildren(
  station: Pick<TourStation, "children">,
): TourStationChild[] {
  return station.children.flatMap((c): TourStationChild[] => {
    if (isTourBlockChild(c)) return [];
    return [isTourFolder(c) ? folderSkeleton(c) : c];
  });
}

/** A free block where its holder stores it: its own pose (in its
 *  innermost folder, or the station), that pose in the station, and its
 *  innermost folder (none at the top). */
interface HeldBlock {
  readonly block: TourBlock;
  readonly inStation: TourLocalPose;
  readonly folder: string | undefined;
}

function heldBlocks(
  children: readonly TourStationChild[],
  folders: readonly TourFolder[] = [],
): HeldBlock[] {
  return children.flatMap((child): HeldBlock[] => {
    if (isTourBlockChild(child)) {
      return [
        {
          block: child,
          inStation: composeTourFolderPath(folders, child.pose),
          folder: folders.at(-1)?.id,
        },
      ];
    }
    return isTourFolder(child)
      ? heldBlocks(child.children, [...folders, child])
      : [];
  });
}

/**
 * `skeleton`'s stories and plain folders (any blocks they hold left out)
 * with blocks put in: `top` after them, and each folder's `inFolder`
 * blocks after its own folders - groups first, then items, at every
 * level.
 */
function withBlocks(
  skeleton: readonly TourStationChild[],
  top: readonly TourBlock[],
  inFolder: ReadonlyMap<string, readonly TourBlock[]>,
): TourStationChild[] {
  const folderOf = (folder: TourFolder): TourFolder => ({
    ...folder,
    children: [
      ...folder.children.filter(isTourFolder).map(folderOf),
      ...(inFolder.get(folder.id) ?? []),
    ] as TourFolderChild[],
  });
  return [
    ...skeleton.flatMap((c): TourStationChild[] => {
      if (isTourBlockChild(c)) return [];
      return [isTourFolder(c) ? folderOf(c) : c];
    }),
    ...top,
  ];
}

/**
 * A frame's children with the free blocks `written` (the station as the
 * file holds it) carries: each block into the frame's folder that held it
 * in the file, at its pose there, so it follows that folder wherever the
 * frame puts it; one whose folder the frame no longer has stands at the
 * frame's top, where its folders put it in the file.
 */
export function withWrittenBlocks(
  frame: Pick<TourStation, "children">,
  written: Pick<TourStation, "children">,
): TourStationChild[] {
  const chains = folderChains(frame);
  const top: TourBlock[] = [];
  const inFolder = new Map<string, TourBlock[]>();
  for (const { block, inStation, folder } of heldBlocks(written.children)) {
    if (folder !== undefined && chains.has(folder)) {
      inFolder.set(folder, [...(inFolder.get(folder) ?? []), block]);
    } else {
      top.push({ ...block, pose: inStation });
    }
  }
  return withBlocks(frame.children, top, inFolder);
}

/**
 * A new automatic station's frame: anchored where its first element
 * stands, turned like north, found within R (`STATION_RADIUS_M`, 25 m) and
 * guiding from twice that (`AUTO_STATION_ACTIVATE_M`), with no story.
 */
export function automaticStationFrame(
  id: string,
  at: StationPoint,
): TourStation {
  return {
    id,
    geo: { lat: at.lat, lon: at.lon, alt: at.alt, rotation: [0, 0, 0, 1] },
    activateRadiusM: AUTO_STATION_ACTIVATE_M,
    foundRadiusM: STATION_RADIUS_M,
    hint: "arrow",
    children: [],
  };
}

/** A captured photo: a picture whose image asset has the picture's own id
 *  (`content/<id>.jpg`, minted with it), what a creator page takes with
 *  the camera. A picture naming another of the tour's images is not one. */
export function isCapturedPhoto(
  object: TourObject | TourBlock,
): object is TourPicture {
  return object.kind === "picture" && object.image === object.id;
}

/**
 * The ids of the assets that are a captured photo's own: an image asset
 * with the id of a free picture of the tour that names it. Such an asset
 * is part of its picture (written while the picture is, gone with it); a
 * cover or a station's card image naming it names the photo.
 */
export function ownedAssetIds(manifest: {
  readonly stations: readonly Pick<TourStation, "children">[];
}): ReadonlySet<string> {
  return new Set(
    manifest.stations.flatMap((station) =>
      tourFreeBlocks(station).flatMap((b) =>
        isCapturedPhoto(b) ? [b.id] : [],
      ),
    ),
  );
}

/**
 * `manifest` with `objects` as its free blocks, each in the station it
 * names (or, naming none, the one the manifest holds it in), the stations
 * kept as they are and in their order, and the captured photos' assets
 * (`ownedAssetIds`) those of `objects`. Throws an Error naming the object
 * for one in no station of `manifest`: the tour document seats every
 * object, so one reaching here unseated is a broken document, never a
 * reason to start a station nobody was shown.
 */
export function withTourContent(
  manifest: TourManifest,
  content: {
    /** Every free block the tour is to carry, in order. */
    readonly objects: readonly TourObject[];
  },
): TourManifest {
  const stationById = new Map(manifest.stations.map((s) => [s.id, s]));
  const stationOfBlock = new Map<string, string>();
  const heldById = new Map<string, HeldBlock>();
  const chainsOf = new Map<string, Map<string, readonly TourFolder[]>>();
  for (const station of manifest.stations) {
    chainsOf.set(station.id, folderChains(station));
    for (const held of heldBlocks(station.children)) {
      stationOfBlock.set(held.block.id, station.id);
      heldById.set(held.block.id, held);
    }
  }
  const free = new Map<string, TourBlock[]>(
    manifest.stations.map((s) => [s.id, []]),
  );
  // Folder ids are unique across the tour, so one map serves every station.
  const inFolder = new Map<string, TourBlock[]>();
  for (const object of content.objects) {
    const stationId = object.station ?? stationOfBlock.get(object.id);
    const station =
      stationId === undefined ? undefined : stationById.get(stationId);
    if (station === undefined) {
      throw new Error(
        `The tour's object "${object.id}" is in no station of the tour${
          stationId === undefined ? "" : ` (it names "${stationId}")`
        }.`,
      );
    }
    const chain = folderChainOf(object, chainsOf.get(station.id) ?? new Map());
    const folder = chain.at(-1)?.id;
    const old = heldById.get(object.id);
    const unmoved =
      old !== undefined &&
      stationOfBlock.get(object.id) === station.id &&
      old.folder === folder &&
      sameGeoPose(object.geo, itemGeoPose(old.inStation, station.geo));
    const block = tourObjectBlock(
      object,
      unmoved
        ? old.block.pose
        : decomposeTourFolderPath(chain, localPoseOf(object.geo, station.geo)),
    );
    if (folder === undefined) free.get(station.id)?.push(block);
    else inFolder.set(folder, [...(inFolder.get(folder) ?? []), block]);
  }
  const filled = manifest.stations.map((station) => ({
    ...station,
    children: withBlocks(
      station.children,
      free.get(station.id) ?? [],
      inFolder,
    ),
  }));
  const imageAssets = imageAssetIds(manifest);
  return {
    ...manifest,
    assets: withPictureAssets(manifest, content.objects),
    stations: filled.filter(
      (s) => !emptiedAndBare(s, stationById.get(s.id), imageAssets),
    ),
  };
}

/** `manifest`'s assets without the captured photos' own (`ownedAssetIds`)
 *  that nothing written names any more - no object of `objects`, no story
 *  block (another picture may show a photo's image, B2a review 2) - then
 *  the image assets of `objects`' pictures not listed yet, in their
 *  order. */
function withPictureAssets(
  manifest: TourManifest,
  objects: readonly TourObject[],
): TourAsset[] {
  const owned = ownedAssetIds(manifest);
  const named = new Set([
    ...objects.flatMap((b) => tourBlockAssetIds(b)),
    ...manifest.stations.flatMap(stepAssetIds),
  ]);
  const kept = manifest.assets.filter(
    (a) => !owned.has(a.id) || named.has(a.id),
  );
  const listed = new Set(kept.map((a) => a.id));
  const added: TourAsset[] = [];
  for (const object of objects) {
    if (object.kind !== "picture" || listed.has(object.imageAsset.id)) {
      continue;
    }
    listed.add(object.imageAsset.id);
    added.push(object.imageAsset);
  }
  return [...kept, ...added];
}

/** Whether this write emptied `station` (`before` held free blocks) and it
 *  keeps nothing of its own (`keepsItself`). */
function emptiedAndBare(
  station: TourStation,
  before: TourStation | undefined,
  imageAssets: ReadonlySet<string>,
): boolean {
  return (
    tourFreeBlocks(station).length === 0 &&
    (before === undefined ? 0 : tourFreeBlocks(before).length) > 0 &&
    !keepsItself(station, imageAssets)
  );
}

/** The ids of `manifest`'s image assets that are no captured photo's own
 *  (`ownedAssetIds`): what an EMPTY station's card image can still name
 *  (it holds no photo any more). */
export function imageAssetIds(
  manifest: Pick<TourManifest, "assets" | "stations">,
): ReadonlySet<string> {
  const owned = ownedAssetIds(manifest);
  return new Set(
    [...tourImageIds({ objects: [], assets: manifest.assets })].filter(
      (id) => !owned.has(id),
    ),
  );
}

/**
 * Whether an EMPTY station carries the creator's own work, which keeps it
 * when its last free block leaves:
 * a title, a story, a non-blank description, or a card image naming
 * one of the tour's image assets (`imageAssets`). An image of the
 * station's own photo keeps nothing here: an emptied station holds no
 * photo, so the write drops that image (`station-image-gone`) and the
 * station is bare.
 */
export function keepsItself(
  station: Pick<TourStation, "title" | "children" | "description" | "image">,
  imageAssets: ReadonlySet<string>,
): boolean {
  return (
    (station.title ?? "").trim() !== "" ||
    tourStories(station).length > 0 ||
    (station.description ?? "").trim() !== "" ||
    (station.image !== undefined && imageAssets.has(station.image))
  );
}

/** The assets a free block in its world view (an undo step's) keeps: a
 *  model its model file (a `.glb` is self-contained, the one asset it
 *  needs), a picture the tour's image it names, a pin none. A captured
 *  photo's own asset is none either: it is part of its picture (written
 *  while the picture is, `ownedAssetIds`), and the page holds its bytes
 *  for an undo that brings the picture back. */
export function objectAssetIds(object: TourObject): readonly string[] {
  if (isCapturedPhoto(object)) return [];
  return tourBlockAssetIds(object);
}

/** The assets a station's story blocks name (a frame's: its free blocks
 *  are objects). */
export function stepAssetIds(
  station: Pick<TourStation, "children">,
): readonly string[] {
  return tourStationStoryBlocks(station).flatMap((b) => tourBlockAssetIds(b));
}

/**
 * The assets of `station`'s story the format REQUIRES the tour to carry:
 * `stepAssetIds` without the pictures a long text's body names, which may
 * be missing (the visitor reads their alt text). What a restore checks a
 * drafted frame against, so a body naming a lost picture keeps its station.
 */
export function stepRequiredAssetIds(
  station: Pick<TourStation, "children">,
): readonly string[] {
  return tourStationStoryBlocks(station).flatMap((b) =>
    tourBlockAssetIds(b, true),
  );
}

/**
 * The ids of the assets `manifest` uses: every block's of every station,
 * every station's card image, the cover (each of the last two names an
 * image asset), and every declared character's image and frames sheet,
 * which the declaration names whether or not a block shows him.
 */
function referencedAssetIds(manifest: TourManifest): Set<string> {
  return new Set([
    ...manifest.stations.flatMap((station) => [
      ...tourStationBlocks(station).flatMap((b) => tourBlockAssetIds(b)),
      ...(station.image === undefined ? [] : [station.image]),
    ]),
    ...(manifest.cover === undefined ? [] : [manifest.cover]),
    ...(manifest.characters ?? []).flatMap((c) =>
      c.frames === undefined ? [c.image] : [c.image, c.frames],
    ),
  ]);
}

/**
 * `manifest` without the assets nothing names (`referencedAssetIds`), in
 * their order: a visitor downloads every asset a tour lists, so one left
 * behind by a changed block or cover would ride along in every copy. The
 * same manifest when every asset is in use. The caller removes the dropped
 * assets' files (`rebuildFinishedTour`). `alsoKeep`: ids another view of
 * the tour still names (an undo or redo step, `historyAssetIds`), kept
 * though `manifest` does not, so that step finds them after the write.
 */
export function withReferencedAssets(
  manifest: TourManifest,
  alsoKeep: ReadonlySet<string> = new Set(),
): TourManifest {
  const used = referencedAssetIds(manifest);
  const assets = manifest.assets.filter(
    (a) => used.has(a.id) || alsoKeep.has(a.id),
  );
  return assets.length === manifest.assets.length
    ? manifest
    : { ...manifest, assets };
}
