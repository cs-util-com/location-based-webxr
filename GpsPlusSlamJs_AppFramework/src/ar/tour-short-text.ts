/**
 * A short text's look fields: how its words stand in the world beyond the
 * pin. Its role (an instruction, a label, a warning), how it turns, the
 * distance it is readable from, a point it points to, its language, and
 * the ground view's own fields (a style, a bend, a placement and two
 * colours). Every field is optional and read in every view, so a view
 * switch keeps it; the renderer gives each absent field its default.
 *
 * Read by one rule each: a value of the wrong type fails at every minor;
 * a value a later minor may allow (a new role, a wider bend) fails a file
 * of this reader's own minor and is dropped, alone, from a newer one.
 *
 * @see tour-short-text.ts.md
 */

import { isFiniteNumber } from '../utils/json-guards.js';
import type {
  TourBlockFields,
  TourBlockReadContext,
} from './tour-block-read.js';

/** What a short text is for: it tells the visitor to do something, names
 *  a thing, or warns. Each has its accent colour in the viewer. */
export const TOUR_SHORT_TEXT_ROLES = [
  'instruction',
  'label',
  'warning',
] as const;
export type TourShortTextRole = (typeof TOUR_SHORT_TEXT_ROLES)[number];

/** How a sign turns: fixed at its pose (`world`), turned about its upright
 *  axis toward the visitor (`upright`), or the same while it also keeps its
 *  words level to the visitor's eyes (`face`). */
export const TOUR_SHORT_TEXT_ORIENTATIONS = [
  'world',
  'upright',
  'face',
] as const;
export type TourShortTextOrientation =
  (typeof TOUR_SHORT_TEXT_ORIENTATIONS)[number];

/** How an arrow on the ground is drawn. */
export const TOUR_GROUND_STYLES = [
  'ribbon',
  'vanes',
  'footprints',
  'lights',
  'floor',
] as const;
export type TourGroundStyle = (typeof TOUR_GROUND_STYLES)[number];

/** How the `floor` style's cast arrow stands: on the ground, hovering a
 *  little above it, or upright. */
export const TOUR_GROUND_FLOOR_PLACEMENTS = [
  'lying',
  'hovering',
  'upright',
] as const;
export type TourGroundFloorPlacement =
  (typeof TOUR_GROUND_FLOOR_PLACEMENTS)[number];

/** The distance (m) a short text is readable from, inclusive. */
export const TOUR_SHORT_TEXT_MIN_READ_AT_M = 1;
export const TOUR_SHORT_TEXT_MAX_READ_AT_M = 40;

/** How far from its station's origin a `pointsTo` may lie (m). */
export const TOUR_SHORT_TEXT_POINT_MAX_M = 1000;

/** The most an arrow on the ground bends either way (degrees). */
export const TOUR_GROUND_MAX_BEND_DEG = 60;

/** The letter height per metre of reading distance: 6.6 cm letters read
 *  comfortably at 2.5 m. */
const LETTER_M_PER_READ_M = 0.066 / 2.5;

/** The longest language tag kept. */
const LANG_MAX = 35;

/** A BCP-47 language tag's shape: a primary language and subtags. */
const LANG_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

/** A colour as `#rrggbb`. */
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/u;

/** A point in a station's frame, metres. */
export type TourShortTextPoint = readonly [number, number, number];

/** The look fields a short text may carry. */
export interface TourShortTextLook {
  readonly role?: TourShortTextRole;
  readonly orientation?: TourShortTextOrientation;
  /** The distance (m) its words are readable from: sets its size. */
  readonly readAtM?: number;
  /** A point in its station's frame it points to (an arrow on a sign, the
   *  far end of an arrow on the ground). */
  readonly pointsTo?: TourShortTextPoint;
  /** The language of its words (a BCP-47 tag). */
  readonly lang?: string;
  /** The ground view's style. */
  readonly style?: TourGroundStyle;
  /** The ground view's bend (degrees, + bends right seen from above). */
  readonly bendDeg?: number;
  /** How the `floor` style's arrow stands. */
  readonly floorPlacement?: TourGroundFloorPlacement;
  /** The `floor` style writes its caption on the arrow itself. */
  readonly captionOnArrow?: boolean;
  /** The ground view's main colour (`#rrggbb`); absent: the role's. */
  readonly color?: string;
  /** The ground view's dark colour (`#rrggbb`); absent: the style's. */
  readonly darkColor?: string;
}

/** The letter height (m) for a reading distance, the distance clamped to
 *  the format's bounds. */
export function shortTextLetterHeightM(readAtM: number): number {
  const clamped = Math.min(
    TOUR_SHORT_TEXT_MAX_READ_AT_M,
    Math.max(TOUR_SHORT_TEXT_MIN_READ_AT_M, readAtM)
  );
  return clamped * LETTER_M_PER_READ_M;
}

/** A value a later minor may allow: fails a file of this minor, drops the
 *  field alone from a newer one. */
