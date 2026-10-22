/**
 * One drag of the gizmo, from the press to the release: what it shows
 * meanwhile (`preview`) and the one edit it writes (`edit`). Pure: the
 * scene hands it the world it needs (the ground under the pointer, the
 * level plane under it, the place of a spot and the ground's height
 * there) and draws the preview itself; nothing here dispatches, so a
 * drag's frames write nothing to the store.
 *
 * - **move** (the middle): the object follows the SAMPLED ground under
 *   the pointer (`groundUnder`, the globe's `groundHit`), offset by where
 *   it was grabbed, keeping its height above the ground (`placedGeo`);
 *   Shift snaps to half metres. A pointer over ground not loaded yet (a
 *   `not-loaded` miss, or no height at the new spot) waits and is tried
 *   again each frame (`retry`) until the ground arrives; any other miss
 *   (the sky, under the ground, out of reach) is dropped, and the last
 *   spot found stays.
 * - **turn** (the knob): the heading follows the pointer's bearing round
 *   the centre on the level plane, whole degrees (15 with Shift).
 * - **dot**: a station's found radius (half metres, tenths with Shift,
 *   2-300 m), or a model's size (scaled by the dot's distance against
 *   where it was grabbed, 0.05-500 m). Pins and photos have no dots.
 *
 * A hold of the keys (`startKeyGesture`) is one gesture too: its presses
 * nudge, turn or lift the pose reached so far, and its release writes one
 * edit.
 *
 * @see gesture.ts.md
 */
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import {
  compassDeg,
  draggedRadiusM,
  draggedSizeM,
  turnedHeadingDeg,
  type GizmoHandle,
  type SceneKey,
  type ScreenPoint,
  type WorldPoint,
} from "./gizmo-maths.js";
import {
  headingOfGeo,
  liftedGeo,
  nudgedGeo,
  placedGeo,
  turnedGeo,
  type Place,
} from "./pose-edits.js";

/** Why no ground was found under a pointer (the globe's reasons). */
type GroundMiss = "not-loaded" | "below-start" | "out-of-reach" | "above";

/** The ground under a pointer: a point in the world, or why none. */
export type GroundUnder =
  { readonly at: WorldPoint } | { readonly miss: GroundMiss };

/** What a gesture reads of the scene. */
export interface GestureWorld {
  /** The sampled ground under the pointer. */
  groundUnder(pointer: ScreenPoint): GroundUnder;
  /** Where the pointer's ray meets the level plane at height `y`, or null
   *  (a ray parallel to it, or pointing away). */
  planeUnder(pointer: ScreenPoint, y: number): WorldPoint | null;
  /** The place under a point of the world (degrees). */
  placeOf(at: WorldPoint): Place;
  /** The ground's ELLIPSOIDAL height at a place, or null where none has
   *  loaded. */
  groundAt(place: Place): number | null;
}

/** What a gesture edits: a station (its anchor and found radius) or an
 *  item (its pose, and a model's size), with the ground under it in the
 *  world (the gizmo's centre). */
export type GestureTarget =
  | {
      readonly kind: "station";
      readonly id: string;
      readonly geo: QrGeoPose;
      readonly foundRadiusM: number;
      readonly centre: WorldPoint;
    }
  | {
      readonly kind: "item";
      readonly id: string;
      readonly geo: QrGeoPose;
      /** A placed model's size (m); null for a pin or a photo. */
      readonly sizeM: number | null;
      readonly centre: WorldPoint;
    };

/** The one edit a gesture writes. */
export type GestureEdit =
  | { readonly kind: "item-pose"; readonly id: string; readonly geo: QrGeoPose }
  | {
      readonly kind: "station-pose";
      readonly id: string;
      readonly geo: QrGeoPose;
    }
  | {
      readonly kind: "radius";
      readonly id: string;
      readonly foundRadiusM: number;
    }
  | { readonly kind: "size"; readonly id: string; readonly sizeM: number };

/** What the scene shows while a gesture runs. */
export interface GesturePreview {
  readonly geo: QrGeoPose;
  /** A station's found radius; null for an item. */
  readonly foundRadiusM: number | null;
  /** A model's size; null for anything else. */
  readonly sizeM: number | null;
}

export interface Gesture {
  readonly handle: GizmoHandle;
  readonly target: GestureTarget;
  /** The pointer moved; `fine` is Shift (snap, or finer steps). */
  move(pointer: ScreenPoint, fine: boolean): void;
  /** Each frame: a pointer that waits for its ground, tried again. */
  retry(): void;
  /** A pointer waits for the ground under it to load. */
  waiting(): boolean;
  preview(): GesturePreview;
  /** The edit to write on release, or null when nothing changed. */
  edit(): GestureEdit | null;
}

/** The least distance a model's dot counts from its centre (m). */
const MIN_DOT_M = 0.2;

/** Whether two poses are the same pose, field by field. */
function sameGeo(a: QrGeoPose, b: QrGeoPose): boolean {
  return (
    a.lat === b.lat &&
    a.lon === b.lon &&
    a.alt === b.alt &&
    a.headingDeg === b.headingDeg &&
    (a.rotation ?? []).join() === (b.rotation ?? []).join()
  );
}

/** The ground under the pointer, else the level plane at `y`. */
function grabPoint(
  world: GestureWorld,
  pointer: ScreenPoint,
  y: number,
): WorldPoint | null {
  const under = world.groundUnder(pointer);
  return "at" in under ? under.at : world.planeUnder(pointer, y);
}

/**
 * A gesture of `handle` on `target`, grabbed at `pressedAt`; null when
 * there is nothing to grab there (neither ground nor the level plane
 * under the pointer) or the handle is not the target's (a dot on a pin or
 * a photo).
 */
