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
 * - A station's blocks are written free blocks first (the objects, in
 *   their order), then its story blocks (in the station's order).
 * - An object nobody moved keeps its local pose VERBATIM (its world pose
 *   reads back as the very numbers it has): a save never nudges a block,
 *   which D17's rigid station moves rely on.
 * - A moved object is re-expressed in its station (`localPoseOf`).
 * - A CAPTURED PHOTO is a picture whose image asset has the picture's own
 *   id (`ownedAssetIds`): the asset is the picture's, listed exactly while
 *   the picture is, so a deleted photo takes its file with it and a cover
 *   or card image naming it goes (as a deleted photo's always did). Any
 *   other asset stays while something names it.
 * - The walk's camera captures are debug data, never in a station.
 * - A station this write EMPTIED (it held free blocks, it holds none) goes
 *   when nothing else keeps it: no title, no story steps, no description,
 *   no card image that still names a picture (`keepsItself`). It existed
 *   for its elements (D20); left behind, the visitor's guide would still
 *   lead to it. An empty station the tour already had is left alone.
 * - An asset nothing names any more is dropped (`withReferencedAssets`):
 *   no block (a picture's image, a video and its poster, a sound, a model,
 *   a character's image and voice), no station's card image and not the
 *   cover.
 *
 * Pure.
 *
 * @see tour-content.ts.md
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import { tourImageIds } from "gps-plus-slam-app-framework/ar/tour-details";
import type {
  TourAsset,
  TourBlock,
  TourManifest,
  TourObject,
  TourPicture,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  itemGeoPose,
  localPoseOf,
  tourFreeBlocks,
  tourObjectBlock,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { tourShownBlockIds } from "gps-plus-slam-app-framework/ar/tour-story";

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
 * its geo pose through the station's frame and back. A saved object and
 * the one placed differ by the micrometres of that round trip, so a page
 * comparing a placement with the saved file compares this (the authoring
 * draft's `hostedObjects`).
 */
export function asStored(
  object: TourObject,
  station: Pick<TourStation, "id" | "geo">,
): TourObject {
  return {
    ...object,
    station: station.id,
    geo: itemGeoPose(localPoseOf(object.geo, station.geo), station.geo),
  };
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
    blocks: [],
    steps: [],
  };
}

/** A station's STORY blocks: the ones a step of its story shows. */
export function storyBlocksOf(
  station: Pick<TourStation, "blocks" | "steps">,
): TourBlock[] {
  const shown = tourShownBlockIds(station.steps);
  return station.blocks.filter((b) => shown.has(b.id));
}

/** A block standing in the world: a short text drawn as a pin, a picture
 *  or a placed model, the only kinds a free block can be (its view is a
 *  world view, and only these kinds have one). */
export type WorldBlock = Extract<
  TourBlock,
  { readonly kind: TourObject["kind"] }
>;

/** A station's free blocks (`tourFreeBlocks`) as the blocks in the world
 *  they are; the filter only names the kinds a reader already settled. */
export function worldBlocks(
  station: Pick<TourStation, "blocks" | "steps">,
): WorldBlock[] {
  return tourFreeBlocks(station).filter(
    (b): b is WorldBlock =>
      b.kind === "shortText" || b.kind === "picture" || b.kind === "model",
  );
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
  readonly stations: readonly Pick<TourStation, "blocks" | "steps">[];
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
  const blockById = new Map<string, TourBlock>();
  for (const station of manifest.stations) {
    for (const block of tourFreeBlocks(station)) {
      stationOfBlock.set(block.id, station.id);
      blockById.set(block.id, block);
    }
  }
  const free = new Map<string, TourBlock[]>(
    manifest.stations.map((s) => [s.id, []]),
  );
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
    const old = blockById.get(object.id);
    const unmoved =
      old !== undefined &&
      stationOfBlock.get(object.id) === station.id &&
      sameGeoPose(object.geo, itemGeoPose(old.pose, station.geo));
    free
      .get(station.id)
      ?.push(
        tourObjectBlock(
          object,
          unmoved ? old.pose : localPoseOf(object.geo, station.geo),
        ),
      );
  }
  const filled = manifest.stations.map((station) => ({
    ...station,
    blocks: [...(free.get(station.id) ?? []), ...storyBlocksOf(station)],
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
    ...objects.flatMap(blockAssetIds),
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
 * a title, story steps, a non-blank description, or a card image naming
 * one of the tour's image assets (`imageAssets`). An image of the
 * station's own photo keeps nothing here: an emptied station holds no
 * photo, so the write drops that image (`station-image-gone`) and the
 * station is bare.
 */
export function keepsItself(
  station: Pick<TourStation, "title" | "steps" | "description" | "image">,
  imageAssets: ReadonlySet<string>,
): boolean {
  return (
    (station.title ?? "").trim() !== "" ||
    station.steps.length > 0 ||
    (station.description ?? "").trim() !== "" ||
    (station.image !== undefined && imageAssets.has(station.image))
  );
}

/** The assets `block` names: its media, a video's poster, a character's
 *  image and voice. A new kind fails to compile here until it says which
 *  assets it keeps. */
function blockAssetIds(block: TourBlock | TourObject): readonly string[] {
  switch (block.kind) {
    case "shortText":
    case "longText":
      return [];
    case "picture":
      return [block.image];
    case "video":
      return block.poster === undefined
        ? [block.video]
        : [block.video, block.poster];
    case "audio":
      return [block.audio];
    case "model":
      return [block.asset];
    case "character":
      return block.voice === undefined
        ? [block.image]
        : [block.image, block.voice];
  }
}

/** The assets a free block in its world view (an undo step's) keeps: a
 *  model its model file (a `.glb` is self-contained, the one asset it
 *  needs), a picture the tour's image it names, a pin none. A captured
 *  photo's own asset is none either: it is part of its picture (written
 *  while the picture is, `ownedAssetIds`), and the page holds its bytes
 *  for an undo that brings the picture back. */
export function objectAssetIds(object: TourObject): readonly string[] {
  if (isCapturedPhoto(object)) return [];
  return blockAssetIds(object);
}

/** The assets a station's story blocks name (a frame's: its free blocks
 *  are objects). */
export function stepAssetIds(
  station: Pick<TourStation, "blocks" | "steps">,
): readonly string[] {
  return storyBlocksOf(station).flatMap(blockAssetIds);
}

/**
 * The ids of the assets `manifest` uses: every block's of every station,
 * every station's card image and the cover (each of the last two names an
 * image asset).
 */
function referencedAssetIds(manifest: TourManifest): Set<string> {
  return new Set([
    ...manifest.stations.flatMap((station) => [
      ...station.blocks.flatMap(blockAssetIds),
      ...(station.image === undefined ? [] : [station.image]),
    ]),
    ...(manifest.cover === undefined ? [] : [manifest.cover]),
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
