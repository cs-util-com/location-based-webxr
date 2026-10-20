/**
 * A version 3 tour's content as the Tour Viewer edits it (tour editor plan
 * 2026-10-17-1816, W3, D20, D21): the pages place, move and compare a
 * WORLD view - every pin and photo with its geo pose, as the framework's
 * `tourObjects` reads it - and write through this module, which puts every
 * object into the station it names, at a local pose. A version 3 tour has
 * no loose pins.
 *
 * - Every object belongs to a station from the moment it is placed (the
 *   tour document's station rule): the writer assigns nothing and starts
 *   no station. It writes the stations as they are, in their order, each
 *   object in the one it names (or, naming none, the one the tour holds
 *   it in), and refuses an object in no station of the tour.
 * - An object nobody moved keeps its local pose VERBATIM (its world pose
 *   reads back as the very numbers it has): a save never nudges an item,
 *   which D17's rigid station moves rely on.
 * - A moved object is re-expressed in its station (`localPoseOf`).
 * - The walk's camera captures are debug data, never in a station (an
 *   earlier file's `captureSpots` is an unknown field to the framework's
 *   reader, which ignores it).
 * - A station this write EMPTIED (it held items, it holds none) goes when
 *   nothing else keeps it: no title, no story steps, and no other
 *   station routing to it. It existed for its elements
 *   (D20); left behind, the visitor's guide would still lead to it. An
 *   empty station the tour already had is left alone.
 * - An asset nothing names any more is dropped (`withReferencedAssets`):
 *   no step block (an image, a character's image or voice, an audio, a
 *   video, a model) and not the cover.
 *
 * Pure.
 *
 * @see tour-content.ts.md
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { TourContentFields } from "gps-plus-slam-app-framework/ar/tour-items";
import type {
  TourBlock,
  TourItem,
  TourManifest,
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  itemGeoPose,
  localPoseOf,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";

import { STATION_RADIUS_M, type StationPoint } from "./station-assign.js";

/**
 * How far out an automatic station starts guiding (m): twice R, so a
 * visitor is told of it before reaching its edge. PROVISIONAL, like R
 * itself: chosen, not measured.
 */
const AUTO_STATION_ACTIVATE_M = 2 * STATION_RADIUS_M;

/** The same geo pose, field by field (=== on numbers, so -0 is 0): an
 *  object nobody moved, compared with what its stored item reads as. */
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

/** An object's own fields: what an item keeps besides its pose. */
function fieldsOf(object: TourObject): TourContentFields {
  const { geo: _geo, station: _station, ...fields } = object;
  return fields;
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
): Omit<TourStation, "items"> {
  return {
    id,
    geo: { lat: at.lat, lon: at.lon, alt: at.alt, rotation: [0, 0, 0, 1] },
    activateRadiusM: AUTO_STATION_ACTIVATE_M,
    foundRadiusM: STATION_RADIUS_M,
    hint: "arrow",
    steps: [],
  };
}

/**
 * `manifest` with `objects` as its pins and photos, each in the station
 * it names (or, naming none, the one the manifest holds it in), the
 * stations kept as they are and in their order. Throws an Error naming
 * the object for one in no station of `manifest`: the tour document
 * seats every object, so one reaching here unseated is a broken document,
 * never a reason to start a station nobody was shown.
 */
