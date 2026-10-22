/**
 * The tour manifest (`tour.json`): what a creator placed in a tour, as
 * records a visitor's viewer renders.
 *
 * VERSION 3 (tour editor plan 2026-10-17-1816, W3; a MAJOR): every pin and
 * photo is an ITEM of a STATION (`tour-stations.ts`, `tour-items.ts`). The
 * station carries the exact geo pose - latitude, longitude, absolute
 * altitude and a rotation against north - and its items carry LOCAL poses
 * relative to it, so a station moves rigidly with all it holds (D17). There
 * are no loose pins. Local poses are converted from the already-settled geo
 * poses (D33's settle holds): `tour-station-pose.ts` converts both ways and
 * gives the world view (`tourObjects`) the viewer places.
 *
 * Defensive by the same rule as `qr/qr-level.ts`: the file is external,
 * hand-editable data, every field is validated at the boundary, and the
 * writer re-validates through the reader so a programming error fails
 * loud here instead of producing a file a visitor cannot open.
 *
 * Items (DEC-N9): a text `pin`, a captured `photo` and (minor 1) a placed
 * 3D `model` with its size in metres, as a discriminated union so a
 * renderer never has to assert a field the parser already guaranteed (M1
 * review #6). A reader that meets an unknown kind rejects the document (at
 * its own minor).
 *
 * VERSION POLICY:
 * - `version` is the format's major number. Version 3 is the only one this
 *   reader opens. Versions 1 and 2 (free objects, stations anchored to
 *   codes) are NOT migrated (D5: the one test tour is replaced): they are
 *   refused with a message saying the tour is in an older format. A version
 *   above 3 is refused with a message naming the newer format, never
 *   guessed at - which is also what every version 2 reader says about a
 *   version 3 file ("update the app").
 * - `minor` (default 0) counts ADDITIVE revisions of version 3. A reader
 *   opens a tour of any minor and ignores the fields it does not know -
 *   unknown fields are ignored at every minor, so a typo in a hand-edited
 *   optional field reads as absent - but the WRITER refuses a tour of a
 *   newer minor than its own: rewriting it would silently drop what this
 *   version cannot read.
 * - MINOR 1 adds the placed 3D model (`tour-items.ts`). The writer writes
 *   the LOWEST minor the tour needs: 1 while it carries a model, else 0, so
 *   a tour without one stays editable by a 3.0 reader, and a 3.0 reader of a tour with a model leaves the model out (its
 *   lenient read) instead of refusing the tour.
 * - MINOR 2 adds a station's `description` and card `image`
 *   (`tour-stations.ts`; G2 build plan 2026-10-21-2247, §4.2.4). Written
 *   at 2 while any station carries either: a 3.1 reader ignores both as
 *   unknown fields, so it reads such a tour leniently and refuses to save
 *   it, instead of writing it back without them. Neither ever fails a
 *   tour: a card image whose picture went is dropped
 *   (`station-image-gone`), like the cover, and a malformed value is
 *   dropped and reported with no cause, like a malformed detail.
 * - A newer minor may also add VALUES to a closed list (K1 milestone
 *   review R4): an item kind, an order, and the lists of
 *   `tour-stations.ts`. Read from a file of a newer minor, an unknown value
 *   degrades - the item or step is left out, an unknown order offers
 *   every station (`any`, which can never deadlock) - instead of failing
 *   the tour; at this reader's own minor or below it is a broken file.
 * - `tourId` (optional, no minor of its own) is additive in the plain
 *   sense: a reader that does not know it ignores it, and a writer that
 *   does not know it drops it - which costs only the creator's draft its
 *   key on that tour's next open, never the tour. A minor for it would
 *   make every older writer refuse every tour that carries one.
 * - `captureSpots` (the walk's camera captures, which earlier apps baked
 *   into the tour) is no longer part of the format: they are debug data,
 *   never tour content. A file that still carries the field opens without
 *   it, like any unknown field (its stations stay as written), and no write
 *   carries it.
 * Series id and version number do not live here: `manifest.json` is their
 * one place (§8 G7, `tour-signed-manifest.ts`). The `tourId` is not a
 * series id: it is unsigned, names no version, and only keys a creator's
 * on-device draft of a tour opened from a file.
 *
 * @see tour-manifest.ts.md
 */

