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
 * Free objects (DEC-N9): a text `pin` and a captured `photo`, as a
 * discriminated union so a renderer never has to assert a field the parser
 * already guaranteed (M1 review #6). A reader that meets an unknown kind
 * rejects the document.
 *
 * VERSION 2 (tour kit plan K1, §8 D7) adds the tour kit's game content in
 * one step - a title, the station order, media assets and stations
 * (`tour-stations.ts`) - and a VERSION POLICY:
 * - `version` is the format's major number. Version 1 tours (and the v1
 *   records of drafts on a device) MIGRATE on read: their pins and photos
 *   stay as free objects, the v2 parts take their defaults. A version above
 *   the one this reader knows is refused with a message naming the newer
 *   format, never guessed at.
 * - `minor` (default 0) counts ADDITIVE revisions of version 2. A reader
 *   opens a tour of any minor and ignores the fields it does not know -
 *   unknown fields are ignored at every minor, so a typo in a hand-edited
 *   optional field reads as absent - but the WRITER refuses a tour of a
 *   newer minor than its own: rewriting it would silently drop what this
 *   version cannot read.
 * - A newer minor may also add VALUES to a closed list (K1 milestone
 *   review R4): an object kind, an order, and the lists of
 *   `tour-stations.ts`. Read from a file of a newer minor, an unknown value
 *   degrades - the object or step is left out, an unknown order offers
 *   every station (`any`, which can never deadlock) - instead of failing
 *   the tour; at this reader's own minor or below it is a broken file.
 * - The writer writes VERSION 1 when the tour uses nothing of version 2 (no
 *   title, assets or stations, the default order, minor 0): builds from
 *   before K1 read only version 1, and a pins-and-photos tour must keep
 *   opening there (K1 milestone review R10).
 * Series id and version number do not live here: `manifest.json` is their
 * one place (§8 G7, `tour-signed-manifest.ts`).
 */

import { assertSafeZipEntryPaths } from '../storage/zip-entry-path.js';
import { isFiniteNumber, isRecord } from '../utils/json-guards.js';
import { parseGeoPose } from './qr/geo-pose.js';
import type { QrGeoPose } from './qr/qr-gps-vote.js';
import { tourContentEntryName } from './tour-archive.js';
import { tourMediaTypeOf, tourMediaTypeOfEntry } from './tour-media.js';
import {
  parseTourAssets,
  parseTourStations,
  type TourAsset,
  type TourOrder,
  type TourStation,
} from './tour-stations.js';

export type {
  TourAsset,
  TourAssetKind,
  TourBlock,
  TourChoiceOption,
  TourOrder,
  TourQuizAnswer,
  TourQuizOption,
  TourQuizRoute,
  TourStation,
  TourStationAnchor,
  TourStep,
  TourStepAdvance,
} from './tour-stations.js';

/** The manifest's format (major) version this module reads and writes. */
export const TOUR_MANIFEST_VERSION = 2;

/** The newest additive revision of version 2 this module knows. Minor 1
 *  added `captureSpots` (scan-pass plan S1). */
export const TOUR_MANIFEST_MINOR = 1;

/** Format versions this reader still opens by migrating them. */
const LEGACY_VERSION = 1;

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

/** One recorded photo's spot, baked at the creator's Finish. */
export interface TourCapture {
  /** The photo's entry name as the recording wrote it (`add2dImage`). */
  image: string;
  /** Where it was taken and how it faced; always carries a rotation. */
  geo: QrGeoPose;
}

/**
 * The recorded photos' spots, computed ONCE at the creator's Finish
 * (scan-pass plan S1, S-D11: each photo through the first settled
 * alignment after it was taken), so a visitor neither downloads the walk
 * nor replays it. Its presence is the "baked" marker: a viewer places
 * these and never runs its live join; a tour without it keeps the join.
 */
export interface TourCaptureSpots {
  /** The walk's GPS fixes paired with odometry, and their median accuracy
   *  (null when the fixes reported none): the quality line a visitor sees,
   *  as the live join reported it. */
  fixes: number;
  gpsAccuracyMedianM: number | null;
  captures: TourCapture[];
}

export interface TourManifest {
  version: typeof TOUR_MANIFEST_VERSION;
  /** The additive revision the file was written at (0 when absent). */
  minor: number;
  /** The tour's name, for lists and the visitor's screen. */
  title?: string;
  /** Which stations are offered: in order, all at once, or by answer. */
  order: TourOrder;
  /** Free pins and photos (every v1 tour's whole content). */
  objects: TourObject[];
  /** Media files named by their own ids (§8 G5). */
  assets: TourAsset[];
  stations: TourStation[];
  /** Minor 1: the recorded photos' baked spots (see the type). */
  captureSpots?: TourCaptureSpots;
}

