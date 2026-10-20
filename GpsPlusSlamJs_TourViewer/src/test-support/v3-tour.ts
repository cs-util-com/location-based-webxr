/**
 * Test-only: version 3 tours (tour editor plan 2026-10-17-1816, W3) built
 * from the world view the Tour Viewer's tests were written in.
 *
 * `tourOf` gives each object a station of its own, anchored exactly where
 * the object stands and turned like north: the object's local pose is then
 * zero offset, and the world view reads back the object's own numbers
 * (no round trip through a station's frame), so a test about drafts,
 * saves or placement compares records exactly as before version 3. Tests
 * about the station frame itself build their stations by hand.
 *
 * Importing it activates the core's licence (a NullStorageBackend store,
 * as `main.ts` does at boot): every version 3 world view runs the
 * licence-gated geodesy, so a test of drafts or saves now needs it too.
 */

import type {
  TourManifest,
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  localPoseOf,
  tourObjects,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

/** The station `tourOf` gives an object of this id. */
export function stationIdOf(objectId: string): string {
  return `st-${objectId}`;
}

/** A station anchored exactly at `object`, holding it alone. */
function stationFor(object: TourObject): TourStation {
  const geo = {
    lat: object.geo.lat,
    lon: object.geo.lon,
    alt: object.geo.alt,
    rotation: [0, 0, 0, 1] as [number, number, number, number],
  };
  const { geo: _geo, station: _station, ...fields } = object;
  return {
    id: stationIdOf(object.id),
    geo,
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    items: [{ ...fields, pose: localPoseOf(object.geo, geo) }],
  };
}

/** A version 3 tour holding `objects`, one station each (in order), with
 *  `extra` fields (title, stations before them, spots, ...). */
export function tourOf(
  objects: readonly TourObject[],
  extra: Partial<TourManifest> = {},
): TourManifest {
  return {
    version: 3,
    minor: 0,
    order: "fixed",
    assets: [],
    ...extra,
    stations: [...(extra.stations ?? []), ...objects.map(stationFor)],
  };
}

/** `object` as `tourOf` stores it: in its own station. */
export function inOwnStation(object: TourObject): TourObject {
  return { ...object, station: stationIdOf(object.id) };
}

/** `manifest` with its world view as `objects`, for tests that read what
 *  a save wrote: read it, never hand it back to the code under test. */
export function withWorldObjects(
  manifest: TourManifest,
): TourManifest & { readonly objects: TourObject[] } {
  return { ...manifest, objects: tourObjects(manifest) };
}

/** `object` as a file holding it (`tourOf`) reads it back: the version a
 *  draft's base records as seen or written. */
export function asHosted(object: TourObject): TourObject {
  return tourObjects(tourOf([object]))[0]!;
}
