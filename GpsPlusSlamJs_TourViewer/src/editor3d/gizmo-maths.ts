/**
 * The gizmo's pure maths: where its parts lie for a selection, which part
 * the pointer is on, what a drag of each part sets, and the keys the scene
 * answers. No drawing and no DOM: `editor3d-gizmo.ts` draws the layout,
 * `editor3d-input.ts` feeds the pointer and the keys.
 *
 * The gizmo (the design's): a ring with four white dots (a station's found
 * radius, a model's size), a turn knob on a stalk along the heading, and a
 * move arrow lying on the ground in the middle. Its sizes are screen
 * pixels, turned into metres by the metres a pixel covers at the
 * selection (`metresPerPx`), so a handle stays grabbable at any zoom.
 *
 * World axes: x east, y up, z south (the 3D view's world at the tour's
 * centre); bearings in degrees clockwise from north.
 *
 * @see gizmo-maths.ts.md
 */

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

/** The bounds of a station's found radius and a model's size (m). */
const RADIUS_MIN_M = 2;
const RADIUS_MAX_M = 300;
const SIZE_MIN_M = 0.05;
const SIZE_MAX_M = 500;

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

/** What the gizmo is drawn for. */
export interface GizmoSubject {
  readonly kind: "station" | "item";
  /** The ground under the selection, in the world. */
  readonly centre: WorldPoint;
  /** Where it faces (degrees clockwise from north). */
  readonly headingDeg: number;
  /** A station's found radius (m); null for an item. */
  readonly radiusM: number | null;
  /** A placed model's size (m); null for anything else. */
  readonly sizeM: number | null;
  /** A station whose pose is locked: only its radius dots are handles. */
  readonly locked?: boolean;
}

/** Where the gizmo's parts lie (m, in the world). */
export interface GizmoLayout {
  readonly centre: WorldPoint;
  /** The move disc, the knob and its stalk are handles (false: a locked
   *  station, whose gizmo is its radius dots alone). */
  readonly posable: boolean;
  readonly headingDeg: number;
  /** The ring's radius (an item's); null for a station, whose own circle
   *  is drawn by the tour. */
  readonly ringM: number | null;
  /** The move arrow's disc radius. */
  readonly moveM: number;
  /** The four dots (a station, a model), else none. */
  readonly dots: readonly GroundSpot[];
  readonly knob: GroundSpot;
  /** The stalk from the ring to the knob. */
  readonly bar: {
    readonly fromM: number;
    readonly lengthM: number;
    readonly widthM: number;
  };
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
  const station = subject.kind === "station";
  const model = !station && subject.sizeM !== null;
  const radius = station
    ? (subject.radiusM ?? RADIUS_MIN_M)
    : Math.max(
        model
          ? GIZMO.modelRingPerSizeM * (subject.sizeM ?? 0)
          : GIZMO.itemRingMinM,
        GIZMO.itemRingPx * metresPerPx,
      );
  const moveM = station
    ? Math.max(GIZMO.stationMoveMinM, GIZMO.stationMovePx * metresPerPx)
    : radius;
  const heading = subject.headingDeg;
  const dots =
    station || model
      ? [0, 1, 2, 3].map((i) =>
          along(subject.centre, heading + 45 + i * 90, radius),
        )
      : [];
  const reach = radius + GIZMO.knobGapPx * metresPerPx;
  return {
    centre: subject.centre,
    posable: !(station && subject.locked === true),
    headingDeg: heading,
    ringM: station ? null : radius,
    moveM,
    dots,
    knob: along(subject.centre, heading, reach),
    bar: {
      fromM: radius,
      lengthM: reach - radius,
      widthM: Math.max(GIZMO.barMinM, GIZMO.barPx * metresPerPx),
    },
  };
}

/** A part of the gizmo a pointer can take: the middle (move), the knob
 *  (turn) or a dot (a station's radius, a model's size). */
export type GizmoHandle = "move" | "turn" | "dot";

/**
 * The handle under the pointer, by the design's order: the knob and the
 * dots first (whichever is nearest, within half its drawn size); then an
 * object under the pointer - the selected one moves, another one takes
 * no handle (a click there selects it); then the move disc. Null: the
 * pointer moves the camera. Not `posable` (a locked station): the dots
 * alone - the knob, the selection and the disc take no handle.
 */
export function handleAt(input: {
  readonly pointer: ScreenPoint;
  /** The knob's and the dots' centres on the screen (null: not shown). */
  readonly knob: ScreenPoint | null;
  readonly dots: readonly ScreenPoint[];
  /** The pointer's ray meets the move disc. */
  readonly onDisc: boolean;
  /** What object the pointer is over: the selected one, another, none. */
  readonly underPointer: "selected" | "other" | null;
  /** The middle and the knob are handles (default true). */
  readonly posable?: boolean;
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
  if (posable) consider(input.knob, GIZMO.knobPx, "turn");
  for (const dot of input.dots) consider(dot, GIZMO.dotPx, "dot");
  const found = best as { handle: GizmoHandle; d: number } | null;
  if (found !== null) return found.handle;
  if (!posable) return null;
  if (input.underPointer === "selected") return "move";
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

/** A station's found radius from a dot dragged `distanceM` from its
 *  centre: half metres, tenths with `fine` (Shift), within 2-300 m. */
export function draggedRadiusM(distanceM: number, fine: boolean): number {
  const r = fine
    ? Math.round(distanceM * 10) / 10
    : Math.round(distanceM * 2) / 2;
  return Math.min(RADIUS_MAX_M, Math.max(RADIUS_MIN_M, r));
}

/** `m` rounded to three significant digits. */
function threeDigits(m: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, m))) - 2);
  return Number((Math.round(m / p) * p).toPrecision(3));
}

/**
 * A model's size after a dot that started `startM` from its centre moved
 * to `distanceM`: `sizeM` scaled by the ratio, three digits, within the
 * format's 0.05-500 m.
 */
export function draggedSizeM(
  sizeM: number,
  startM: number,
  distanceM: number,
): number {
  const scaled = (sizeM * Math.max(distanceM, 1e-3)) / startM;
  return Math.min(SIZE_MAX_M, Math.max(SIZE_MIN_M, threeDigits(scaled)));
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
