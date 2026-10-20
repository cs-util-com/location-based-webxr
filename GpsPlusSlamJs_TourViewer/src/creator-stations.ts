/**
 * The creator's stations in AR (tour editor plan 2026-10-17-1816, W3 "AR
 * authoring", D20, D21): which station the creator stands in, the ground
 * ring of its radius, and the words for both.
 *
 * - **The stations are the tour document's.** Every object belongs to a
 *   station from the moment it is placed (the document's station rule), so
 *   the HUD reads the stations as the next write carries them (the
 *   document's `manifestToWrite`): a pin the HUD says "starts Station 3"
 *   is in Station 3 already, under the id the file will carry. A station
 *   is "started" while the tour file does not carry it yet.
 * - **The open station** is the nearest whose OWN found radius holds where
 *   the next pin would land: the reticle's hit point while it is visible,
 *   else where the creator stands (M5c review #3; `station-assign.ts`
 *   `stationHolding`, the rule the document seats a placement by). The
 *   ring, of that station's radius, is drawn for the station the creator
 *   stands in, so it stays while they aim past its edge (PR #642 review).
 *   Leaving the radius closes it: the next element placed outside every
 *   station's radius starts a new one there, inside one joins the
 *   nearest. "Place a pin" with no station open therefore creates a
 *   station holding it (D21).
 * - **The walk's photos** are in their stations from the open on (the
 *   bake at open, `walkAtOpen`), so no Finish adds or renumbers a
 *   station: the names the HUD shows are the ones written, with no hedge.
 *
 * @see creator-stations.ts.md
 */

import { calcGpsCoords, type LatLong } from "gps-plus-slam-app-framework/core";
import { Vector3, type Object3D } from "three";

import { EYE_HEIGHT_M } from "./breadcrumbs.js";
import { objectPoseNue } from "./content-placement.js";
import { stationHolding, type StationPoint } from "./station-assign.js";
import { createStationRing, type StationRing } from "./station-ring.js";
import { stationTitle } from "./station-run.js";
import type { CreatorDocument } from "./creator-document.js";
import { manifestToWrite, type TourDocumentState } from "./tour-document.js";

/** A station as the creator's HUD reads it. */
export interface ArStation {
  readonly id: string;
  /** Its anchor: where its first element stands (D20). */
  readonly anchor: StationPoint;
  /** How far from its anchor it holds what is placed (m): its own. */
  readonly foundRadiusM: number;
  /** Its title, or "Station N" by its place in the tour. */
  readonly name: string;
  /** Not in the tour file yet: this page's placements started it, and the
   *  next write carries it. */
  readonly started: boolean;
  /** Its pins' and photos' ids, in the order it holds them. */
  readonly itemIds: readonly string[];
}

/**
 * The tour's stations as the next write carries them (`manifestToWrite`),
 * each named, and "started" while the tour file does not carry it. None
 * without a tour (`state` null).
 */
export function stationsAsFinished(input: {
  readonly state: TourDocumentState | null;
}): ArStation[] {
  const { state } = input;
  if (state === null) return [];
  const inFile = new Set((state.written?.stations ?? []).map((s) => s.id));
  const written = manifestToWrite(state);
  if (written === null) return [];
  return written.stations.map((station, index) => ({
    id: station.id,
    anchor: {
      lat: station.geo.lat,
      lon: station.geo.lon,
      alt: station.geo.alt,
    },
    foundRadiusM: station.foundRadiusM,
    name: stationTitle(station, index + 1),
    started: !inFile.has(station.id),
    itemIds: station.items.map((item) => item.id),
  }));
}

/** The station the creator stands in: the nearest whose own found radius
 *  holds `at` (the document's rule, `stationHolding`), else null. */
export function openStationAt(
  stations: readonly ArStation[],
  at: { readonly lat: number; readonly lon: number },
): ArStation | null {
  const id = stationHolding(
    stations.map((s) => ({
      id: s.id,
      geo: s.anchor,
      foundRadiusM: s.foundRadiusM,
    })),
    at,
  );
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
 *  Station 3" for the first element of a station the file does not carry yet,
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

/** The station the creator was last in, by its id: the document keeps a
 *  station's id from its first placement on, and the write carries it
 *  under that id. Null when it is gone (its last object deleted). */
function findLeft(
  stations: readonly ArStation[],
  id: string,
): ArStation | null {
  return stations.find((s) => s.id === id) ?? null;
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
  /** The name of the station object `id` is in ("Station 2"), or null:
   *  what a "New station here" placement's note names (D8). */
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
  zero(): LatLong | null;
  /** The scene root (GPS-world NUE), or null outside a session. */
  scene(): Object3D | null;
}): CreatorStations {
  const ring: StationRing = createStationRing();
  /** The stations, kept until the document's parts they are made of
   *  change (each replaced, never mutated, by the slice): read every
   *  frame, so never recomputed per frame. */
  let memo: {
    key: readonly unknown[];
    stations: ArStation[];
  } | null = null;
  /** The station the creator was in at the last frame inside one. */
  let lastOpen: string | null = null;

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
    const list = stationsAsFinished({ state });
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
      );
      const open =
        reticle === null
          ? standing
          : openStationAt(
              list,
              calcGpsCoords(zero, [reticle[0], reticle[1], reticle[2]]),
            );
      const left =
        open === null && lastOpen !== null ? findLeft(list, lastOpen) : null;
      if (open !== null) lastOpen = open.id;
      const line = stationChipText(
        open,
        left,
        deps.tour.state().newStationArmed,
      );
      show(line);
      if (standing === null) {
        ring.hide();
        return;
      }
      const centre = objectPoseNue(
        { ...standing.anchor, rotation: [0, 0, 0, 1] },
        zero,
      ).positionNue;
      ring.show(
        scene,
        [centre[0], nue[1] - EYE_HEIGHT_M, centre[2]],
        standing.foundRadiusM,
      );
    },
    placedIn(id) {
      return placedInText(stations(), id);
    },
    nameOf(id) {
      return stations().find((s) => s.itemIds.includes(id))?.name ?? null;
    },
    endVisit() {
      show("");
      ring.hide();
      lastOpen = null;
    },
  };
}
