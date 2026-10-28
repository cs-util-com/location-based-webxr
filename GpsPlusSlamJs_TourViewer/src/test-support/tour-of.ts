/**
 * Test-only: tours built from the world view the Tour Viewer's tests were
 * written in (every object a free block of a station).
 *
 * `tourOf` gives each object a station of its own, anchored exactly where
 * the object stands and turned like north: the object's local pose is then
 * zero offset, and the world view reads back the object's own numbers
 * (no round trip through a station's frame), so a test about drafts,
 * saves or placement compares records exactly. A picture's image asset is
 * listed in the tour's assets, where the world view reads it back from.
 * Tests about the station frame itself build their stations by hand.
 *
 * Importing it activates the core's licence (a NullStorageBackend store,
 * as `main.ts` does at boot): every world view runs the licence-gated
 * geodesy, so a test of drafts or saves needs it too.
 */

import type {
  TourAsset,
  TourManifest,
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  localPoseOf,
  tourObjectBlock,
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
  return {
    id: stationIdOf(object.id),
    geo,
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    blocks: [tourObjectBlock(object, localPoseOf(object.geo, geo))],
    steps: [],
  };
}

/** The image assets `objects`' pictures carry, each once. */
function pictureAssets(objects: readonly TourObject[]): TourAsset[] {
  const byId = new Map<string, TourAsset>();
  for (const object of objects) {
    if (object.kind === "picture")
      byId.set(object.imageAsset.id, object.imageAsset);
  }
  return [...byId.values()];
}

/** A tour holding `objects`, one station each (in order), with `extra`
 *  fields (title, stations before them, assets, spots, ...); the pictures'
 *  image assets follow `extra`'s assets. */
export function tourOf(
  objects: readonly TourObject[],
  extra: Partial<TourManifest> = {},
): TourManifest {
  const listed = new Set((extra.assets ?? []).map((a) => a.id));
  return {
    version: 4,
    minor: 0,
    order: "fixed",
    ...extra,
    assets: [
      ...(extra.assets ?? []),
      ...pictureAssets(objects).filter((a) => !listed.has(a.id)),
    ],
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

/** An object's text: a pin's or a picture's caption, a model's title. */
export function captionOf(object: TourObject): string | undefined {
  return object.kind === "model" ? object.title : object.caption;
}

/** `object` with `text` as its caption (a pin's text), or its title for
 *  a model. */
export function withCaption(object: TourObject, text: string): TourObject {
  return object.kind === "model"
    ? { ...object, title: text }
    : { ...object, caption: text };
}