export function withTourContent(
  manifest: TourManifest,
  content: {
    /** Every pin and photo the tour is to carry, in order. */
    readonly objects: readonly TourObject[];
  },
): TourManifest {
  const stationById = new Map(manifest.stations.map((s) => [s.id, s]));
  const stationOfItem = new Map<string, string>();
  const itemById = new Map<string, TourItem>();
  for (const station of manifest.stations) {
    for (const item of station.items) {
      stationOfItem.set(item.id, station.id);
      itemById.set(item.id, item);
    }
  }
  const items = new Map<string, TourItem[]>(
    manifest.stations.map((s) => [s.id, []]),
  );
  for (const object of content.objects) {
    const stationId = object.station ?? stationOfItem.get(object.id);
    const station =
      stationId === undefined ? undefined : stationById.get(stationId);
    if (station === undefined) {
      throw new Error(
        `The tour's object "${object.id}" is in no station of the tour${
          stationId === undefined ? "" : ` (it names "${stationId}")`
        }.`,
      );
    }
    const old = itemById.get(object.id);
    const unmoved =
      old !== undefined &&
      stationOfItem.get(object.id) === station.id &&
      sameGeoPose(object.geo, itemGeoPose(old.pose, station.geo));
    items.get(station.id)?.push({
      ...fieldsOf(object),
      pose: unmoved ? old.pose : localPoseOf(object.geo, station.geo),
    });
  }
  const filled = manifest.stations.map((station) => ({
    ...station,
    items: items.get(station.id) ?? [],
  }));
  const kept = new Set(filled.flatMap(routedTo));
  return {
    ...manifest,
    stations: filled.filter(
      (s) => !emptiedAndBare(s, stationById.get(s.id), kept),
    ),
  };
}

/** Whether this write emptied `station` (`before` held items) and
 *  nothing else keeps it: no title, no steps, not in `kept`. */
function emptiedAndBare(
  station: TourStation,
  before: TourStation | undefined,
  kept: ReadonlySet<string>,
): boolean {
  return (
    station.items.length === 0 &&
    (before?.items.length ?? 0) > 0 &&
    (station.title ?? "").trim() === "" &&
    station.steps.length === 0 &&
    !kept.has(station.id)
  );
}

/** The stations `station` routes to: its `next` and its quizzes' routes. */
export function routedTo(station: Omit<TourStation, "items">): string[] {
  const ids = station.next === undefined ? [] : [station.next];
  for (const { block } of station.steps) {
    if (block.kind !== "quiz" || block.route === undefined) continue;
    const { correct, wrong, byOption } = block.route;
    if (correct !== undefined) ids.push(correct);
    if (wrong !== undefined) ids.push(wrong);
    ids.push(...Object.values(byOption ?? {}));
  }
  return ids;
}

/** The assets `block` names: its media, a character's image and voice. */
function blockAssetIds(block: TourBlock): readonly string[] {
  switch (block.kind) {
    case "image":
    case "audio":
    case "video":
    case "model":
      return [block.asset];
    case "character":
      return block.voice === undefined
        ? [block.image]
        : [block.image, block.voice];
    case "text":
    case "choice":
    case "quiz":
      return [];
  }
}

/** The assets a pin, photo or model names, as a station's item or in its
 *  world view (an undo step's): none for a pin or a photo (a photo's image
 *  is its own content file, not an asset); a model its model file (a
 *  `.glb` is self-contained, the one asset it needs). A new kind fails to
 *  compile here until it says which assets it keeps. */
export function objectAssetIds(object: TourContentFields): readonly string[] {
  switch (object.kind) {
    case "pin":
    case "photo":
      return [];
    case "model":
      return [object.asset];
  }
}

/** The assets a station's steps name (a frame's: no items needed). */
export function stepAssetIds(
  station: Pick<TourStation, "steps">,
): readonly string[] {
  return station.steps.flatMap((step) => blockAssetIds(step.block));
}

/**
 * The ids of the assets `manifest` uses: every step block's of every
 * station, every item's, and the cover (which may name an image asset).
 */
function referencedAssetIds(manifest: TourManifest): Set<string> {
  return new Set([
    ...manifest.stations.flatMap((station) => [
      ...stepAssetIds(station),
      ...station.items.flatMap(objectAssetIds),
    ]),
    ...(manifest.cover === undefined ? [] : [manifest.cover]),
  ]);
}

/**
 * `manifest` without the assets nothing names (`referencedAssetIds`), in
 * their order: a visitor downloads every asset a tour lists, so one left
 * behind by a changed step or cover would ride along in every copy. The
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
