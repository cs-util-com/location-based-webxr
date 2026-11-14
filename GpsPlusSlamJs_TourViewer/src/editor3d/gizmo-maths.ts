/**
 * The gizmo's pure maths: where its parts lie for a selection, which part
 * the pointer is on, what a drag of each part sets, and the keys the scene
 * answers. No drawing and no DOM: `editor3d-gizmo.ts` draws the layout,
 * `editor3d-input.ts` feeds the pointer and the keys.
 *
 * The gizmo (the design's): a ring with four white dots (a station's found
 * radius, a model's size: a placeable's extent), a turn knob on a stalk
 * along the heading (only on what turns), a bend knob behind the start
 * (only on what bends: a ground arrow), and a move arrow lying on the
 * ground in the middle. Its sizes are screen
 * pixels, turned into metres by the metres a pixel covers at the
 * selection (`metresPerPx`), so a handle stays grabbable at any zoom.
 *
 * World axes: x east, y up, z south (the 3D view's world at the tour's
 * centre); bearings in degrees clockwise from north.
 *
 * @see gizmo-maths.ts.md
 */
import type { LinearRing } from "../placement/placement-rows.js";

/**
 * How tall (m) the view of a vertical lens of `fovDeg` is at 1 m from the
 * camera: 2 tan(fov / 2). Over a view's height in px it gives the metres a
 * pixel covers at 1 m (a sprite's scale per px); a view's height over it
 * gives the focal length in px. The one copy of the lens arithmetic for the
 * 3D editor (PR bot finding 14, DEC-H3).
 */
export function viewHeightAtOneM(fovDeg: number): number {
  return 2 * Math.tan((fovDeg * Math.PI) / 360);
}

/** The gizmo's sizes (the design's). */
export const GIZMO = Object.freeze({
  /** The ring's inner edge, as a fraction of its radius. */
  ringInner: 0.88,
  /** An item's ring is at least this many pixels... */
  itemRingPx: 32,
  /** ...and at least this many metres. */
  itemRingMinM: 1.25,
  /** A model's ring per metre of its size (1.5 m round a 2.4 m model). */
  modelRingPerSizeM: 0.625,
  /** A station's move disc: at least this many pixels... */
  stationMovePx: 26,
  /** ...and at least this many metres. */
  stationMoveMinM: 2.2,
  /** A group's ring (a folder's): its members' reach, at least this
   *  many metres... */
  groupRingMinM: 0.6,
  /** ...plus this margin (m)... */
  groupRingMarginM: 0.2,
  /** ...and at least this many pixels. */
  groupRingPx: 34,
  /** A group's move disc at its pivot (px): small, so its members stay
   *  in view and grabbable round it. */
  groupMovePx: 26,
  /** A group's scale drag stays within these factors (the format reads
   *  0.1 to 10 from a file; the drag keeps to what is useful to aim). */
  groupScaleMin: 0.2,
  groupScaleMax: 5,
  /** The knob's stalk beyond the ring (px). */
  knobGapPx: 30,
  /** The knob's drawn size (px); half of it is its grip. */
  knobPx: 42,
  /** A dot's drawn size (px); half of it is its grip. */
  dotPx: 30,
  /** The stalk's width (px), and its least width (m). */
  barPx: 2,
  barMinM: 0.03,
  /** A handle under the pointer, or held, is drawn this much larger. */
  hoverScale: 1.15,
});

/** The steps of the keys (the design's). */
export const KEY_STEPS = Object.freeze({
  nudgeM: 0.1,
  nudgeShiftM: 1,
  turnDeg: 5,
  turnShiftDeg: 15,
  liftM: 0.1,
  liftShiftM: 1,
});

/** The bounds a dot's value is held in (its placement row's). */
export interface DotBounds {
  readonly min: number;
  readonly max: number;
}

/** A point in the world (m). */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A point on the ground plane (m: x east, z south). */
export interface GroundSpot {
  readonly x: number;
  readonly z: number;
}

