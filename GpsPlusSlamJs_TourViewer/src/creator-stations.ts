/**
 * The creator's stations in AR (tour editor plan 2026-10-17-1816, W3 "AR
 * authoring", D20, D21): which station the creator stands in, the ground
 * ring of its radius, and the words for both.
 *
 * - **The stations are the next Finish's.** They are read from the page's
 *   tour document through the very rule the Finish writes with (the
 *   document's `manifestToWrite`), so a pin the HUD says "starts Station
 *   3" is in Station 3 once written. Nothing is stored: no station exists
 *   in the document before the Finish writes it.
 * - **The open station** is the nearest whose anchor is within R of where
 *   the next pin would land: the reticle's hit point while it is visible,
 *   else where the creator stands (M5c review #3; `station-assign.ts`
 *   `nearestStationWithin`, the rule the Finish assigns by). The ring is
 *   drawn for the station the creator stands in, so it stays while they
 *   aim past its edge (PR #642 review). Leaving R closes it: the next element
 *   placed outside every station's R starts a new one there, inside one
 *   joins the nearest. "Place a pin" with no station open therefore
 *   creates a station holding it (D21).
 * - **The walk's photos:** the FIRST Finish of a tour with a recording and
 *   no photo spots places the recorded photos before the objects; the HUD
 *   cannot see them (they are baked at the Finish), so until then it names
 *   the stations with a hedge (`walkPhotosPending`, M5c review #2, PR
 *   #642 review).
 *
 * @see creator-stations.ts.md
 */

import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { calcGpsCoords, type LatLong } from "gps-plus-slam-app-framework/core";
import { Vector3, type Object3D } from "three";

import { EYE_HEIGHT_M } from "./breadcrumbs.js";
import { objectPoseNue } from "./content-placement.js";
import {
  nearestStationWithin,
  STATION_RADIUS_M,
  type StationPoint,
} from "./station-assign.js";
import { createStationRing, type StationRing } from "./station-ring.js";
import { stationTitle } from "./station-run.js";
import type { CreatorDocument } from "./creator-document.js";
import { manifestToWrite, type TourDocumentState } from "./tour-document.js";

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
 * The tour's stations as the next Finish would write them
 * (`manifestToWrite`): the written stations and the ones this page's
 * placements start, each named. None without a tour (`state` null).
 */
