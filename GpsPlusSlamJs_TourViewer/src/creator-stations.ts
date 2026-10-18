/**
 * The creator's stations in AR (tour editor plan 2026-10-17-1816, W3 "AR
 * authoring", D20, D21): which station the creator stands in, the ground
 * ring of its radius, and the words for both.
 *
 * - **The stations are the next Finish's.** They are read from the page's
 *   working copy through the very function the Finish writes with
 *   (`withTourContent` over the hosted objects with this page's changes,
 *   `applyObjectChanges`), so a pin the HUD says "starts Station 3" is in
 *   Station 3 once written. Nothing is stored: no station exists in the
 *   working copy before the Finish writes it (the coming tour-document
 *   step decides where AR-made stations live).
 * - **The open station** is the nearest whose anchor is within R of where
 *   the next pin would land: the reticle's hit point while it is visible,
 *   else where the creator stands (M5c review #3; `station-assign.ts`
 *   `nearestStationWithin`, the rule the Finish assigns by). Leaving R closes it: the next element
 *   placed outside every station's R starts a new one there, inside one
 *   joins the nearest. "Place a pin" with no station open therefore
 *   creates a station holding it (D21).
 * - **Not covered:** the walk's recorded photos are placed by the FIRST
 *   Finish of a tour without photo spots, before the objects; the HUD
 *   cannot see them (they are baked at the Finish), so on that one Finish
 *   a pin may join a photo's station instead of the one named.
 *
 * @see creator-stations.ts.md
 */

import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { calcGpsCoords, type LatLong } from "gps-plus-slam-app-framework/core";
import { Vector3, type Object3D } from "three";

import { applyObjectChanges } from "./authoring-draft.js";
import { EYE_HEIGHT_M } from "./breadcrumbs.js";
import { objectPoseNue } from "./content-placement.js";
import {
  nearestStationWithin,
  STATION_RADIUS_M,
  type StationPoint,
} from "./station-assign.js";
import { createStationRing, type StationRing } from "./station-ring.js";
import { stationTitle } from "./station-run.js";
import { tourObjectsOf, withTourContent } from "./tour-content.js";

/** A station as the creator's HUD reads it. */
export interface ArStation {
  readonly id: string;
  /** Its anchor: where its first element stands (D20). */
  readonly anchor: StationPoint;
  /** Its title, or "Station N" by its place in the tour. */
  readonly name: string;
  /** Not in the tour file yet: this page's placements start it, and the
   *  next Finish writes it. */
  readonly started: boolean;
  /** Its pins' and photos' ids, in the order it holds them. */
  readonly itemIds: readonly string[];
}

/** The prefix of a station the next Finish would start: never a real id
 *  (the Finish mints its own), only how the HUD tells them apart. */
const UNWRITTEN_PREFIX = "unwritten-";

/**
 * The tour's stations as the next Finish would write them: the hosted
 * stations and the ones this page's placements start, each named. None
 * without a tour.
 */
export function stationsAsFinished(input: {
  readonly manifest: TourManifest | null;
  /** This page's new and changed objects, in the order they were made. */
  readonly placed: readonly TourObject[];
  readonly deleted: readonly string[];
  readonly radiusM?: number;
}): ArStation[] {
  const { manifest } = input;
  if (manifest === null) return [];
  const hosted = new Set(manifest.stations.map((s) => s.id));
  let next = 0;
  const written = withTourContent(manifest, {
    objects: applyObjectChanges(
      tourObjectsOf(manifest),
      input.placed,
      input.deleted,
    ),
    newStationId: () => {
      let id: string;
      do {
        next += 1;
        id = `${UNWRITTEN_PREFIX}${String(next)}`;
      } while (hosted.has(id));
      return id;
    },
    ...(input.radiusM === undefined ? {} : { radiusM: input.radiusM }),
  });
  return written.stations.map((station, index) => ({
    id: station.id,
    anchor: {
      lat: station.geo.lat,
      lon: station.geo.lon,
      alt: station.geo.alt,
    },
    name: stationTitle(station, index + 1),
    started: !hosted.has(station.id),
    itemIds: station.items.map((item) => item.id),
  }));
}

/** The station the creator stands in: the nearest whose anchor is within
 *  `radiusM` of `at` (the rule's own test), else null. */
export function openStationAt(
  stations: readonly ArStation[],
  at: { readonly lat: number; readonly lon: number },
  radiusM: number = STATION_RADIUS_M,
): ArStation | null {
  const id = nearestStationWithin(stations, at, radiusM);
  return stations.find((s) => s.id === id) ?? null;
}

/**
 * The HUD's line about stations, in plain words: the open one, the one
 * the creator just left, or none.
 */
export function stationChipText(
  open: ArStation | null,
  left: ArStation | null,
): string {
  if (open !== null) {
    return `In ${open.name} - what you place here joins it.`;
  }
  if (left !== null) {
    return `You left ${left.name} - what you place next starts a new station.`;
  }
  return "No station here - what you place next starts a new one.";
}

/** Where an object just placed went, for its placement note: "it starts
 *  Station 3" for the first element of a station the next Finish starts,
 *  else "in Station 2". Null when it is in none (no tour). */