const ORDERS: ReadonlySet<string> = new Set(['fixed', 'any', 'branch']);

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
  return {
    version: TOUR_MANIFEST_VERSION,
    // The revision an empty tour needs; the writer raises it with content.
    minor: 0,
    order: 'fixed',
    objects: [],
    assets: [],
    stations: [],
  };
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

/** A photo whose image is of a media type this reader does not know: a
 *  newer minor's, so a lenient reader leaves the object out (R4). */
function isUnknownImageType(value: Record<string, unknown>): boolean {
  const extension =
    typeof value.image === 'string'
      ? IMAGE_ENTRY.exec(value.image)?.[1]
      : undefined;
  return extension !== undefined && tourMediaTypeOf(extension) === null;
}

/** An object, or null when a lenient reader cannot show it (R4). */
function parseObject(
  value: unknown,
  index: number,
  lenient: boolean
): TourObject | null {
  const at = `objects[${String(index)}]`;
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  switch (value.kind) {
    case 'pin':
      return parsePin(value, at);
    case 'photo':
      if (lenient && isUnknownImageType(value)) return null;
      return parsePhoto(value, at);
    default:
      if (lenient) return null;
      return fail(`"${at}.kind" must be "pin" or "photo"`);
  }
}

function parseObjects(value: unknown, lenient: boolean): TourObject[] {
  if (!Array.isArray(value)) fail('"objects" must be an array');
  const objects = value.flatMap((o, i) => {
    const object = parseObject(o, i, lenient);
    return object === null ? [] : [object];
  });
  const ids = new Set<string>();
  for (const object of objects) {
    if (ids.has(object.id)) fail(`duplicate object id "${object.id}"`);
    ids.add(object.id);
  }
  return objects;
}

function parseCapture(value: unknown, at: string): TourCapture {
  if (!isRecord(value)) fail(`"${at}" must be an object`);
  const { image } = value;
  if (typeof image !== 'string') fail(`"${at}.image" must be a string`);
  try {
    assertSafeZipEntryPaths([image]);
  } catch (err) {
    fail(`"${at}.image": ${err instanceof Error ? err.message : String(err)}`);
  }
  if (tourMediaTypeOfEntry(image)?.kind !== 'image') {
    fail(`"${at}.image" must be an image type`);
  }
  const geo = parseGeoPose(value.geo, { path: `${at}.geo`, fail });
  // Photos face as captured (capture-geo join D3): a heading alone would
  // stand every plane upright, facing one bearing.
  if (geo.rotation === undefined) fail(`"${at}.geo" must carry a rotation`);
  return { image, geo };
}

/** The baked spots, or undefined when the document has none. */
function parseCaptureSpots(value: unknown): TourCaptureSpots | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail('"captureSpots" must be an object');
  const { fixes, gpsAccuracyMedianM, captures } = value;
  if (!isPositiveInteger(fixes)) {
    fail('"captureSpots.fixes" must be a positive integer');
  }
  if (
    gpsAccuracyMedianM !== null &&
    (!isFiniteNumber(gpsAccuracyMedianM) || gpsAccuracyMedianM < 0)
  ) {
    fail('"captureSpots.gpsAccuracyMedianM" must be null or a number >= 0');
  }
  // A bake that placed nothing is never written: the marker would stop the
  // viewer's own join for a tour with nothing to show.
  if (!Array.isArray(captures) || captures.length === 0) {
    fail('"captureSpots.captures" must be a non-empty array');
  }
  const parsed = captures.map((c, i) =>
    parseCapture(c, `captureSpots.captures[${String(i)}]`)
  );
  if (new Set(parsed.map((c) => c.image)).size !== parsed.length) {
    fail('"captureSpots.captures" names a photo twice');
  }
  return { fixes, gpsAccuracyMedianM, captures: parsed };
}

/** The format version, checked: 1 (migrated) or 2; a newer one is named. */
function formatVersionOf(value: unknown): 1 | 2 {
  if (value === LEGACY_VERSION || value === TOUR_MANIFEST_VERSION) {
    return value;
  }
  if (
    Number.isSafeInteger(value) &&
    (value as number) > TOUR_MANIFEST_VERSION
  ) {
    fail(
      `this tour was made with a newer version of the app (format ${String(value)}); update the app to open it`
    );
  }
  return fail(
    `"version" must be ${String(LEGACY_VERSION)} or ${String(TOUR_MANIFEST_VERSION)}, got ${JSON.stringify(value)}`
  );
}