import { isRecord } from '../utils/json-guards.js';
import { parseGeoPose } from './qr/geo-pose.js';
import type { QrGeoPose } from './qr/qr-gps-vote.js';
import { TOUR_ID_PATTERN } from './tour-archive.js';
import {
  parseTourDetails,
  tourImageIds,
  type TourDetails,
  type TourDetailsDrop,
} from './tour-details.js';
import {
  parseTourContentFields,
  type TourItem,
  type TourModelFields,
  type TourPhotoFields,
  type TourPinFields,
} from './tour-items.js';
import {
  parseTourAssets,
  parseTourStations,
  type TourAsset,
  type TourOrder,
  type TourStation,
  type TourStationDrop,
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
  TourStationDrop,
  TourStep,
  TourStepAdvance,
} from './tour-stations.js';
export type {
  TourItem,
  TourLocalPose,
  TourModelItem,
  TourPhotoItem,
  TourPinItem,
} from './tour-items.js';

/** The manifest's format (major) version this module reads and writes. */
export const TOUR_MANIFEST_VERSION = 3;

/** The newest additive revision of version 3 this module knows. */
export const TOUR_MANIFEST_MINOR = 2;

/** Where a pin, photo or model stands in the WORLD: the view the viewer places
 *  and the creator's drafts hold (`tour-station-pose.ts` `tourObjects`). */
interface TourPlacement {
  /** Exact pose: lat/lon, absolute altitude, rotation against north. */
  readonly geo: QrGeoPose;
  /** The station whose item this is; absent on a creator's draft object
   *  that no station holds yet (the automatic-station rule assigns one). */
  readonly station?: string;
}

/** A text pin, in the world. */
export type TourPin = TourPinFields & TourPlacement;
/** A captured photo, in the world, placed as a plane. */
export type TourPhoto = TourPhotoFields & TourPlacement;
/** A placed 3D model, in the world. */
export type TourModel = TourModelFields & TourPlacement;
export type TourObject = TourPin | TourPhoto | TourModel;
export type TourObjectKind = TourObject['kind'];

export interface TourManifest extends TourDetails {
  version: typeof TOUR_MANIFEST_VERSION;
  /** The additive revision the file was written at (0 when absent). */
  minor: number;
  /** The tour's name, for lists and the visitor's screen. */
  title?: string;
  /**
   * The tour's own id: minted once by the app that first saves the tour,
   * then kept by every save, so a tour opened from a file is known by the
   * same key across saves (a creator's draft is kept under it). Short and
   * path-safe ({@link TOUR_ID_PATTERN}); a bad one reads as none.
   */
  tourId?: string;
  /** Which stations are offered: in order, all at once, or by answer. */
  order: TourOrder;
  /** Media files named by their own ids (§8 G5). */
  assets: TourAsset[];
  /** The stations, each with its pins and photos (no loose ones). */
  stations: TourStation[];
  /**
   * The tour's printed codes place it on their own, so a viewer never asks
   * its visitors for their location and starts without it. Only `true` is
   * kept: `false` and absent both mean "location as usual".
   */
  needsNoGps?: true;
}

/** What a reader left out without failing the tour: a tour detail
 *  (`tour-details.ts`), or a station's description or card image
 *  (`tour-stations.ts`; the one kind that carries `station`, the station's
 *  id). A drop with no `cause` is a malformed value. */
export type TourManifestDrop = TourDetailsDrop | TourStationDrop;

/** How a reader or writer reports what it left out. The tour's details and
 *  a station's description and card image are cosmetic, so a bad one -
 *  malformed, or an image whose picture went - costs the value, never the
 *  tour. The writer accepts only the drops with a `cause` (a picture that
 *  went); a malformed value handed to it fails loud. */
export interface TourManifestReadOptions {
  readonly onDropped?: (drop: TourManifestDrop) => void;
}

const ORDERS: ReadonlySet<string> = new Set(['fixed', 'any', 'branch']);

/** Thrown when a manifest fails validation. */
export class TourManifestValidationError extends Error {
  constructor(message: string) {
    super(`tour-manifest: ${message}`);
    this.name = 'TourManifestValidationError';
  }
}

function fail(message: string): never {
  throw new TourManifestValidationError(message);
}

