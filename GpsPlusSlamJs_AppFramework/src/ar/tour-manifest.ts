/**
 * The tour manifest (`tour.json`): what a creator placed in a tour, as
 * records a visitor's viewer renders. Every object carries an exact geo
 * pose - latitude, longitude, absolute altitude and a rotation against
 * north - minted from its local pose through the session alignment by the
 * same composition the printed code's level uses (`mintQrGeoPose`). That
 * is the owner's decision (guided-setup plan DEC-N7): objects minted in
 * the same session as the code share its GPS error, and the visitor's
 * mandatory code lock corrects the alignment, so they land where they
 * were placed relative to the code.
 *
 * Defensive by the same rule as `qr/qr-level.ts`: the file is external,
 * hand-editable data, every field is validated at the boundary, and the
 * writer re-validates through the reader so a programming error fails
 * loud here instead of producing a file a visitor cannot open.
 *
 * Content kinds in v1 (DEC-N9): a text `pin` and a captured `photo`, as a
 * discriminated union so a renderer never has to assert a field the parser
 * already guaranteed (M1 review #6). A reader that meets an unknown kind
 * rejects the document; the version field is what a later reader keys a
 * migration on.
 */

import { isFiniteNumber, isRecord } from '../utils/json-guards.js';
import { parseGeoPose } from './qr/geo-pose.js';
import type { QrGeoPose } from './qr/qr-gps-vote.js';
import { tourContentEntryName } from './tour-archive.js';

/** The manifest's schema version this module reads and writes. */
export const TOUR_MANIFEST_VERSION = 1;

interface TourObjectBase {
  /** Short id, unique in the manifest; also the content file's stem. */
  id: string;
  /** Exact pose: lat/lon, absolute altitude, rotation against north. */
  geo: QrGeoPose;
  /** ISO-8601 timestamp of the placement (must parse as a date). */
  createdAtIso: string;
}

/** A text pin. */
export interface TourPin extends TourObjectBase {
  kind: 'pin';
  /** The pin's text; non-empty. */
  label: string;
}

/** A captured photo, placed as a plane. */
export interface TourPhoto extends TourObjectBase {
  kind: 'photo';
  /** Archive path of the photo: `content/<id>.<ext>` for THIS object's id. */
  image: string;
  /** Pixel size of the encoded photo, for an aspect-correct plane. */
  imageWidth: number;
  imageHeight: number;
  /** An optional caption. */
  label?: string;
}

export type TourObject = TourPin | TourPhoto;
export type TourObjectKind = TourObject['kind'];

export interface TourManifest {
  version: typeof TOUR_MANIFEST_VERSION;
  objects: TourObject[];
}

/** Thrown when a manifest fails validation. */
export class TourManifestValidationError extends Error {
  constructor(message: string) {
    super(`tour-manifest: ${message}`);
    this.name = 'TourManifestValidationError';
  }
}

/** Ids: short, path-safe, one segment (they become file stems). */
const OBJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The content path's extension, after `content/<id>.`. */
const IMAGE_ENTRY = /^content\/[A-Za-z0-9_-]+\.([a-z0-9]{1,5})$/;

function fail(message: string): never {
  throw new TourManifestValidationError(message);
}

function isPositiveInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v > 0;
}

/** An empty manifest at the current version - the starter zip's content. */
export function createEmptyTourManifest(): TourManifest {
  return { version: TOUR_MANIFEST_VERSION, objects: [] };
}

function nonEmptyLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function parseBase(value: Record<string, unknown>, at: string): TourObjectBase {
  const { id, createdAtIso } = value;
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) {
    fail(`"${at}.id" must be a short path-safe id`);
  }
  const geo = parseGeoPose(value.geo, { path: `${at}.geo`, fail });
  if (
    typeof createdAtIso !== 'string' ||
    !Number.isFinite(Date.parse(createdAtIso))
  ) {
    fail(`"${at}.createdAtIso" must be an ISO-8601 timestamp`);
  }
  return { id, geo, createdAtIso };
}

function parsePin(value: Record<string, unknown>, at: string): TourPin {
  const label = nonEmptyLabel(value.label);
  if (label === undefined) {
    fail(`"${at}.label" must be a non-empty string for a pin`);
  }
  return { ...parseBase(value, at), kind: 'pin', label };
}

function parsePhoto(value: Record<string, unknown>, at: string): TourPhoto {
  const base = parseBase(value, at);
  const { image, imageWidth, imageHeight } = value;
  // The image entry is derived from the id, not free text (M1 review #5):
  // the writer names it `content/<id>.<ext>`, and a reader that accepted
  // any string would look up an entry the writer never produced.
  const extension =
    typeof image === 'string' ? IMAGE_ENTRY.exec(image)?.[1] : undefined;
  if (
    extension === undefined ||
    image !== tourContentEntryName(base.id, extension)
  ) {
    fail(`"${at}.image" must be content/${base.id}.<ext>`);
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

function parseObject(value: unknown, index: number): TourObject {
  const at = `objects[${String(index)}]`;
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  switch (value.kind) {
    case 'pin':
      return parsePin(value, at);
    case 'photo':
      return parsePhoto(value, at);
    default:
      return fail(`"${at}.kind" must be "pin" or "photo"`);
  }
}

/**
 * Validate an already-parsed value as a {@link TourManifest}. Throws
 * {@link TourManifestValidationError} naming the first violation.
 */
export function parseTourManifest(data: unknown): TourManifest {
  if (!isRecord(data)) fail('manifest must be a JSON object');
  if (data.version !== TOUR_MANIFEST_VERSION) {
    fail(
      `"version" must be ${String(TOUR_MANIFEST_VERSION)}, got ${JSON.stringify(data.version)}`
    );
  }
  if (!Array.isArray(data.objects)) fail('"objects" must be an array');
  const objects = data.objects.map((o, i) => parseObject(o, i));
  const ids = new Set<string>();
  for (const object of objects) {
    if (ids.has(object.id)) fail(`duplicate object id "${object.id}"`);
    ids.add(object.id);
  }
  return { version: TOUR_MANIFEST_VERSION, objects };
}

/**
 * Serialize a manifest to the JSON document `parseTourManifest` reads. The
 * input is re-validated first so a programming error fails LOUD here
 * instead of producing a broken file a creator uploads.
 */
export function serializeTourManifest(manifest: TourManifest): string {
  return JSON.stringify(parseTourManifest(manifest), null, 2);
}
