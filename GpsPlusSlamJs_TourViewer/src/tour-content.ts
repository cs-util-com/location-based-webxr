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
 *   stands, turned like north, with no story.
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
  tourObjects,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";

import { newObjectId } from "./content-placement.js";
import { assignToStations, STATION_RADIUS_M } from "./station-assign.js";

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
    captures: tourCaptureGeos(manifest).map(({ image, geo }) => ({
      image,
      geo,
    })),
  };
}

/** The same geo pose, field by field (=== on numbers, so -0 is 0): an
 *  object nobody moved, compared with what its stored item reads as. */
export function sameGeoPose(a: QrGeoPose, b: QrGeoPose): boolean {
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

/** One element the rule assigns: a new object or a recorded photo. */
type Unplaced =
  | { readonly kind: "object"; readonly object: TourObject }
  | {
      readonly kind: "capture";
      readonly image: string;
      readonly geo: QrGeoPose;
    };

function automaticStation(id: string, at: QrGeoPose): TourStation {
  return {
    id,
    geo: { lat: at.lat, lon: at.lon, alt: at.alt, rotation: [0, 0, 0, 1] },
    activateRadiusM: AUTO_STATION_ACTIVATE_M,
    foundRadiusM: STATION_RADIUS_M,
    hint: "arrow",
    steps: [],
    items: [],
  };
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
  const unplaced: Unplaced[] = [];
  const bake =
    manifest.captureSpots === undefined ? content.captureSpots : undefined;
  for (const capture of bake?.captures ?? []) {
    unplaced.push({ kind: "capture", image: capture.image, geo: capture.geo });
  }
  for (const object of content.objects) {
    const stationId =
      object.station !== undefined && stationById.has(object.station)
        ? object.station
        : stationOfItem.get(object.id);
    const station =
      stationId === undefined ? undefined : stationById.get(stationId);
    if (station === undefined) {
      unplaced.push({ kind: "object", object });
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
  const assigned = assignToStations({
    stations: manifest.stations.map((s) => ({ id: s.id, anchor: s.geo })),
    elements: unplaced,
    positionOf: (e) => (e.kind === "object" ? e.object.geo : e.geo),
    newStationId: content.newStationId ?? (() => newObjectId()),
    ...(content.radiusM === undefined ? {} : { radiusM: content.radiusM }),
  });
  const stations = new Map(stationById);
  const captures: TourCapture[] = [];
  for (const [i, element] of unplaced.entries()) {
    const id = assigned.stationOf[i]!;
    let station = stations.get(id);
    if (station === undefined) {
      const at = element.kind === "object" ? element.object.geo : element.geo;
      station = automaticStation(id, at);
      stations.set(id, station);
      items.set(id, []);
    }
    if (element.kind === "capture") {
      captures.push({
        image: element.image,
        station: id,
        pose: localPoseOf(element.geo, station.geo),
      });
    } else {
      items.get(id)?.push({
        ...fieldsOf(element.object),
        pose: localPoseOf(element.object.geo, station.geo),
      });
    }
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
  const written: TourManifest = {
    ...manifest,
    stations: assigned.stations.map((seat) => ({
      ...stations.get(seat.id)!,
      items: items.get(seat.id) ?? [],
    })),
  };
  if (spots === undefined) return written;
  return { ...written, captureSpots: spots };
}

/** The tour's pins and photos in the world, in station order; none
 *  without a tour. */
export function tourObjectsOf(manifest: TourManifest | null): TourObject[] {
  return manifest === null ? [] : tourObjects(manifest);
}
