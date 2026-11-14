/**
 * What placing means for each thing the 3D editor can place: per block
 * kind AND per view (a block may stand in the world in one view and be a
 * card in another), and one row for a plain folder and one for a station.
 * Four facts per row: whether the drawing reads the pose (`posed`),
 * whether turning it shows (`turns`), whether its height is its own
 * (`lifts`), and what its size dots change (`extent`, none: no dots).
 * A row that bends (a ground arrow) also has a bend knob (`bends`).
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
import {
  TOUR_FOLDER_MAX_SCALE,
  TOUR_FOLDER_MIN_SCALE,
} from "gps-plus-slam-app-framework/ar/tour-story";
import {
  TOUR_SHORT_TEXT_MAX_READ_AT_M,
  TOUR_SHORT_TEXT_MIN_READ_AT_M,
} from "gps-plus-slam-app-framework/ar/tour-short-text";

import { GROUND } from "../kinds/short-text/ground-route.js";

/** A ring that grows linearly with a scale: `baseM` plus `perM` per
 *  unit of it. */
export interface LinearRing {
  readonly baseM: number;
  readonly perM: number;
}

/**
 * What a placeable's dots change. Four meanings, kept apart:
 * - `size`: a real size of the drawing, which scales uniformly with it
 *   (a model's largest side, a picture's width); a dot drag scales it by
 *   the dot's distance against where it was grabbed.
 * - `reach`: a distance from the centre that is no scale of the drawing
 *   (a station's found radius); a dot drag sets it to the dot's distance.
 * - `factor`: a uniform factor on a whole frame (a plain folder): its
 *   children's positions and drawings scale about its origin.
 * - `scale`: the one scale a drawing's parts follow along their own
 *   curves (a ground arrow's letters, length and width), so the drawing
 *   does not double at twice it; its ring is `ring`, linear in it, and a
 *   dot drag sets it from the dot's distance on that ring.
 * `min` and `max` bound the value, inclusive (metres for `size` and
 * `reach`, a ratio for `factor`, the scale's own unit for `scale`).
 */
export type ExtentSpec =
  | (ExtentCommon & { readonly kind: "size" | "reach" | "factor" })
  | (ExtentCommon & { readonly kind: "scale"; readonly ring: LinearRing });

/** What every kind of dots says. */
interface ExtentCommon {
  /** The field of the placed thing that holds the value. */
  readonly field: string;
  /** Its name in the inspector. */
  readonly label: string;
  /** What the value is, in the creator's words (the inspector's note). */
  readonly meaning: string;
  readonly min: number;
  readonly max: number;
}

/** Whether `spec` is dots that write a number on the block itself (a
 *  size or a scale), as the session's `setExtent` and the document's
 *  `blockNumberSet` take them; a reach and a factor are written by
 *  their own holders' calls. */
export function writesBlockNumber(spec: ExtentSpec | undefined): boolean {
  return spec?.kind === "size" || spec?.kind === "scale";
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
  /** It bends (a ground arrow): a knob behind its start sets its
   *  `bendDeg`; absent: no such knob. */
  readonly bends?: true;
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

/** A picture standing at its pose: turned by it, sized by its width. */
const PICTURE_STANDING: ViewPlacement = {
  ...TURNING,
  extent: {
    kind: "size",
    field: "widthM",
    label: "Width",
    meaning: "Its width",
    min: TOUR_PICTURE_MIN_WIDTH_M,
    max: TOUR_PICTURE_MAX_WIDTH_M,
  },
};

/**
 * A picture seen from its viewpoint: the handle stands at its pose, where
 * a viewpoint view without a viewpoint draws as a plane, but what shows is
 * lined up from the viewpoint, in the station's frame, and its size is the
 * viewpoint's lens and depth. So turning the pose shows nothing and it has
 * no width dots; its viewpoint is typed in the inspector.
 */
const PICTURE_FROM_VIEWPOINT: ViewPlacement = FACING;

type ViewsOf<K extends TourBlockKind> = (typeof TOUR_KINDS)[K]["views"][number];

/** THE block table: one row per kind and view of the format. */
export const BLOCK_PLACEMENT = {
  // A sign keeps its pose's turn unless it is told to turn to the
  // visitor; a hint at the edge is a ring and a tag on the screen.
  shortText: {
    pin: FACING,
    sign: TURNING,
    edgeHint: FACING,
    ground: {
      ...TURNING,
      bends: true,
      extent: {
        kind: "scale",
        field: "readAtM",
        label: "Reading distance",
        meaning: "The one scale its letters, length and width follow",
        min: TOUR_SHORT_TEXT_MIN_READ_AT_M,
        max: TOUR_SHORT_TEXT_MAX_READ_AT_M,
        ring: { baseM: GROUND.ringA, perM: GROUND.ringB },
      },
    },
    card: POSELESS,
  },
  // The stand keeps its turn about up (`uprightTurn`); the sign's plate
  // turns to the viewer as it is drawn.
  longText: { lectern: TURNING, reading: FACING, card: POSELESS },
  picture: {
    plane: PICTURE_STANDING,
    framed: PICTURE_STANDING,
    cutout: PICTURE_STANDING,
    thenNow: PICTURE_FROM_VIEWPOINT,
    sharpen: PICTURE_FROM_VIEWPOINT,
    finder: PICTURE_FROM_VIEWPOINT,
    window: PICTURE_FROM_VIEWPOINT,
    viewer: PICTURE_FROM_VIEWPOINT,
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
  // His flat figure faces the camera fully, so a turn shows nothing; the
  // pop-up is a stage set that keeps his facing.
  character: {
    bubble: FACING,
    speak: FACING,
    "two-stations": FACING,
    portrait: FACING,
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
    min: TOUR_FOLDER_MIN_SCALE,
    max: TOUR_FOLDER_MAX_SCALE,
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
