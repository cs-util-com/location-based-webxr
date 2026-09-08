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
 * Content kinds in v1 (DEC-N9): a text `pin` and a captured `photo`. A
 * reader that meets an unknown kind rejects the document; the version
 * field is what a later reader keys a migration on.
 */

import { parseGeoPose } from './qr/geo-pose.js';
import type { QrGeoPose } from './qr/qr-gps-vote.js';

/** The manifest's schema version this module reads and writes. */
export const TOUR_MANIFEST_VERSION = 1;

export type TourObjectKind = 'pin' | 'photo';

/** One placed object. `image*` fields exist on photos only. */
export interface TourObject {
  /** Short id, unique in the manifest; also the content file's stem. */
  id: string;
  kind: TourObjectKind;
  /** Exact pose: lat/lon, absolute altitude, rotation against north. */
  geo: QrGeoPose;
  /** ISO-8601 timestamp of the placement. */
  createdAtIso: string;
  /** The pin's text. Pins only; non-empty. */
  label?: string;
  /** Archive path of the photo (`content/<id>.jpg`). Photos only. */
  image?: string;
  /** Pixel size of the encoded photo, for an aspect-correct plane. */
  imageWidth?: number;
  imageHeight?: number;
}

export interface TourManifest {
  version: number;
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

function fail(message: string): never {
  throw new TourManifestValidationError(message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/** An empty manifest at the current version - the starter zip's content. */
export function createEmptyTourManifest(): TourManifest {
  return { version: TOUR_MANIFEST_VERSION, objects: [] };
}

function parseObject(value: unknown, index: number): TourObject {
  const at = `objects[${String(index)}]`;
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  const { id, kind, createdAtIso } = value;
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) {
    fail(`"${at}.id" must be a short path-safe id`);
  }
  if (kind !== 'pin' && kind !== 'photo') {
    fail(`"${at}.kind" must be "pin" or "photo"`);
  }
  const geo = parseGeoPose(value.geo, { path: `${at}.geo`, fail });
  if (typeof createdAtIso !== 'string' || createdAtIso.trim() === '') {
    fail(`"${at}.createdAtIso" must be a non-empty string`);
  }
  const object: TourObject = { id, kind, geo, createdAtIso };
  return kind === 'pin'
    ? withPinFields(object, value, at)
    : withPhotoFields(object, value, at);
}

function nonEmptyLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function withPinFields(
  object: TourObject,
  value: Record<string, unknown>,
  at: string
): TourObject {
  const label = nonEmptyLabel(value.label);
  if (label === undefined) {
    fail(`"${at}.label" must be a non-empty string for a pin`);
  }
  return { ...object, label };
}

function withPhotoFields(
  object: TourObject,
  value: Record<string, unknown>,
  at: string
): TourObject {
  const { image, imageWidth, imageHeight } = value;
  if (typeof image !== 'string' || image === '') {
    fail(`"${at}.image" must name the photo's archive entry`);
  }
  if (!isPositiveInteger(imageWidth) || !isPositiveInteger(imageHeight)) {
    fail(`"${at}.imageWidth"/"imageHeight" must be positive integers`);
  }
  const label = nonEmptyLabel(value.label);
  return {
    ...object,
    image,
    imageWidth,
    imageHeight,
    ...(label === undefined ? {} : { label }),
  };
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