/** An empty manifest at the current version - the starter zip's content. */
export function createEmptyTourManifest(): TourManifest {
  return {
    version: TOUR_MANIFEST_VERSION,
    minor: 0,
    order: 'fixed',
    assets: [],
    stations: [],
  };
}

/** Every item of every station, in station order. */
export function tourItems(tour: {
  readonly stations: readonly TourStation[];
}): TourItem[] {
  return tour.stations.flatMap((station) => [...station.items]);
}

/**
 * Validate one WORLD-VIEW object (a pin, photo or model with a geo pose,
 * and the station holding it if any): the records a creator's on-device
 * draft keeps between sessions. Throws {@link TourManifestValidationError}.
 * A model's asset is checked for its shape only: a draft record has no
 * assets beside it, and the manifest's write re-validates the reference.
 */
export function parseTourObject(value: unknown, at = 'object'): TourObject {
  const fields = parseTourContentFields(value, at, { fail });
  // Never null: a strict read leaves nothing out.
  if (fields === null) return fail(`"${at}" is of an unknown kind`);
  const record = value as Record<string, unknown>;
  const geo = parseGeoPose(record.geo, { path: `${at}.geo`, fail });
  const { station } = record;
  if (
    station !== undefined &&
    (typeof station !== 'string' || !TOUR_ID_PATTERN.test(station))
  ) {
    fail(`"${at}.station" must be a station id`);
  }
  return {
    ...fields,
    geo,
    ...(station === undefined ? {} : { station }),
  };
}

/** The format version, checked: 3; an older or a newer one is named. */
function checkFormatVersion(value: unknown): void {
  if (value === TOUR_MANIFEST_VERSION) return;
  if (value === 1 || value === 2) {
    fail(
      `this tour is in an older format (version ${String(value)}) that this version of the app no longer opens; it has to be made again`
    );
  }
  if (
    Number.isSafeInteger(value) &&
    (value as number) > TOUR_MANIFEST_VERSION
  ) {
    fail(
      `this tour was made with a newer version of the app (format ${String(value)}); update the app to open it`
    );
  }
  fail(
    `"version" must be ${String(TOUR_MANIFEST_VERSION)}, got ${JSON.stringify(value)}`
  );
}

function minorOf(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`"minor" must be an integer >= 0, got ${JSON.stringify(value)}`);
  }
  return value as number;
}

/** `needsNoGps`: true, or nothing (false and absent read the same). A
 *  non-boolean is a broken file at this reader's minor, and reads as
 *  absent from a newer one. */
function needsNoGpsOf(value: unknown, lenient: boolean): true | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return true;
  if (lenient) return undefined;
  return fail('"needsNoGps" must be true or false');
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

/** One id namespace across the tour's items and assets: an item id is
 *  unique, and no asset has one. A photo's and an asset's ids are their
 *  content files' stems (`content/<id>.<ext>`), and a model names an asset
 *  by id, so a shared id would make a reference ambiguous. */
function checkContentIds(
  stations: readonly TourStation[],
  assets: readonly TourAsset[]
): void {
  const itemIds = new Set<string>();
  for (const item of tourItems({ stations })) {
    if (itemIds.has(item.id)) fail(`duplicate item id "${item.id}"`);
    itemIds.add(item.id);
  }
  assets.forEach((asset, i) => {
    if (itemIds.has(asset.id)) {
      fail(`"assets[${String(i)}].id" "${asset.id}" is already an item id`);
    }
  });
}

/** The tour's id when it is one (the one id rule), else none: the id only
 *  keys a creator's draft, so a bad one costs the id, never the tour - at
 *  every minor. */
function tourIdOf(value: unknown): string | undefined {
  return typeof value === 'string' && TOUR_ID_PATTERN.test(value)
    ? value
    : undefined;
}