function minorOf(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`"minor" must be an integer >= 0, got ${JSON.stringify(value)}`);
  }
  return value as number;
}

function orderOf(value: unknown, lenient: boolean): TourOrder {
  if (value === undefined) return 'fixed';
  if (typeof value !== 'string' || !ORDERS.has(value)) {
    // A newer minor's order: offer every station, which never deadlocks
    // (a stricter guess could leave a station nobody can reach).
    if (lenient) return 'any';
    fail('"order" must be "fixed", "any" or "branch"');
  }
  return value as TourOrder;
}

/** The v2 parts of a version 2 document; a migrated v1 one has none, so
 *  it takes every default (its own fields beyond `objects` are ignored). */
function parseV2Parts(
  data: Record<string, unknown>,
  objects: readonly TourObject[],
  minor: number
): Omit<TourManifest, 'version' | 'objects'> {
  const lenient = minor > TOUR_MANIFEST_MINOR;
  const assets = parseTourAssets(data.assets ?? [], {
    objectIds: new Set(objects.map((o) => o.id)),
    fail,
    lenient,
  });
  const title = nonEmptyLabel(data.title);
  const captureSpots = parseCaptureSpots(data.captureSpots);
  return {
    minor,
    ...(title === undefined ? {} : { title }),
    order: orderOf(data.order, lenient),
    assets,
    stations: parseTourStations(data.stations ?? [], {
      assets,
      fail,
      lenient,
    }),
    ...(captureSpots === undefined ? {} : { captureSpots }),
  };
}

/**
 * Validate an already-parsed value as a {@link TourManifest}, migrating a
 * version 1 document to version 2. Throws
 * {@link TourManifestValidationError} naming the first violation.
 */
export function parseTourManifest(data: unknown): TourManifest {
  if (!isRecord(data)) fail('manifest must be a JSON object');
  const version = formatVersionOf(data.version);
  const v2 = version === LEGACY_VERSION ? {} : data;
  const minor = minorOf(v2.minor);
  const objects = parseObjects(data.objects, minor > TOUR_MANIFEST_MINOR);
  const parts = parseV2Parts(v2, objects, minor);
  return {
    version: TOUR_MANIFEST_VERSION,
    minor: parts.minor,
    ...(parts.title === undefined ? {} : { title: parts.title }),
    order: parts.order,
    objects,
    assets: parts.assets,
    stations: parts.stations,
    ...(parts.captureSpots === undefined
      ? {}
      : { captureSpots: parts.captureSpots }),
  };
}

/** The lowest revision of version 2 that carries everything the manifest
 *  holds. Writing it, rather than the minor the file was read at, loses
 *  nothing: this module knows every field up to its own minor. */
function minorNeeded(manifest: TourManifest): number {
  return manifest.captureSpots === undefined ? 0 : 1;
}

/** True when the manifest uses anything only version 2 can carry. */
function needsVersion2(manifest: TourManifest): boolean {
  return (
    minorNeeded(manifest) !== 0 ||
    manifest.title !== undefined ||
    manifest.order !== 'fixed' ||
    manifest.assets.length > 0 ||
    manifest.stations.length > 0
  );
}

/**
 * Serialize a manifest to the JSON document `parseTourManifest` reads. The
 * input is re-validated first so a programming error fails LOUD here
 * instead of producing a broken file a creator uploads. A manifest of a
 * NEWER minor than {@link TOUR_MANIFEST_MINOR} is refused: it was read with
 * its unknown fields dropped, and writing it back would lose them. A
 * manifest that uses nothing of version 2 is written as VERSION 1
 * (`{ version: 1, objects }`), which builds from before K1 open (R10); any
 * other is written at the lowest minor its content needs, so a tour gains
 * a newer minor, and older writers' refusal, only with a newer field.
 */
export function serializeTourManifest(manifest: TourManifest): string {
  const parsed = parseTourManifest(manifest);
  if (parsed.minor > TOUR_MANIFEST_MINOR) {
    fail(
      `this tour was made with a newer version of the app (format ${String(TOUR_MANIFEST_VERSION)}.${String(parsed.minor)}); saving it here would drop what this version cannot read`
    );
  }
  return JSON.stringify(
    needsVersion2(parsed)
      ? { ...parsed, minor: minorNeeded(parsed) }
      : { version: LEGACY_VERSION, objects: parsed.objects },
    null,
    2
  );
}
