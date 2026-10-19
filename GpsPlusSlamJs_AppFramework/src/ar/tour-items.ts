/**
 * A station's ITEMS in `tour.json` version 3 (tour editor plan
 * 2026-10-17-1816, W3): the text pins, captured photos and 3D models a
 * creator placed, each with a LOCAL pose relative to its station
 * (`tour-stations.ts`). A
 * station carries the geo pose; its items move with it (D17: a station
 * moves rigidly, its items' local poses never change).
 *
 * The kind-specific fields (a pin's label; a photo's image entry and pixel
 * size) are shared with the world-view object of `tour-manifest.ts`
 * (`TourObject`, which carries a geo pose instead of a local one), so the
 * two parsers can never disagree about what a pin or a photo is (DEC-H3).
 *
 * A placed MODEL (minor 1, the editor's round-3 decision on sizes) names a
 * model asset of the tour's `assets` (`tour-stations.ts` resolves the
 * reference, since only it sees the assets) and carries its size in METRES:
 * the scaled model's largest side, from {@link TOUR_MODEL_MIN_SIZE_M} to
 * {@link TOUR_MODEL_MAX_SIZE_M}. A factor would be the wrong unit for a
 * bound: its sensible range depends on the model's own size (a 0.1 m model
 * at 100x is 10 m, a 20 m one 2 km). A renderer scales the decoded model by
 * `sizeM` over its own largest side. Pins and photos have no size: they
 * keep the fixed size they are drawn at.
 *
 * Defensive by the rule of `tour-manifest.ts`: hand-editable external data,
 * every field checked at the boundary. LENIENT for a newer minor (K1
 * milestone review R4): an item of an unknown kind, a photo of an image
 * type this reader does not know, or a model whose positive size lies
 * beyond this reader's bound (a later minor may widen it), is left out
 * instead of failing the tour. A size that is not a positive finite number
 * fails at every minor: no revision can make it a size.
 *
 * @see tour-items.ts.md
 */

import { isFiniteNumber, isRecord } from '../utils/json-guards.js';
import { renormalizeUnitQuaternion } from './qr/qr-geo-pose-minting.js';
import type { Pose } from './qr/qr-pose.js';
import { tourContentEntryName, TOUR_ID_PATTERN } from './tour-archive.js';
import { tourMediaTypeOf } from './tour-media.js';

type Fail = (message: string) => never;

/**
 * A pose in a station's own frame: `position` in metres along the
 * station's rotated North, Up and East axes from its geo position;
 * `rotation` a unit quaternion `[x, y, z, w]` relative to the station's.
 */
export type TourLocalPose = Pose;

/**
 * How far an item may stand from its station, per axis (m). Not a design
 * limit (the editor keeps stations far smaller): a sanity bound, so a
 * hand-edited or corrupted number cannot put an item a planet away, where
 * the station's flat frame means nothing.
 */
export const TOUR_ITEM_MAX_OFFSET_M = 10_000;

/** The smallest a placed model's largest side may be (m), inclusive. */
export const TOUR_MODEL_MIN_SIZE_M = 0.05;
/** The largest a placed model's largest side may be (m), inclusive. */
export const TOUR_MODEL_MAX_SIZE_M = 500;

/** What a pin, a photo or a model is, wherever it stands. */
interface TourContentBase {
  /** Short id, unique in the tour; also the content file's stem. */
  readonly id: string;
  /** ISO-8601 timestamp of the placement (must parse as a date). */
  readonly createdAtIso: string;
}

/** A text pin's own fields. */
export interface TourPinFields extends TourContentBase {
  readonly kind: 'pin';
  /** The pin's text; non-empty. */
  readonly label: string;
}

/** A captured photo's own fields, placed as a plane. */
export interface TourPhotoFields extends TourContentBase {
  readonly kind: 'photo';
  /** Archive path of the photo: `content/<id>.<ext>` for THIS id. */
  readonly image: string;
  /** Pixel size of the encoded photo, for an aspect-correct plane. */
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** An optional caption. */
  readonly label?: string;
}

