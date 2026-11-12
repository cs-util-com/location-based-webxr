/**
 * One drag of the gizmo, from the press to the release: what it shows
 * meanwhile (`preview`) and the one edit it writes (`edit`). Pure: the
 * scene hands it the world it needs (the ground under the pointer, the
 * level plane under it, the place of a spot and the ground's height
 * there) and draws the preview itself; nothing here dispatches, so a
 * drag's frames write nothing to the store.
 *
 * A gesture reads a PLACEABLE (`../placement/placeables.ts`) and never
 * asks what kind of thing it is: whether it turns, lifts or has dots is
 * its row's (`../placement/placement-rows.ts`).
 *
 * - **move** (the middle): the object follows the SAMPLED ground under
 *   the pointer (`groundUnder`, the globe's `groundHit`), offset by where
 *   it was grabbed, keeping its height above the ground (`placedGeo`);
 *   Shift snaps to half metres. A pointer over ground not loaded yet (a
 *   `not-loaded` miss, or no height at the new spot) waits and is tried
 *   again each frame (`retry`) until the ground arrives; any other miss
 *   (the sky, under the ground, out of reach) is dropped, and the last
 *   spot found stays.
 * - **turn** (the knob, on a placeable that turns): the heading follows
 *   the pointer's bearing round the centre on the level plane, whole
 *   degrees (15 with Shift).
 * - **dot** (on a placeable with dots): a reach (a station's found radius:
 *   half metres, tenths with Shift), or a size or a factor (scaled by the
 *   dot's distance against where it was grabbed), within the bounds its
 *   row gives.
 *
 * A hold of the keys (`startKeyGesture`) is one gesture too: its presses
 * nudge, turn (what turns) or lift (what lifts) the pose reached so far,
 * and its release writes one edit.
 *
 * @see gesture.ts.md
 */
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import type { PlaceEdit } from "../placement/place-edits.js";
import type { Placeable } from "../placement/placeables.js";
import {
  compassDeg,
  draggedRadiusM,
  draggedSizeM,
  groupScaleBounds,
  turnedHeadingDeg,
  type GizmoHandle,
  type GizmoSubject,
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

/** What a gesture edits: a placeable's pose, handles and dots, with the
 *  ground under it in the world (the gizmo's centre). */
export type GestureTarget = Pick<
  Placeable,
  "ref" | "geo" | "turns" | "lifts" | "extent" | "locked"
> & {
  readonly centre: WorldPoint;
  /** A group's (a folder's) members: their bodies are its grips, and a
   *  click on one picks it alone; absent for one object. */
  readonly members?: readonly string[];
};

/** What the scene shows while a gesture runs. */
export interface GesturePreview {
  readonly geo: QrGeoPose;
  /** The dots' value; null for a placeable without dots. */
  readonly value: number | null;
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
  edit(): PlaceEdit | null;
}

/** The least distance a size's dot counts from its centre (m). */
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

/** `p` as a gesture's target, its gizmo at `centre` (the ground under
 *  a block, a station's own point), with every dot its row gives. */
export function gestureTargetOf(
  p: Placeable,
  centre: WorldPoint,
): GestureTarget {
  return {
    ref: p.ref,
    geo: p.geo,
    turns: p.turns,
    lifts: p.lifts,
    extent: p.extent,
    locked: p.locked,
    centre,
    ...(p.group ? { members: p.members } : {}),
  };
}

/** What the gizmo is drawn for: `target` as `now` shows it, at
 *  `centre`; a group's with its members' reach `spanM` (the scene
 *  measures it from their drawings). */
export function gizmoSubjectOf(
  target: GestureTarget,
  now: GesturePreview,
  centre: WorldPoint,
  spanM?: number,
): GizmoSubject {
  const { extent } = target;
  return {
    ...(target.members === undefined ? {} : { spanM: spanM ?? 0 }),
    centre,
    headingDeg: headingOfGeo(now.geo),
    turns: target.turns,
    extent:
      extent === null || now.value === null
        ? null
        : { kind: extent.kind, value: now.value },
    locked: target.locked,
  };
}

/** Whether `target`'s pose is locked (only its dots may be dragged). */
export function poseLocked(target: GestureTarget): boolean {
  return target.locked;
}

/** What `target` shows before any gesture moved it. */
function restingPreview(target: GestureTarget): GesturePreview {
  return { geo: target.geo, value: target.extent?.value ?? null };
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
 * under the pointer) or the handle is not the target's (a dot on a
 * placeable without dots, the knob on one that does not turn, the middle
 * or the knob of a locked one).
 */
export function startGesture(
  handle: GizmoHandle,
  target: GestureTarget,
  pressedAt: ScreenPoint,
  world: GestureWorld,
): Gesture | null {
  const { extent } = target;
  if (handle === "dot" && extent === null) return null;
  if (handle === "turn" && !target.turns) return null;
  if (handle !== "dot" && poseLocked(target)) return null;
  const centre = target.centre;
  const grab =
    handle === "turn"
      ? world.planeUnder(pressedAt, centre.y)
      : grabPoint(world, pressedAt, centre.y);
  if (grab === null) return null;

  const start = restingPreview(target);
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
    if (p === null || extent === null) return true;
    const d = Math.hypot(p.x - centre.x, p.z - centre.z);
    now = {
      ...now,
      value:
        extent.kind === "reach"
          ? draggedRadiusM(d, fine, extent)
          : draggedSizeM(
              extent.value,
              dotStart,
              d,
              // A group's scale drag keeps to the gizmo's narrower range.
              target.members !== undefined
                ? groupScaleBounds(extent.value, extent)
                : extent,
            ),
    };
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
        const value = now.value;
        return value === null || value === start.value
          ? null
          : { kind: "extent", ref: target.ref, value };
      }
      if (sameGeo(now.geo, start.geo)) return null;
      return { kind: "pose", ref: target.ref, geo: now.geo };
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
  edit(): PlaceEdit | null;
}

/**
 * A hold of the keys on `target`: each press applied in turn to the pose
 * it reached - a nudge keeps the height above the ground (`nudgedGeo`, by
 * `world.groundAt`), a turn turns about up what turns, a lift raises what
 * lifts (a station's height is the ground's: a lift leaves it).
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
        if (target.turns) geo = turnedGeo(geo, key.deg);
      } else if (target.lifts) {
        geo = liftedGeo(geo, key.m);
      }
    },
    preview: () => ({ ...restingPreview(target), geo }),
    edit() {
      if (sameGeo(geo, target.geo)) return null;
      return { kind: "pose", ref: target.ref, geo };
    },
  };
}