/** The title and the tour details, each present only when set. */
function titleAndDetailsOf(
  data: Record<string, unknown>,
  content: Pick<TourManifest, 'stations' | 'assets'>,
  options: TourManifestReadOptions
): Pick<TourManifest, 'title' | 'description' | 'cover' | 'contact'> {
  // Trimmed, as the editor's name field writes it (M4a review #10): an
  // untrimmed title differed from its own field and read as a change.
  const title =
    typeof data.title === 'string' && data.title.trim() !== ''
      ? data.title.trim()
      : undefined;
  // Dropped, never failed, at every minor: the details are cosmetic.
  const { details, dropped } = parseTourDetails(data, {
    imageIds: tourImageIds({
      objects: tourItems(content),
      assets: content.assets,
    }),
  });
  for (const drop of dropped) options.onDropped?.(drop);
  return {
    ...(title === undefined ? {} : { title }),
    ...(details.description === undefined
      ? {}
      : { description: details.description }),
    ...(details.cover === undefined ? {} : { cover: details.cover }),
    ...(details.contact === undefined ? {} : { contact: details.contact }),
  };
}

/**
 * Validate an already-parsed value as a {@link TourManifest}. Throws
 * {@link TourManifestValidationError} naming the first violation.
 */
export function parseTourManifest(
  data: unknown,
  options: TourManifestReadOptions = {}
): TourManifest {
  if (!isRecord(data)) fail('manifest must be a JSON object');
  checkFormatVersion(data.version);
  const minor = minorOf(data.minor);
  const lenient = minor > TOUR_MANIFEST_MINOR;
  const assets = parseTourAssets(data.assets ?? [], { fail, lenient });
  const stations = parseTourStations(data.stations ?? [], {
    assets,
    fail,
    lenient,
    ...(options.onDropped === undefined
      ? {}
      : { onDropped: options.onDropped }),
  });
  checkContentIds(stations, assets);
  const needsNoGps = needsNoGpsOf(data.needsNoGps, lenient);
  const tourId = tourIdOf(data.tourId);
  return {
    version: TOUR_MANIFEST_VERSION,
    minor,
    ...(tourId === undefined ? {} : { tourId }),
    ...titleAndDetailsOf(data, { stations, assets }, options),
    order: orderOf(data.order, lenient),
    assets,
    stations,
    ...(needsNoGps === undefined ? {} : { needsNoGps }),
  };
}

/**
 * Serialize a manifest to the JSON document `parseTourManifest` reads. The
 * input is re-validated first so a programming error fails LOUD here
 * instead of producing a broken file a creator uploads. A manifest of a
 * NEWER minor than {@link TOUR_MANIFEST_MINOR} is refused: it was read with
 * its unknown fields dropped, and writing it back would lose them. Written
 * at the lowest minor the tour needs (see the version policy).
 *
 * Of the details, only a cover whose image went (a deleted photo, the
 * drop's `cause` `image-gone`) is left out, reported through
 * `onDropped`, and so is a station's card image whose picture went
 * (`station-image-gone`). Any other drop - a cover that is not an image
 * id, a description or a contact the reader would drop, a station
 * description or card image that is malformed - is a programming error
 * here (the editor checks them with the same rules) and fails loud.
 */
export function serializeTourManifest(
  manifest: TourManifest,
  options: TourManifestReadOptions = {}
): string {
  // The reader drops a bad id quietly (it is a file's); one handed to the
  // writer is the page's bug, and writing the tour without it would hide
  // that.
  if (
    manifest.tourId !== undefined &&
    tourIdOf(manifest.tourId) === undefined
  ) {
    fail(
      `"tourId" must be 1-64 letters, digits, "_" or "-", got ${JSON.stringify(manifest.tourId)}`
    );
  }
  const parsed = parseTourManifest(manifest, {
    onDropped: (drop) => {
      if (drop.cause !== 'image-gone' && drop.cause !== 'station-image-gone') {
        fail(drop.reason);
      }
      options.onDropped?.(drop);
    },
  });
  if (parsed.minor > TOUR_MANIFEST_MINOR) {
    fail(
      `this tour was made with a newer version of the app (format ${String(TOUR_MANIFEST_VERSION)}.${String(parsed.minor)}); saving it here would drop what this version cannot read`
    );
  }
  return JSON.stringify({ ...parsed, minor: minorNeeded(parsed) }, null, 2);
}

/** The lowest minor that carries the tour: 2 with a station's description
 *  or card image, else 1 with a model, else 0. */
function minorNeeded(manifest: TourManifest): number {
  if (
    manifest.stations.some(
      (s) => s.description !== undefined || s.image !== undefined
    )
  ) {
    return 2;
  }
  return tourItems(manifest).some((item) => item.kind === 'model') ? 1 : 0;
}