/** A point on the screen (CSS px). */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** What the gizmo is drawn for: a placeable, as the gizmo reads it. */
export interface GizmoSubject {
  /** The ground under the selection, in the world. */
  readonly centre: WorldPoint;
  /** Where it faces (degrees clockwise from north). */
  readonly headingDeg: number;
  /** Turning it shows: a knob on a stalk; false: neither. */
  readonly turns: boolean;
  /** Its dots and their value; null: none. A reach (a station's found
   *  radius, m) has no ring of its own - the tour draws its circle - and
   *  a move disc in the middle; a size (m) sets the ring round it; a
   *  factor keeps an item's ring; a scale's ring is its `ring`, linear in
   *  it. */
  readonly extent:
    | { readonly kind: "size" | "reach" | "factor"; readonly value: number }
    | {
        readonly kind: "scale";
        readonly value: number;
        readonly ring: LinearRing;
      }
    | null;
  /** Its bend (degrees, clockwise) for what bends: a knob behind its
   *  start; absent: none. */
  readonly bendDeg?: number;
  /** Where it points, in the world, for what points (a sign or a ground
   *  arrow with a point): a handle there; absent: none. */
  readonly pointAt?: WorldPoint;
  /** Its pose is locked: only its dots are handles. */
  readonly locked: boolean;
  /** A group's (a folder's): how far its members reach from its pivot
   *  (m, `groupSpanM`). Present, the ring rings them, the move disc is a
   *  small one at the pivot and the members' bodies are grips; absent:
   *  one object's gizmo. */
  readonly spanM?: number;
}