export function placedInText(
  stations: readonly ArStation[],
  objectId: string,
): string | null {
  const station = stations.find((s) => s.itemIds.includes(objectId));
  if (station === undefined) return null;
  return station.started && station.itemIds[0] === objectId
    ? `it starts ${station.name}`
    : `in ${station.name}`;
}

/** A visible reticle's hit point in the scene's GPS-world NUE, else null.
 *  One scratch vector: read every frame. */
const reticleScratch = new Vector3();
export function reticleNueOf(
  reticle: {
    isVisible(): boolean;
    getWorldPosition(out: Vector3): Vector3;
  } | null,
): readonly [number, number, number] | null {
  if (reticle === null || !reticle.isVisible()) return null;
  const p = reticle.getWorldPosition(reticleScratch);
  if (![p.x, p.y, p.z].every(Number.isFinite)) return null;
  return [p.x, p.y, p.z];
}

export interface CreatorStationsDom {
  /** The line above the action strip. */
  readonly chip: Pick<HTMLElement, "textContent" | "hidden">;
}

export interface CreatorStations {
  /** Every camera frame of a creator's session: the line and the ring. */
  tick(): void;
  /** Where object `id` went, for its placement note (`placedInText`). */
  placedIn(id: string): string | null;
  /** The session ended: the line and the ring go. */
  endVisit(): void;
}

/** The working copy the stations are read from: the page's session. */
export interface CreatorStationsSource {
  readonly tourManifest: TourManifest | null;
  readonly placedObjects: readonly { readonly object: TourObject }[];
  readonly deletedObjectIds: readonly string[];
}

/** The same placed objects, entry by entry (by reference). */
function sameObjects(
  kept: readonly TourObject[],
  placed: readonly { readonly object: TourObject }[],
): boolean {
  return (
    kept.length === placed.length &&
    placed.every((entry, i) => entry.object === kept[i])
  );
}

export function wireCreatorStations(deps: {
  readonly ctx: CreatorStationsSource;
  readonly dom: CreatorStationsDom;
  /** The creator's camera in GPS-world NUE, or null (no alignment, no AR
   *  pose). */
  creatorNue(): readonly [number, number, number] | null;
  /** Where the next pin would land (the visible reticle's hit point,
   *  GPS-world NUE), or null: the open station is judged there, else at
   *  the creator (M5c review #3). Absent: always at the creator. */
  reticleNue?(): readonly [number, number, number] | null;
  zero(): LatLong | null;
  /** The scene root (GPS-world NUE), or null outside a session. */
  scene(): Object3D | null;
  readonly radiusM?: number;
}): CreatorStations {
  const radiusM = deps.radiusM ?? STATION_RADIUS_M;
  const ring: StationRing = createStationRing();
  /** The stations, kept until the working copy changes: the manifest, any
   *  placed object (an edit replaces the array, a placement grows it, the
   *  settle replaces entries in place - so each object is compared) or the
   *  deletions. Read every frame, so never recomputed per frame. */
  let memo: {
    manifest: TourManifest | null;
    objects: readonly TourObject[];
    deleted: readonly string[];
    stations: ArStation[];
  } | null = null;
  /** The station the creator was in at the last frame inside one. */
  let lastOpenId: string | null = null;

  function stations(): ArStation[] {
    const { ctx } = deps;
    if (
      memo !== null &&
      memo.manifest === ctx.tourManifest &&
      memo.deleted === ctx.deletedObjectIds &&
      sameObjects(memo.objects, ctx.placedObjects)
    ) {
      return memo.stations;
    }
    const objects = ctx.placedObjects.map((p) => p.object);
    const list = stationsAsFinished({
      manifest: ctx.tourManifest,
      placed: objects,
      deleted: ctx.deletedObjectIds,
      radiusM,
    });
    memo = {
      manifest: ctx.tourManifest,
      objects,
      deleted: ctx.deletedObjectIds,
      stations: list,
    };
    return list;
  }

  function show(text: string): void {
    const { chip } = deps.dom;
    if (chip.textContent !== text) chip.textContent = text;
    const hidden = text === "";
    if (chip.hidden !== hidden) chip.hidden = hidden;
  }

  return {
    tick() {
      const nue = deps.creatorNue();
      const zero = deps.zero();
      const scene = deps.scene();
      if (nue === null || zero === null || scene === null) {
        show("");
        ring.hide();
        return;
      }
      const list = stations();
      if (deps.ctx.tourManifest === null) {
        show("");
        ring.hide();
        return;
      }
      const judged = deps.reticleNue?.() ?? nue;
      const at = calcGpsCoords(zero, [judged[0], judged[1], judged[2]]);
      const open = openStationAt(list, at, radiusM);
      const left =
        open === null && lastOpenId !== null
          ? (list.find((s) => s.id === lastOpenId) ?? null)
          : null;
      if (open !== null) lastOpenId = open.id;
      show(stationChipText(open, left));
      if (open === null) {
        ring.hide();
        return;
      }
      const centre = objectPoseNue(
        { ...open.anchor, rotation: [0, 0, 0, 1] },
        zero,
      ).positionNue;
      ring.show(scene, [centre[0], nue[1] - EYE_HEIGHT_M, centre[2]], radiusM);
    },
    placedIn(id) {
      return placedInText(stations(), id);
    },
    endVisit() {
      show("");
      ring.hide();
      lastOpenId = null;
    },
  };
}