/** A placed 3D model's own fields. */
export interface TourModelFields extends TourContentBase {
  readonly kind: 'model';
  /** The id of a model asset of the tour (`assets`, a `.glb`). */
  readonly asset: string;
  /** The scaled model's largest side, in metres, within the bounds. */
  readonly sizeM: number;
  /** An optional caption. */
  readonly label?: string;
}

export type TourContentFields =
  TourPinFields | TourPhotoFields | TourModelFields;

/** A pin of a station, at its local pose. */
export type TourPinItem = TourPinFields & { readonly pose: TourLocalPose };
/** A photo of a station, at its local pose. */
export type TourPhotoItem = TourPhotoFields & { readonly pose: TourLocalPose };
/** A model of a station, at its local pose. */
export type TourModelItem = TourModelFields & { readonly pose: TourLocalPose };
export type TourItem = TourPinItem | TourPhotoItem | TourModelItem;

/** The content path's extension, after `content/<id>.`. */
const IMAGE_ENTRY = /^content\/[A-Za-z0-9_-]+\.([a-z0-9]{1,5})$/;

function isPositiveInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v > 0;
}

function nonEmptyLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function parseBase(
  value: Record<string, unknown>,
  at: string,
  fail: Fail
): TourContentBase {
  const { id, createdAtIso } = value;
  if (typeof id !== 'string' || !TOUR_ID_PATTERN.test(id)) {
    fail(`"${at}.id" must be a short path-safe id`);
  }
  if (
    typeof createdAtIso !== 'string' ||
    !Number.isFinite(Date.parse(createdAtIso))
  ) {
    fail(`"${at}.createdAtIso" must be an ISO-8601 timestamp`);
  }
  return { id, createdAtIso };
}

function parsePin(
  value: Record<string, unknown>,
  at: string,
  fail: Fail
): TourPinFields {
  const base = parseBase(value, at, fail);
  const label = nonEmptyLabel(value.label);
  if (label === undefined) {
    fail(`"${at}.label" must be a non-empty string for a pin`);
  }
  return { ...base, kind: 'pin', label };
}

function parsePhoto(
  value: Record<string, unknown>,
  at: string,
  fail: Fail
): TourPhotoFields {
  const base = parseBase(value, at, fail);
  const { image, imageWidth, imageHeight } = value;
  // The image entry is derived from the id, not free text (M1 review #5):
  // the writer names it `content/<id>.<ext>`, and a reader that accepted
  // any string would look up an entry the writer never produced.
  const extension =
    typeof image === 'string' ? IMAGE_ENTRY.exec(image)?.[1] : undefined;
  // A photo is an IMAGE (tour kit plan K0): an allowlisted raster type,
  // checked before `tourContentEntryName`, which would throw a TypeError
  // rather than the manifest's own validation error.
  if (
    extension === undefined ||
    tourMediaTypeOf(extension)?.kind !== 'image' ||
    image !== tourContentEntryName(base.id, extension)
  ) {
    fail(`"${at}.image" must be content/${base.id}.<ext> (an image type)`);
  }
  if (!isPositiveInteger(imageWidth) || !isPositiveInteger(imageHeight)) {
    fail(`"${at}.imageWidth"/"imageHeight" must be positive integers`);
  }
  const label = nonEmptyLabel(value.label);
  return {
    ...base,
    kind: 'photo',
    image,
    imageWidth,
    imageHeight,
    ...(label === undefined ? {} : { label }),
  };
}

/** Within this reader's bound for a model's size. */
function isModelSizeInBounds(sizeM: number): boolean {
  return sizeM >= TOUR_MODEL_MIN_SIZE_M && sizeM <= TOUR_MODEL_MAX_SIZE_M;
}

/**
 * A model's fields, or null when a lenient reader meets a positive size
 * beyond its bound (a newer minor's). Refused, never clamped: a clamp
 * would make the next save rewrite the creator's number without a word,
 * and a size outside the bound in a file of this minor is a broken file.
 */