/** An object's footprint on the ground (m, world x and z). */
export interface Footprint {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * How far a group's members reach from `centre` on the ground: the
 * farthest corner of their footprints (m); 0 for none. A footprint with
 * a bound that is not finite (an empty box: nothing drawn yet) counts
 * nothing.
 */
export function groupSpanM(
  centre: GroundSpot,
  footprints: readonly Footprint[],
): number {
  let span = 0;
  for (const f of footprints) {
    if (![f.minX, f.maxX, f.minZ, f.maxZ].every(Number.isFinite)) continue;
    const dx = Math.max(
      Math.abs(f.minX - centre.x),
      Math.abs(f.maxX - centre.x),
    );
    const dz = Math.max(
      Math.abs(f.minZ - centre.z),
      Math.abs(f.maxZ - centre.z),
    );
    span = Math.max(span, Math.hypot(dx, dz));
  }
  return span;
}

/** The dashed outline round a group: four corners on the ground, in
 *  order round it from its front left, and where its name tag stands. */
export interface GroupHull {
  readonly corners: readonly GroundSpot[];
  readonly tag: GroundSpot;
}

/**
 * The rectangle square to `headingDeg` (its front faces the heading)
 * round every corner of `footprints`, `padM` beyond the outermost on
 * each side; its tag at the front left corner. Null when no footprint is
 * a finite box (nothing drawn yet).
 */
export function groupHull(
  centre: GroundSpot,
  headingDeg: number,
  footprints: readonly Footprint[],
  padM: number,
): GroupHull | null {
  // The heading's own axes on the ground: forward, and right of it.
  const fx = Math.sin(headingDeg * RAD);
  const fz = -Math.cos(headingDeg * RAD);
  const rx = -fz;
  const rz = fx;
  let minR = Infinity;
  let maxR = -Infinity;
  let minF = Infinity;
  let maxF = -Infinity;
  for (const b of footprints) {
    if (![b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite)) continue;
    for (const x of [b.minX, b.maxX]) {
      for (const z of [b.minZ, b.maxZ]) {
        const dx = x - centre.x;
        const dz = z - centre.z;
        const r = dx * rx + dz * rz;
        const f = dx * fx + dz * fz;
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minF = Math.min(minF, f);
        maxF = Math.max(maxF, f);
      }
    }
  }
  if (minR > maxR) return null;
  const at = (r: number, f: number): GroundSpot => ({
    x: centre.x + r * rx + f * fx,
    z: centre.z + r * rz + f * fz,
  });
  const left = minR - padM;
  const right = maxR + padM;
  const front = maxF + padM;
  const back = minF - padM;
  const tag = at(left, front);
  return {
    corners: [tag, at(right, front), at(right, back), at(left, back)],
    tag,
  };
}

/** Where the gizmo's parts lie (m, in the world). */
export interface GizmoLayout {
  readonly centre: WorldPoint;
  /** The move disc, the knob and its stalk are handles (false: a locked
   *  placeable, whose gizmo is its dots alone). */
  readonly posable: boolean;
  readonly headingDeg: number;
  /** The ring's radius; null for a reach (a station), whose own circle
   *  is drawn by the tour. */
  readonly ringM: number | null;
  /** The move arrow's disc radius. */
  readonly moveM: number;
  /** A group's: its members' bodies move it, and its disc wins over what
   *  stands under it (`handleAt`'s `bodyGrips`). */
  readonly bodyGrips: boolean;
  /** The four dots (a placeable with an extent), else none. */
  readonly dots: readonly GroundSpot[];
  /** The turn knob; null for what does not turn. */
  readonly knob: GroundSpot | null;
  /** The bend knob, as far out as the turn knob, behind the start and
   *  swung clockwise by the bend (a tiller); null for what does not bend
   *  and a locked placeable. */
  readonly bendKnob: GroundSpot | null;
  /** The point handle, where the text points (in the world, its own
   *  height); null for what points nowhere and a locked placeable. */
  readonly pointKnob: WorldPoint | null;
  /** The stalk from the ring to the knob; null with the knob. */
  readonly bar: {
    readonly fromM: number;
    readonly lengthM: number;
    readonly widthM: number;
  } | null;
}

const RAD = Math.PI / 180;

/** `deg` in [0, 360). */
export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** The signed turn from bearing `a` to bearing `b`, in (-180, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  return ((((b - a + 540) % 360) + 360) % 360) - 180;
}

/** The bearing of `to` seen from `from` (degrees clockwise from north). */
export function compassDeg(from: GroundSpot, to: GroundSpot): number {
  return Math.atan2(to.x - from.x, -(to.z - from.z)) / RAD;
}

/** The spot `distanceM` from `centre` along bearing `deg`. */
function along(centre: GroundSpot, deg: number, distanceM: number): GroundSpot {
  return {
    x: centre.x + Math.sin(deg * RAD) * distanceM,
    z: centre.z - Math.cos(deg * RAD) * distanceM,
  };
}

/**
 * The gizmo's layout for `subject`, with `metresPerPx` the metres a
 * screen pixel covers at it. RangeError for a scale that is not finite
 * and > 0.
 */
export function gizmoLayout(
  subject: GizmoSubject,
  metresPerPx: number,
): GizmoLayout {
  if (!(Number.isFinite(metresPerPx) && metresPerPx > 0)) {
    throw new RangeError(
      `the metres a pixel covers must be finite and > 0, got ${metresPerPx}`,
    );
  }
  const { extent, spanM } = subject;
  const reaches = extent?.kind === "reach";
  const group = spanM !== undefined;
  const radius = reaches
    ? extent.value
    : group
      ? Math.max(
          Math.max(GIZMO.groupRingMinM, spanM) + GIZMO.groupRingMarginM,
          GIZMO.groupRingPx * metresPerPx,
        )
      : Math.max(
          extent?.kind === "size"
            ? GIZMO.modelRingPerSizeM * extent.value
            : extent?.kind === "scale"
              ? extent.ring.baseM + extent.ring.perM * extent.value
              : GIZMO.itemRingMinM,
          GIZMO.itemRingPx * metresPerPx,
        );
  const moveM = reaches
    ? Math.max(GIZMO.stationMoveMinM, GIZMO.stationMovePx * metresPerPx)
    : group
      ? GIZMO.groupMovePx * metresPerPx
      : radius;
  const heading = subject.headingDeg;
  const dots =
    extent === null
      ? []
      : [0, 1, 2, 3].map((i) =>
          along(subject.centre, heading + 45 + i * 90, radius),
        );
  const knobM = radius + GIZMO.knobGapPx * metresPerPx;
  return {
    centre: subject.centre,
    posable: !subject.locked,
    headingDeg: heading,
    ringM: reaches ? null : radius,
    moveM,
    bodyGrips: group,
    dots,
    knob: subject.turns ? along(subject.centre, heading, knobM) : null,
    bendKnob:
      subject.bendDeg === undefined || subject.locked
        ? null
        : along(subject.centre, heading + 180 + subject.bendDeg, knobM),
    pointKnob:
      subject.pointAt === undefined || subject.locked ? null : subject.pointAt,
    bar: subject.turns
      ? {
          fromM: radius,
          lengthM: knobM - radius,
          widthM: Math.max(GIZMO.barMinM, GIZMO.barPx * metresPerPx),
        }
      : null,
  };
}

/** A part of the gizmo a pointer can take: the middle (move), the knob
 *  (turn), a dot (a placeable's extent), the bend knob (bend) or the
 *  point handle (point). */
export type GizmoHandle = "move" | "turn" | "dot" | "bend" | "point";

/**
 * The handle under the pointer, by the design's order: the knob and the
 * dots first (whichever is nearest, within half its drawn size); then
 * another object under the pointer takes no handle (a click there selects
 * it); then the move disc, which moves even where the selected object's
 * own body covers it. The selected object's body off the disc is no
 * handle - a tap there selects, a drag turns the camera - so a large item
 * never takes a drag meant for the view. Null: the pointer moves the
 * camera. Not `posable` (a locked station): the dots
 * alone - the knob, the selection and the disc take no handle.
 *
 * With `bodyGrips` (a group's gizmo: a folder's), after the knob and the
 * dots the small disc at the pivot moves, over whatever stands under it
 * (it is drawn over the scene); then a member's body ("selected": the
 * caller counts the group's members as the selection) moves too, and
 * another object takes no handle.
 */
export function handleAt(input: {
  readonly pointer: ScreenPoint;
  /** The knob's and the dots' centres on the screen (null: not shown). */
  readonly knob: ScreenPoint | null;
  readonly dots: readonly ScreenPoint[];
  /** The bend knob's centre on the screen (null or absent: not shown). */
  readonly bendKnob?: ScreenPoint | null;
  /** The point handle's centre on the screen (null or absent: not
   *  shown). */
  readonly pointKnob?: ScreenPoint | null;
  /** The pointer's ray meets the move disc. */
  readonly onDisc: boolean;
  /** What object the pointer is over: the selected one, another, none. */
  readonly underPointer: "selected" | "other" | null;
  /** The middle and the knob are handles (default true). */
  readonly posable?: boolean;
  /** A group's gizmo: the disc first, then its members' bodies (default
   *  false). */
  readonly bodyGrips?: boolean;
}): GizmoHandle | null {
  const { pointer } = input;
  const posable = input.posable !== false;
  let best: { handle: GizmoHandle; d: number } | null = null;
  const consider = (
    at: ScreenPoint | null,
    sizePx: number,
    handle: GizmoHandle,
  ) => {
    if (at === null) return;
    const d = Math.hypot(at.x - pointer.x, at.y - pointer.y);
    if (d <= sizePx / 2 && (best === null || d < best.d)) best = { handle, d };
  };
  if (posable) {
    consider(input.knob, GIZMO.knobPx, "turn");
    consider(input.bendKnob ?? null, GIZMO.knobPx, "bend");
    consider(input.pointKnob ?? null, GIZMO.knobPx, "point");
  }
  for (const dot of input.dots) consider(dot, GIZMO.dotPx, "dot");
  const found = best as { handle: GizmoHandle; d: number } | null;
  if (found !== null) return found.handle;
  if (!posable) return null;
  if (input.bodyGrips === true) {
    if (input.onDisc || input.underPointer === "selected") return "move";
    return null;
  }
  if (input.underPointer === "other") return null;
  return input.onDisc ? "move" : null;
}

/**
 * The heading after the knob swept from bearing `fromDeg` to `toDeg`
 * (seen from the centre), starting at `headingDeg`: whole degrees, or
 * 15-degree steps with `snap` (Shift); in [0, 360).
 */
export function turnedHeadingDeg(
  headingDeg: number,
  fromDeg: number,
  toDeg: number,
  snap: boolean,
): number {
  const h = headingDeg + angleDiffDeg(fromDeg, toDeg);
  return norm360(snap ? Math.round(h / 15) * 15 : Math.round(h));
}

/** A reach (a station's found radius) from a dot dragged `distanceM`
 *  from its centre: half metres, tenths with `fine` (Shift), within
 *  `bounds` (its row's). */
export function draggedRadiusM(
  distanceM: number,
  fine: boolean,
  bounds: DotBounds,
): number {
  const r = fine
    ? Math.round(distanceM * 10) / 10
    : Math.round(distanceM * 2) / 2;
  return Math.min(bounds.max, Math.max(bounds.min, r));
}

/** A scale (a ground arrow's) from a dot dragged `distanceM` from its
 *  centre, on its linear `ring`: whole units, tenths with `fine`
 *  (Shift), within `bounds` (its row's). */
export function draggedScale(
  distanceM: number,
  fine: boolean,
  ring: LinearRing,
  bounds: DotBounds,
): number {
  const s = (distanceM - ring.baseM) / ring.perM;
  const stepped = fine ? Math.round(s * 10) / 10 : Math.round(s);
  return Math.min(bounds.max, Math.max(bounds.min, stepped));
}

/**
 * The bend after its knob swept from bearing `fromDeg` to `toDeg` (seen
 * from the start), starting at `bendDeg`: the knob follows the pointer,
 * so the bend grows by the sweep; whole degrees, or 5-degree steps with
 * `snap` (Shift); within +-`maxDeg`.
 */
export function bentDeg(
  bendDeg: number,
  fromDeg: number,
  toDeg: number,
  snap: boolean,
  maxDeg: number,
): number {
  const b = bendDeg + angleDiffDeg(fromDeg, toDeg);
  const stepped = snap ? Math.round(b / 5) * 5 : Math.round(b);
  return Math.min(maxDeg, Math.max(-maxDeg, stepped)) + 0;
}

/** `m` rounded to three significant digits. */
function threeDigits(m: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, m))) - 2);
  return Number((Math.round(m / p) * p).toPrecision(3));
}

