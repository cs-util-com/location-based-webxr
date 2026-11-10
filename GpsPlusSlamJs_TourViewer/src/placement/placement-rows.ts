/**
 * What placing means for each thing the 3D editor can place: per block
 * kind AND per view (a block may stand in the world in one view and be a
 * card in another), and one row for a plain folder and one for a station.
 * Four facts per row: whether the drawing reads the pose (`posed`),
 * whether turning it shows (`turns`), whether its height is its own
 * (`lifts`), and what its size dots change (`extent`, none: no dots).
 *
 * The block table `satisfies` the format's list of views
 * (`TOUR_KINDS[kind].views`), so a view joining the format is a compile
 * error here until it is given a row on purpose; the contract test
 * (`placement.contract.test.ts`) holds each row to the editor's drawing.
 *
 * @see placement-rows.ts.md
 */
import {
  TOUR_MODEL_MAX_SIZE_M,
  TOUR_MODEL_MIN_SIZE_M,
  TOUR_PICTURE_MAX_WIDTH_M,
  TOUR_PICTURE_MIN_WIDTH_M,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import type {
  TOUR_KINDS,
  TourBlockKind,
} from "gps-plus-slam-app-framework/ar/tour-kinds";

/**
 * What a placeable's dots change. Three meanings, kept apart:
 * - `size`: a real size of the drawing, which scales uniformly with it
 *   (a model's largest side, a picture's width); a dot drag scales it by
 *   the dot's distance against where it was grabbed.
 * - `reach`: a distance from the centre that is no scale of the drawing
 *   (a station's found radius); a dot drag sets it to the dot's distance.
 * - `factor`: a uniform factor on a whole frame (a plain folder): its
 *   children's positions and drawings scale about its origin.
 * `min` and `max` bound the value, inclusive (metres for `size` and
 * `reach`, a ratio for `factor`).
 */
export interface ExtentSpec {
  readonly kind: "size" | "reach" | "factor";
  /** The field of the placed thing that holds the value. */
  readonly field: string;
  /** Its name in the inspector. */
  readonly label: string;
  /** What the value is, in the creator's words (the inspector's note). */
  readonly meaning: string;
  readonly min: number;
  readonly max: number;
}

/** What one view of a kind (or a folder, or a station) says about
 *  placing it. */
export interface ViewPlacement {
  /** The drawing reads the pose; false: the pose is kept in the file but
   *  nothing shows it (a `card`), so it gets no handles. */
  readonly posed: boolean;
  /** Turning it shows; false for what always faces the camera or the
   *  viewer (a pin's label, a sound's icon and circle, a reading sign's
   *  plate): no turn knob, and turning keys do nothing. */
  readonly turns: boolean;
  /** Its height is its own; false for a station, whose height is the
   *  ground's. */
  readonly lifts: boolean;
  /** What its dots change; absent: no dots. */
  readonly extent?: ExtentSpec;
}

/** A view the world never shows: its block is no placeable. */
const POSELESS: ViewPlacement = { posed: false, turns: false, lifts: false };
/** Stands at its pose and turns with it. */
const TURNING: ViewPlacement = { posed: true, turns: true, lifts: true };
/** Stands at its pose; what shows of it faces the camera or the viewer. */
const FACING: ViewPlacement = { posed: true, turns: false, lifts: true };

/** A placed model's dots: its largest side (the format's bounds). */
const MODEL: ViewPlacement = {
  ...TURNING,
  extent: {
    kind: "size",
    field: "sizeM",
    label: "Size",
    meaning: "Its largest side",
    min: TOUR_MODEL_MIN_SIZE_M,
    max: TOUR_MODEL_MAX_SIZE_M,
  },
};

type ViewsOf<K extends TourBlockKind> = (typeof TOUR_KINDS)[K]["views"][number];

/** THE block table: one row per kind and view of the format. */
export const BLOCK_PLACEMENT = {
  shortText: { pin: FACING, card: POSELESS },
  // The stand keeps its turn about up (`uprightTurn`); the sign's plate
  // turns to the viewer as it is drawn.
  longText: { lectern: TURNING, reading: FACING, card: POSELESS },
  picture: {
    plane: {
      ...TURNING,
      extent: {
        kind: "size",
        field: "widthM",
        label: "Width",
        meaning: "Its width",
        min: TOUR_PICTURE_MIN_WIDTH_M,
        max: TOUR_PICTURE_MAX_WIDTH_M,
      },
    },
    card: POSELESS,
  },
  video: { card: POSELESS },
  // A sound's reach has no dots: it is set in the inspector.
  audio: { spot: FACING, zone: FACING, card: POSELESS },
  model: {
    placed: MODEL,
    ghost: MODEL,
    hotspots: MODEL,
    cutaway: MODEL,
    toy: MODEL,
    card: POSELESS,
  },
  // He turns toward the camera by at most 60 degrees from his facing, so
  // his facing shows.
  character: {
    bubble: TURNING,
    speak: TURNING,
    "two-stations": TURNING,
    portrait: TURNING,
    popup: TURNING,
    card: POSELESS,
  },
} as const satisfies {
  readonly [K in TourBlockKind]: { readonly [V in ViewsOf<K>]: ViewPlacement };
};

/** Every plain folder: its children follow its pose, and its dots scale
 *  the whole group about its origin. */
export const CONTAINER_PLACEMENT: ViewPlacement = {
  posed: true,
  turns: true,
  lifts: true,
  extent: {
    kind: "factor",
    field: "scale",
    label: "Scale",
    meaning: "How much larger it draws its items, and their distances",
    min: 0.1,
    max: 10,
  },
};

/** A station: its frame is the earth, its height the ground's, and its
 *  dots set its found radius. */
export const STATION_PLACEMENT: ViewPlacement = {
  posed: true,
  turns: true,
  lifts: false,
  extent: {
    kind: "reach",
    field: "foundRadiusM",
    label: "Found radius",
    meaning: "How near a visitor comes before it counts as found",
    min: 2,
    max: 300,
  },
};

/** The row of `kind` in `view`; null for a kind or a view this table
 *  does not know (a newer tour's), which is then placed nowhere. */
export function blockPlacement(
  kind: string,
  view: string,
): ViewPlacement | null {
  if (!Object.hasOwn(BLOCK_PLACEMENT, kind)) return null;
  const rows: Readonly<Record<string, ViewPlacement>> =
    BLOCK_PLACEMENT[kind as TourBlockKind];
  return Object.hasOwn(rows, view) ? (rows[view] ?? null) : null;
}