function dropped<T extends object>(
  ctx: TourBlockReadContext,
  field: string,
  reason: string
): Partial<T> {
  if (!ctx.lenient) return ctx.fail(reason);
  ctx.onDropped?.({ kind: 'field', block: ctx.id, field, reason });
  return {};
}

function choice<F extends string, C extends string>(
  v: TourBlockFields,
  field: F,
  choices: readonly C[],
  ctx: TourBlockReadContext
): Partial<Record<F, C>> {
  const value = v[field];
  if (value === undefined) return {};
  if (
    typeof value === 'string' &&
    (choices as readonly string[]).includes(value)
  ) {
    return { [field]: value } as Record<F, C>;
  }
  return dropped(
    ctx,
    field,
    `"${ctx.at}.${field}" must be one of ${choices.join(', ')}`
  );
}

function matching<F extends string>(
  v: TourBlockFields,
  field: F,
  pattern: RegExp,
  max: number,
  what: string,
  ctx: TourBlockReadContext
): Partial<Record<F, string>> {
  const value = v[field];
  if (value === undefined) return {};
  if (typeof value === 'string' && value.length <= max && pattern.test(value)) {
    return { [field]: value } as Record<F, string>;
  }
  return dropped(ctx, field, `"${ctx.at}.${field}" must be ${what}`);
}

function readAt(v: TourBlockFields, ctx: TourBlockReadContext) {
  const value = v.readAtM;
  if (value === undefined) return {};
  const at = `${ctx.at}.readAtM`;
  const message = `"${at}" must be a number of metres from ${String(TOUR_SHORT_TEXT_MIN_READ_AT_M)} to ${String(TOUR_SHORT_TEXT_MAX_READ_AT_M)}`;
  if (!isFiniteNumber(value) || value <= 0) return ctx.fail(message);
  if (
    value < TOUR_SHORT_TEXT_MIN_READ_AT_M ||
    value > TOUR_SHORT_TEXT_MAX_READ_AT_M
  ) {
    return dropped(ctx, 'readAtM', message);
  }
  return { readAtM: value };
}

function pointsTo(v: TourBlockFields, ctx: TourBlockReadContext) {
  const value = v.pointsTo;
  if (value === undefined) return {};
  const at = `${ctx.at}.pointsTo`;
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !(value as unknown[]).every(isFiniteNumber)
  ) {
    return ctx.fail(`"${at}" must be three finite numbers`);
  }
  const [x, y, z] = value as [number, number, number];
  if (
    Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) >
    TOUR_SHORT_TEXT_POINT_MAX_M
  ) {
    return dropped(
      ctx,
      'pointsTo',
      `"${at}" must lie within ${String(TOUR_SHORT_TEXT_POINT_MAX_M)} m of its station`
    );
  }
  return { pointsTo: [x, y, z] as TourShortTextPoint };
}

function bend(v: TourBlockFields, ctx: TourBlockReadContext) {
  const value = v.bendDeg;
  if (value === undefined) return {};
  const at = `${ctx.at}.bendDeg`;
  const message = `"${at}" must be a number of degrees from -${String(TOUR_GROUND_MAX_BEND_DEG)} to ${String(TOUR_GROUND_MAX_BEND_DEG)}`;
  if (!isFiniteNumber(value)) return ctx.fail(message);
  if (Math.abs(value) > TOUR_GROUND_MAX_BEND_DEG) {
    return dropped(ctx, 'bendDeg', message);
  }
  return { bendDeg: value };
}

function flag(v: TourBlockFields, ctx: TourBlockReadContext) {
  const value = v.captionOnArrow;
  if (value === undefined) return {};
  if (typeof value === 'boolean') return { captionOnArrow: value };
  return dropped(
    ctx,
    'captionOnArrow',
    `"${ctx.at}.captionOnArrow" must be true or false`
  );
}

/** A short text's look fields, in the order a writer writes them. */
export function shortTextLook(
  v: TourBlockFields,
  ctx: TourBlockReadContext
): TourShortTextLook {
  return {
    ...choice(v, 'role', TOUR_SHORT_TEXT_ROLES, ctx),
    ...choice(v, 'orientation', TOUR_SHORT_TEXT_ORIENTATIONS, ctx),
    ...readAt(v, ctx),
    ...pointsTo(v, ctx),
    ...matching(v, 'lang', LANG_TAG, LANG_MAX, 'a language tag', ctx),
    ...choice(v, 'style', TOUR_GROUND_STYLES, ctx),
    ...bend(v, ctx),
    ...choice(v, 'floorPlacement', TOUR_GROUND_FLOOR_PLACEMENTS, ctx),
    ...flag(v, ctx),
    ...matching(v, 'color', HEX_COLOR, 7, 'a colour as #rrggbb', ctx),
    ...matching(v, 'darkColor', HEX_COLOR, 7, 'a colour as #rrggbb', ctx),
  };
}