/** The bounds a group's scale drag keeps to: `GIZMO`'s range within
 *  `format`'s, widened to `value` when the group is written beyond it
 *  (it keeps its factor until the drag takes it inward). */
export function groupScaleBounds(value: number, format: DotBounds): DotBounds {
  return {
    min: Math.max(format.min, Math.min(GIZMO.groupScaleMin, value)),
    max: Math.min(format.max, Math.max(GIZMO.groupScaleMax, value)),
  };
}

/**
 * A size (or a factor) after a dot that started `startM` from its centre
 * moved to `distanceM`: `sizeM` scaled by the ratio, three digits, within
 * `bounds` (its row's: a model's 0.05-500 m).
 */
export function draggedSizeM(
  sizeM: number,
  startM: number,
  distanceM: number,
  bounds: DotBounds,
): number {
  const scaled = (sizeM * Math.max(distanceM, 1e-3)) / startM;
  return Math.min(bounds.max, Math.max(bounds.min, threeDigits(scaled)));
}

/** A key the scene answers: a nudge (m east, north), a turn (degrees
 *  clockwise), a lift (m up), a delete, a duplicate. */
export type SceneKey =
  | { readonly kind: "nudge"; readonly eastM: number; readonly northM: number }
  | { readonly kind: "turn"; readonly deg: number }
  | { readonly kind: "lift"; readonly m: number }
  | { readonly kind: "delete" }
  | { readonly kind: "duplicate" };