function parseModel(
  value: Record<string, unknown>,
  at: string,
  fail: Fail,
  lenient: boolean
): TourModelFields | null {
  const base = parseBase(value, at, fail);
  const { asset, sizeM } = value;
  if (typeof asset !== 'string' || !TOUR_ID_PATTERN.test(asset)) {
    fail(`"${at}.asset" must name a model asset (a short path-safe id)`);
  }
  const sizeMessage = `"${at}.sizeM" must be a number of metres from ${String(TOUR_MODEL_MIN_SIZE_M)} to ${String(TOUR_MODEL_MAX_SIZE_M)}`;
  if (!isFiniteNumber(sizeM) || sizeM <= 0) fail(sizeMessage);
  if (!isModelSizeInBounds(sizeM)) {
    if (lenient) return null;
    fail(sizeMessage);
  }
  const label = nonEmptyLabel(value.label);
  return {
    ...base,
    kind: 'model',
    asset,
    sizeM,
    ...(label === undefined ? {} : { label }),
  };
}

/** A photo whose image is of a media type this reader does not know: a
 *  newer minor's, so a lenient reader leaves the item out (R4). */
function isUnknownImageType(value: Record<string, unknown>): boolean {
  const extension =
    typeof value.image === 'string'
      ? IMAGE_ENTRY.exec(value.image)?.[1]
      : undefined;
  return extension !== undefined && tourMediaTypeOf(extension) === null;
}

/**
 * The kind-specific fields of a pin, a photo or a model at `at`, or null when a
 * lenient reader cannot show it (R4). Shared by the station item and the
 * world-view object (`tour-manifest.ts` `parseTourObject`).
 */
export function parseTourContentFields(
  value: unknown,
  at: string,
  options: { readonly fail: Fail; readonly lenient?: boolean }
): TourContentFields | null {
  const fail: Fail = options.fail;
  const lenient = options.lenient === true;
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  switch (value.kind) {
    case 'pin':
      return parsePin(value, at, fail);
    case 'photo':
      if (lenient && isUnknownImageType(value)) return null;
      return parsePhoto(value, at, fail);
    case 'model':
      return parseModel(value, at, fail, lenient);
    default:
      if (lenient) return null;
      return fail(`"${at}.kind" must be "pin", "photo" or "model"`);
  }
}

/** A local pose: three finite offsets within the sanity bound, and a unit
 *  quaternion renormalized by the level files' one rule. */
export function parseTourLocalPose(
  value: unknown,
  at: string,
  fail: Fail
): TourLocalPose {
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  const { position, rotation } = value;
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every(
      (v) => isFiniteNumber(v) && Math.abs(v) <= TOUR_ITEM_MAX_OFFSET_M
    )
  ) {
    fail(
      `"${at}.position" must be three numbers within ${String(TOUR_ITEM_MAX_OFFSET_M)} m`
    );
  }
  const unit =
    Array.isArray(rotation) && rotation.every(isFiniteNumber)
      ? renormalizeUnitQuaternion(rotation as [number, number, number, number])
      : undefined;
  if (unit === undefined) fail(`"${at}.rotation" must be a unit quaternion`);
  const [n, u, e] = position as [number, number, number];
  // `+ 0` canonicalizes -0, which JSON cannot carry (round trips exact).
  return { position: [n + 0, u + 0, e + 0], rotation: unit };
}

/** A station's items; ids are unique per station here, and across the
 *  tour in `tour-manifest.ts`. */
export function parseTourItems(
  value: unknown,
  at: string,
  options: { readonly fail: Fail; readonly lenient?: boolean }
): TourItem[] {
  const fail: Fail = options.fail;
  if (!Array.isArray(value)) fail(`"${at}" must be an array`);
  return value.flatMap((v, i): TourItem[] => {
    const itemAt = `${at}[${String(i)}]`;
    const fields = parseTourContentFields(v, itemAt, options);
    if (fields === null) return [];
    const pose = parseTourLocalPose(
      (v as Record<string, unknown>).pose,
      `${itemAt}.pose`,
      fail
    );
    return [{ ...fields, pose }];
  });
}