export function startGesture(
  handle: GizmoHandle,
  target: GestureTarget,
  pressedAt: ScreenPoint,
  world: GestureWorld,
): Gesture | null {
  if (handle === "dot" && target.kind === "item" && target.sizeM === null) {
    return null;
  }
  const centre = target.centre;
  const grab =
    handle === "turn"
      ? world.planeUnder(pressedAt, centre.y)
      : grabPoint(world, pressedAt, centre.y);
  if (grab === null) return null;

  const start: GesturePreview = {
    geo: target.geo,
    foundRadiusM: target.kind === "station" ? target.foundRadiusM : null,
    sizeM: target.kind === "item" ? target.sizeM : null,
  };
  let now = start;
  let pending: { pointer: ScreenPoint; fine: boolean } | null = null;

  const offset = { x: centre.x - grab.x, z: centre.z - grab.z };
  const headingStart = headingOfGeo(target.geo);
  const bearingStart = compassDeg(centre, grab);
  const dotStart = Math.max(
    MIN_DOT_M,
    Math.hypot(grab.x - centre.x, grab.z - centre.z),
  );
  let groundBefore: number | null = null;

  /** One try of the move at `pointer`: false when its ground has not
   *  loaded (try again), true otherwise (applied, or dropped). */
  const tryMove = (pointer: ScreenPoint, fine: boolean): boolean => {
    const under = world.groundUnder(pointer);
    if (!("at" in under)) return under.miss !== "not-loaded";
    let x = under.at.x + offset.x;
    let z = under.at.z + offset.z;
    if (fine) {
      x = Math.round(x * 2) / 2;
      z = Math.round(z * 2) / 2;
    }
    const place = world.placeOf({ x, y: under.at.y, z });
    groundBefore ??= world.groundAt(target.geo);
    const groundAfter = world.groundAt(place);
    if (groundBefore === null || groundAfter === null) return false;
    now = {
      ...now,
      geo: placedGeo(target.geo, place, groundBefore, groundAfter),
    };
    return true;
  };

  const apply = (pointer: ScreenPoint, fine: boolean): boolean => {
    if (handle === "move") return tryMove(pointer, fine);
    if (handle === "turn") {
      const p = world.planeUnder(pointer, centre.y);
      if (p === null) return true;
      const heading = turnedHeadingDeg(
        headingStart,
        bearingStart,
        compassDeg(centre, p),
        fine,
      );
      now = { ...now, geo: turnedGeo(target.geo, heading - headingStart) };
      return true;
    }
    const p = grabPoint(world, pointer, centre.y);
    if (p === null) return true;
    const d = Math.hypot(p.x - centre.x, p.z - centre.z);
    if (target.kind === "station") {
      now = { ...now, foundRadiusM: draggedRadiusM(d, fine) };
    } else if (target.sizeM !== null) {
      now = { ...now, sizeM: draggedSizeM(target.sizeM, dotStart, d) };
    }
    return true;
  };

  return {
    handle,
    target,
    move(pointer, fine) {
      pending = apply(pointer, fine) ? null : { pointer, fine };
    },
    retry() {
      if (pending === null) return;
      if (apply(pending.pointer, pending.fine)) pending = null;
    },
    waiting: () => pending !== null,
    preview: () => now,
    edit() {
      if (handle === "dot") {
        if (target.kind === "station") {
          const r = now.foundRadiusM;
          return r === null || r === start.foundRadiusM
            ? null
            : { kind: "radius", id: target.id, foundRadiusM: r };
        }
        const s = now.sizeM;
        return s === null || s === start.sizeM
          ? null
          : { kind: "size", id: target.id, sizeM: s };
      }
      if (sameGeo(now.geo, start.geo)) return null;
      return target.kind === "station"
        ? { kind: "station-pose", id: target.id, geo: now.geo }
        : { kind: "item-pose", id: target.id, geo: now.geo };
    },
  };
}

/** A key that edits the pose: a nudge, a turn, a lift. */
type PoseKey = Extract<SceneKey, { kind: "nudge" | "turn" | "lift" }>;

/** One hold of the keys: what it shows meanwhile and the one edit it
 *  writes when they are let go. */
export interface KeyGesture {
  readonly target: GestureTarget;
  /** A press, or a repeat of a held key. */
  press(key: PoseKey): void;
  preview(): GesturePreview;
  /** The edit to write, or null when nothing changed. */
  edit(): GestureEdit | null;
}

/**
 * A hold of the keys on `target`: each press applied in turn to the pose
 * it reached - a nudge keeps the height above the ground (`nudgedGeo`, by
 * `world.groundAt`), a turn turns about up, a lift raises an item (a
 * station's height is the ground's: a lift leaves it).
 */
export function startKeyGesture(
  target: GestureTarget,
  world: Pick<GestureWorld, "groundAt">,
): KeyGesture {
  let geo = target.geo;
  return {
    target,
    press(key) {
      if (key.kind === "nudge") {
        geo = nudgedGeo(geo, key.eastM, key.northM, (p) => world.groundAt(p));
      } else if (key.kind === "turn") {
        geo = turnedGeo(geo, key.deg);
      } else if (target.kind === "item") {
        geo = liftedGeo(geo, key.m);
      }
    },
    preview: () => ({
      geo,
      foundRadiusM: target.kind === "station" ? target.foundRadiusM : null,
      sizeM: target.kind === "item" ? target.sizeM : null,
    }),
    edit() {
      if (sameGeo(geo, target.geo)) return null;
      return target.kind === "station"
        ? { kind: "station-pose", id: target.id, geo }
        : { kind: "item-pose", id: target.id, geo };
    },
  };
}
