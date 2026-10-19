/**
 * A version 3 tour's content as the Tour Viewer edits it (tour editor plan
 * 2026-10-17-1816, W3, D20, D21): the pages place, move and compare a
 * WORLD view - every pin and photo with its geo pose, as the framework's
 * `tourObjects` reads it - and write through this module, which puts every
 * object into a station at a local pose. A version 3 tour has no loose
 * pins.
 *
 * - An object nobody moved keeps its local pose VERBATIM (its world pose
 *   reads back as the very numbers it has): a save never nudges an item,
 *   which D17's rigid station moves rely on.
 * - A moved object stays in its station, re-expressed there
 *   (`localPoseOf`), however far it went: re-assigning an existing item is
 *   the editor's (M5b), never a side effect of a save.
 * - A new object, and the walk's recorded photos when the tour has no
 *   spots yet, are assigned by the automatic-station rule
 *   (`station-assign.ts`): the recorded photos first, in capture order
 *   (the walk came before the tour was edited), then the objects in the
 *   caller's order. A new station is anchored where its first element
 *   stands, turned like north, with no story. A station an object starts
 *   of its own is there for every recorded photo, but for the other
 *   objects only from its own object on.
 * - A station this write EMPTIED (it held items, it holds none) goes when
 *   nothing else keeps it: no title, no story steps, no recorded photo,
 *   and no other station routing to it. It existed for its elements
 *   (D20); left behind, the visitor's guide would still lead to it. An
 *   empty station the tour already had is left alone.
 *
 * Pure.
 *
 * @see tour-content.ts.md
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { TourContentFields } from "gps-plus-slam-app-framework/ar/tour-items";
import type {
  TourCapture,
  TourCaptureSpots,
  TourItem,
  TourManifest,
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  itemGeoPose,
  localPoseOf,
  tourCaptureGeos,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";

import { newObjectId } from "./content-placement.js";
import {
  assignToStations,
  STATION_RADIUS_M,
  type StationPoint,
  type StationSeat,
} from "./station-assign.js";

/**
 * How far out an automatic station starts guiding (m): twice R, so a
 * visitor is told of it before reaching its edge. PROVISIONAL, like R
 * itself: chosen, not measured.
 */
export const AUTO_STATION_ACTIVATE_M = 2 * STATION_RADIUS_M;

/** The walk's recorded photos in the world, before they are in stations:
 *  what the Finish's bake produces (`capture-bake.ts`) and what a viewer
 *  places. */
export interface CaptureSpotsInWorld {
  readonly fixes: number;
  readonly gpsAccuracyMedianM: number | null;
  readonly captures: readonly {
    readonly image: string;
    readonly geo: QrGeoPose;
    /** The station a baked spot is held by (`worldCaptureSpots`); absent
     *  for spots joined live, which the viewer assigns itself
     *  (`station-captures.ts`). */
    readonly station?: string;
  }[];
}

/** The tour's own recorded photos in the world, or undefined without. */
export function worldCaptureSpots(
  manifest: TourManifest,
): CaptureSpotsInWorld | undefined {
  const spots = manifest.captureSpots;
  if (spots === undefined) return undefined;
  return {
    fixes: spots.fixes,
    gpsAccuracyMedianM: spots.gpsAccuracyMedianM,
    captures: tourCaptureGeos(manifest).map(({ image, geo, station }) => ({
      image,
      geo,
      station,
    })),
  };
}

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
 * A new automatic station's frame (D20): anchored where its first element
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

function automaticStation(id: string, at: StationPoint): TourStation {
  return { ...automaticStationFrame(id, at), items: [] };
}

/**
 * `manifest` with `objects` as its pins and photos, each in a station,
 * and the recorded photos placed when the tour has none yet. Throws what
 * the rule throws: a RangeError for a radius that is not positive, an
 * Error for a new station id already taken.
 */