/** What a key event says, as the scene reads it. */
export interface KeyPress {
  readonly code: string;
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/**
 * The scene's command for a key, or null for a key it leaves to others:
 * the shell answers T, F and Home, the page Esc, Ctrl+Z and Ctrl+Y.
 */
export function sceneKey(press: KeyPress): SceneKey | null {
  const command = press.ctrlKey || press.metaKey;
  if (command) {
    return press.code === "KeyD" ? { kind: "duplicate" } : null;
  }
  const shift = press.shiftKey;
  const turn = shift ? KEY_STEPS.turnShiftDeg : KEY_STEPS.turnDeg;
  const step = shift ? KEY_STEPS.nudgeShiftM : KEY_STEPS.nudgeM;
  const lift = shift ? KEY_STEPS.liftShiftM : KEY_STEPS.liftM;
  switch (press.code) {
    case "ArrowLeft":
      return press.altKey
        ? { kind: "turn", deg: -turn }
        : { kind: "nudge", eastM: -step, northM: 0 };
    case "ArrowRight":
      return press.altKey
        ? { kind: "turn", deg: turn }
        : { kind: "nudge", eastM: step, northM: 0 };
    case "ArrowUp":
      return { kind: "nudge", eastM: 0, northM: step };
    case "ArrowDown":
      return { kind: "nudge", eastM: 0, northM: -step };
    case "KeyQ":
      return { kind: "turn", deg: -turn };
    case "KeyE":
      return { kind: "turn", deg: turn };
    case "PageUp":
      return { kind: "lift", m: lift };
    case "PageDown":
      return { kind: "lift", m: -lift };
    case "Delete":
    case "Backspace":
      return { kind: "delete" };
    default:
      return null;
  }
}