export function stationsAsFinished(input: {
  readonly state: TourDocumentState | null;
  readonly radiusM?: number;
}): ArStation[] {
  const { state } = input;
  if (state === null) return [];
  const hosted = new Set(state.stations.map((s) => s.id));
  let next = 0;
  const written = manifestToWrite(state, undefined, {
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
  if (written === null) return [];
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
 * the creator just left, or none - or, while "New station here" is armed
 * (owner decision D8), that the next item starts a station of its own.
 */
export function stationChipText(
  open: ArStation | null,
  left: ArStation | null,
  newStationArmed = false,
): string {
  if (newStationArmed) {
    return "What you place next starts a new station here.";
  }
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

/** Why the names may change, while the walk's recorded photos may still
 *  be sorted in (M5c review #2, PR #642 review). */
const HEDGE = "may change at Finish, when the walk's photos are sorted in";

/** The hedge the station line ends with while the walk is pending. */
export const WALK_HEDGE = `${HEDGE[0]!.toUpperCase()}${HEDGE.slice(1)}.`;

/**
 * Whether a Finish may still sort the walk's recorded photos in: the tour
 * carries a recording and no baked photo spots (`withTourContent` places
 * them BEFORE the objects, `finish-rebuild.ts`), and no Finish of this
 * open tour in this page has decided about the walk yet (`decidedFor`,
 * the page's `walkDecidedFor`). The HUD cannot see the photos, so its
 * station names and numbers may change: it hedges them.
 *
 * A declined bake writes no spots, and the file has no way to say it
 * declined, so a tour reopened after one reads as pending again - the
 * hedge comes back, the names stay. Conservative: a recording that took
 * no photos also reads as pending until a Finish in this page.
 */
export function walkPhotosPending<S extends { readonly hasRecording: boolean }>(
  session: S | null,
  manifest: TourManifest | null,
  decidedFor: S | null = null,
): boolean {
  return (
    session !== null &&
    session !== decidedFor &&
    session.hasRecording &&
    manifest !== null &&
    manifest.captureSpots === undefined
  );
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

/** How the HUD remembers the station the creator was last in: a written
 *  station by its id; one the next Finish starts by its first element,
 *  since its order-numbered id shifts when an earlier one is deleted and
 *  the Finish mints a real one (M5c review #4). */
type StationMark = { readonly id: string } | { readonly firstItemId: string };

function markOf(station: ArStation): StationMark {
  const first = station.itemIds[0];
  return station.started && first !== undefined
    ? { firstItemId: first }
    : { id: station.id };
}

function findMarked(
  stations: readonly ArStation[],
  mark: StationMark,
): ArStation | null {
  const found =
    "id" in mark
      ? stations.find((s) => s.id === mark.id)
      : stations.find((s) => s.itemIds[0] === mark.firstItemId);
  return found ?? null;
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
  /** The name of the station object `id` is in ("Station 2", hedged
   *  while the walk's photos are pending), or null: what a "New station
   *  here" placement's note names (D8). */
  nameOf(id: string): string | null;
  /** The session ended: the line and the ring go. */
  endVisit(): void;
}

/** The working copy the stations are read from: the page's tour
 *  document (`creator-document.ts`; `manifest()` null is no tour). */
type CreatorStationsSource = Pick<CreatorDocument, "manifest" | "state">;

export function wireCreatorStations(deps: {
  readonly tour: CreatorStationsSource;
  readonly dom: CreatorStationsDom;
  /** The creator's camera in GPS-world NUE, or null (no alignment, no AR
   *  pose). */
  creatorNue(): readonly [number, number, number] | null;
  /** Where the next pin would land (the visible reticle's hit point,
   *  GPS-world NUE), or null: the open station the line names is judged
   *  there, else at the creator (M5c review #3); the ring always at the
   *  creator (PR #642 review). Absent: always at the creator. */
  reticleNue?(): readonly [number, number, number] | null;
  /** The walk's photos may still be sorted in (`walkPhotosPending`): the
   *  line and a placement's note name the station with a hedge. Absent:
   *  never. */
  walkPhotosPending?(): boolean;
  zero(): LatLong | null;
  /** The scene root (GPS-world NUE), or null outside a session. */
  scene(): Object3D | null;
  readonly radiusM?: number;
}): CreatorStations {
  const radiusM = deps.radiusM ?? STATION_RADIUS_M;
  const ring: StationRing = createStationRing();
  /** The stations, kept until the document's parts they are made of
   *  change (each replaced, never mutated, by the slice): read every
   *  frame, so never recomputed per frame. */
  let memo: {
    key: readonly unknown[];
    stations: ArStation[];
  } | null = null;
  /** The station the creator was in at the last frame inside one. */
  let lastOpen: StationMark | null = null;

  function stations(): ArStation[] {
    const { tour } = deps;
    const state = tour.manifest() === null ? null : tour.state();
    const key =
      state === null
        ? [null]
        : [state.written, state.stations, state.placed, state.deleted];
    if (
      memo !== null &&
      memo.key.length === key.length &&
      memo.key.every((k, i) => k === key[i])
    ) {
      return memo.stations;
    }
    const list = stationsAsFinished({ state, radiusM });
    memo = { key, stations: list };
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
      if (deps.tour.manifest() === null) {
        show("");
        ring.hide();
        return;
      }
      // The words are judged where the next pin lands; the ring at the
      // creator's own spot, so it stays while they aim past its edge to
      // probe it (PR #642 review).
      const reticle = deps.reticleNue?.() ?? null;
      const standing = openStationAt(
        list,
        calcGpsCoords(zero, [nue[0], nue[1], nue[2]]),
        radiusM,
      );
      const open =
        reticle === null
          ? standing
          : openStationAt(
              list,
              calcGpsCoords(zero, [reticle[0], reticle[1], reticle[2]]),
              radiusM,
            );
      const left =
        open === null && lastOpen !== null ? findMarked(list, lastOpen) : null;
      if (open !== null) lastOpen = markOf(open);
      const line = stationChipText(
        open,
        left,
        deps.tour.state().newStationArmed,
      );
      show(
        deps.walkPhotosPending?.() === true ? `${line} ${WALK_HEDGE}` : line,
      );
      if (standing === null) {
        ring.hide();
        return;
      }
      const centre = objectPoseNue(
        { ...standing.anchor, rotation: [0, 0, 0, 1] },
        zero,
      ).positionNue;
      ring.show(scene, [centre[0], nue[1] - EYE_HEIGHT_M, centre[2]], radiusM);
    },
    placedIn(id) {
      const where = placedInText(stations(), id);
      return where !== null && deps.walkPhotosPending?.() === true
        ? `${where} (${HEDGE})`
        : where;
    },
    nameOf(id) {
      const station = stations().find((s) => s.itemIds.includes(id));
      if (station === undefined) return null;
      return deps.walkPhotosPending?.() === true
        ? `${station.name} (${HEDGE})`
        : station.name;
    },
    endVisit() {
      show("");
      ring.hide();
      lastOpen = null;
    },
  };
}