export function withTourContent(
  manifest: TourManifest,
  content: {
    /** Every pin and photo the tour is to carry, in order. */
    readonly objects: readonly TourObject[];
    /** The walk's recorded photos; used only when the tour has none. */
    readonly captureSpots?: CaptureSpotsInWorld;
    readonly newStationId?: () => string;
    readonly radiusM?: number;
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
  const bake =
    manifest.captureSpots === undefined ? content.captureSpots : undefined;
  const placedByRule: TourObject[] = [];
  for (const object of content.objects) {
    const stationId = object.station ?? stationOfItem.get(object.id);
    const station =
      stationId === undefined ? undefined : stationById.get(stationId);
    if (station === undefined) {
      // A new object, or one naming a station the tour lacks: the rule
      // places it, the latter in a station of that very id (an OWN
      // station), anchored where the first object naming it stands -
      // never merged into a neighbour, and in the objects' order like the
      // rule's own new stations. Two cases name one: an undo that brought
      // an object back after a save dropped its emptied station (the M5a
      // milestone review M2), and the phone's "New station here" (owner
      // decision D8 of the editor round-2 plan), which starts a station
      // even within R.
      placedByRule.push(object);
      continue;
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
  // Two passes of the rule. The recorded photos first, in capture order
  // (the walk came before the tour was edited), with the own stations
  // already seated where their objects stand, so a photo taken at an own
  // station's spot joins it rather than a neighbour or a duplicate. Then
  // the objects, in the caller's order, WITHOUT those seats: an own station
  // starts when its object comes, so an object placed before it is never
  // taken into it.
  const ownSeats = new Map<string, StationSeat>();
  for (const object of placedByRule) {
    const own = object.station;
    if (own !== undefined && !ownSeats.has(own)) {
      ownSeats.set(own, { id: own, anchor: object.geo });
    }
  }
  const rule = {
    newStationId: content.newStationId ?? (() => newObjectId()),
    ...(content.radiusM === undefined ? {} : { radiusM: content.radiusM }),
  };
  const captureElements = bake?.captures ?? [];
  const byPhotos = assignToStations({
    ...rule,
    stations: [
      ...manifest.stations.map((s) => ({ id: s.id, anchor: s.geo })),
      ...ownSeats.values(),
    ],
    elements: captureElements,
    positionOf: (c) => c.geo,
  });
  const assigned = assignToStations({
    ...rule,
    stations: byPhotos.stations.filter((seat) => !ownSeats.has(seat.id)),
    elements: placedByRule,
    positionOf: (o) => o.geo,
    ownStationOf: (o) => o.station,
  });
  const stations = new Map(stationById);
  for (const seat of assigned.stations) {
    if (!stations.has(seat.id)) {
      stations.set(seat.id, automaticStation(seat.id, seat.anchor));
      items.set(seat.id, []);
    }
  }
  const captures: TourCapture[] = captureElements.map((capture, i) => {
    const id = byPhotos.stationOf[i]!;
    return {
      image: capture.image,
      station: id,
      pose: localPoseOf(capture.geo, stations.get(id)!.geo),
    };
  });
  for (const [i, object] of placedByRule.entries()) {
    const id = assigned.stationOf[i]!;
    items.get(id)?.push({
      ...fieldsOf(object),
      pose: localPoseOf(object.geo, stations.get(id)!.geo),
    });
  }
  const spots: TourCaptureSpots | undefined =
    manifest.captureSpots ??
    (bake === undefined || captures.length === 0
      ? undefined
      : {
          fixes: bake.fixes,
          gpsAccuracyMedianM: bake.gpsAccuracyMedianM,
          captures,
        });
  const filled = assigned.stations.map((seat) => ({
    ...stations.get(seat.id)!,
    items: items.get(seat.id) ?? [],
  }));
  const kept = new Set([
    ...(spots?.captures ?? []).map((c) => c.station),
    ...filled.flatMap(routedTo),
  ]);
  const written: TourManifest = {
    ...manifest,
    stations: filled.filter(
      (s) => !emptiedAndBare(s, stationById.get(s.id), kept),
    ),
  };
  if (spots === undefined) return written;
  return { ...written, captureSpots: spots };
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
