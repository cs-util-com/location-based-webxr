/**
 * The tour manifest (`tour.json`): what a creator placed in a tour, as
 * records a visitor's viewer renders.
 *
 * VERSION 4 (a MAJOR): a tour is media ASSETS (`tour-assets.ts`) and
 * STATIONS (`tour-stations.ts`). A station carries the exact geo pose -
 * latitude, longitude, absolute altitude and a rotation against north -
 * and its BLOCKS (`tour-blocks.ts`) carry LOCAL poses relative to it, so a
 * station moves rigidly with all it holds. A block is one thing a station
 * shows - a short text, a long text, a picture, a video, a sound, a 3D
 * model, a character - in a VIEW the creator chose; a station's STORY
 * (`tour-story.ts`) shows some of its blocks step by step, and the others
 * are FREE: they stand in the world (a pin, a picture's plane, a placed
 * model) while the station is shown. Every media file is an asset, a
 * captured photo's too (its bytes stay at `content/<id>.<ext>`), and block
 * and asset ids are separate namespaces: every reference says which kind
 * it names. `tour-station-pose.ts` converts local poses to geo poses and
 * back and gives the WORLD VIEW (`tourObjects`): every free block with its
 * geo pose, which the viewer places and a creator's drafts hold.
 *
 * Defensive by the same rule as `qr/qr-level.ts`: the file is external,
 * hand-editable data, every field is validated at the boundary, and the
 * writer re-validates through the reader so a programming error fails
 * loud here instead of producing a file a visitor cannot open.
 *
 * VERSION POLICY:
 * - `version` is the format's major number. Version 4 is the only one this
 *   reader opens. Versions 1, 2 and 3 are NOT migrated: they are refused
 *   with a message saying the tour is in an older format and has to be
 *   made again ({@link TourManifestOlderFormatError}, so a page can also
 *   remove what it kept for that tour). A version above 4 is refused with
 *   a message naming the newer format, never guessed at ("update the app").
 * - `minor` (default 0) counts ADDITIVE revisions of version 4. A reader
 *   opens a tour of any minor and ignores the fields it does not know -
 *   unknown fields are ignored at every minor, so a typo in a hand-edited
 *   optional field reads as absent - but the WRITER refuses a tour of a
 *   newer minor than its own: rewriting it would silently drop what this
 *   version cannot read. The writer writes the LOWEST minor the tour needs
 *   (`tourBlocksMinor`), so a tour an older reader can open fully is never
 *   marked newer than it is. Minor 1 added a model's world views besides
 *   `placed` (`ghost`, `hotspots`, `cutaway`, `toy`) and its `animation`,
 *   `annotations` (notes) and `sections`; a reader of this version accepts
 *   them in a file of any minor.
 * - A newer minor may also add VALUES to a closed list: a block kind or
 *   view, an order, an advance mode, an asset's media type. Read from a
 *   file of a newer minor, an unknown value degrades - the block or step
 *   is left out or falls back to a view this reader draws, an unknown
 *   order offers every station (`any`, which can never deadlock) - instead
 *   of failing the tour; at this reader's own minor or below it is a
 *   broken file.
 * - `tourId` (optional, no minor of its own) is additive in the plain
 *   sense: a reader that does not know it ignores it, and a writer that
 *   does not know it drops it - which costs only the creator's draft its
 *   key on that tour's next open, never the tour.
 * - `captureSpots` (the walk's camera captures, which earlier apps baked
 *   into the tour) is not part of the format: they are debug data, never
 *   tour content. A file that still carries the field opens without it,
 *   like any unknown field, and no write carries it.
 * Series id and version number do not live here: `manifest.json` is their
 * one place (`tour-signed-manifest.ts`). The `tourId` is not a series id:
 * it is unsigned, names no version, and only keys a creator's on-device
 * draft of a tour opened from a file.
 *
 * @see tour-manifest.ts.md
 */

import { isRecord } from '../utils/json-guards.js';
import { parseGeoPose } from './qr/geo-pose.js';
import type { QrGeoPose } from './qr/qr-gps-vote.js';
import { TOUR_ID_PATTERN } from './tour-archive.js';
import {
  parseTourAsset,
  parseTourAssets,
  type TourAsset,
} from './tour-assets.js';
import {
  placeTourBlocks,
  readTourBlocks,
  tourBlocksMinor,
  type TourBlockDrop,
  type TourModelBlock,
  type TourModelWorldView,
  type TourPictureBlock,
  type TourShortTextBlock,
} from './tour-blocks.js';
import {
  parseTourDetails,
  tourImageIds,
  type TourDetails,
  type TourDetailsDrop,
} from './tour-details.js';
import { isTourId } from './tour-fields.js';
import type { TourLocalPose } from './tour-items.js';
import {
  parseTourStations,
  type TourOrder,
  type TourStation,
  type TourStationDrop,
} from './tour-stations.js';

export type { TourAsset, TourAssetKind } from './tour-assets.js';
export type {
  TourAudioBlock,
  TourBlock,
  TourBlockDrop,
  TourBlockKind,
  TourBlockView,
  TourCharacterBlock,
  TourLongTextBlock,
  TourModelAnimation,
  TourModelBlock,
  TourModelNote,
  TourModelSection,
  TourModelVector,
  TourModelWorldView,
  TourPictureBlock,
  TourShortTextBlock,
  TourVideoBlock,
} from './tour-blocks.js';
export type { TourLocalPose } from './tour-items.js';
export type {
  TourOrder,
  TourStation,
  TourStationDrop,
} from './tour-stations.js';
export type {
  TourChoiceOption,
  TourQuiz,
  TourQuizAnswer,
  TourQuizOption,
  TourStep,
  TourStepAction,
  TourStepAdvance,
} from './tour-story.js';

/** The manifest's format (major) version this module reads and writes. */
export const TOUR_MANIFEST_VERSION = 4;

/** The newest additive revision of version 4 this module knows. */
export const TOUR_MANIFEST_MINOR = 1;

/** Where a free block stands in the WORLD: the view the viewer places and
 *  the creator's drafts hold (`tour-station-pose.ts` `tourObjects`). */
interface TourPlacement {
  /** Exact pose: lat/lon, absolute altitude, rotation against north. */
  readonly geo: QrGeoPose;
  /** The station whose block this is; absent on a creator's draft object
   *  that no station holds yet (the automatic-station rule assigns one). */
  readonly station?: string;
}

/** A free block in the world: its fields without the local pose, and
 *  where it stands. */
type InWorld<B> = Omit<B, 'pose'> & TourPlacement;

/** A short text in the world, drawn as a pin. */
export type TourPin = InWorld<TourShortTextBlock> & { readonly view: 'pin' };
/**
 * A picture in the world, drawn as a plane, with its image asset inline
 * (`imageAsset.id === image`): the page that captured a photo holds its
 * asset before any tour lists it, and every page drawing or saving the
 * picture needs the file it names.
 */
export type TourPicture = InWorld<TourPictureBlock> & {
  readonly view: 'plane';
  readonly imageAsset: TourAsset;
};
/** A 3D model in the world at its size, in one of its world views. */
export type TourModel = InWorld<TourModelBlock> & {
  readonly view: TourModelWorldView;
  readonly sizeM: number;
};
export type TourObject = TourPin | TourPicture | TourModel;
export type TourObjectKind = TourObject['kind'];

/** The draft record's format: what `tourObjectRecord` writes and
 *  `parseTourObject` reads (a record of another format reads as none). */
export const TOUR_OBJECT_RECORD_FORMAT = 4;

/**
 * A world-view object as a creator's on-device draft stores it: its block
 * (without a local pose: the record carries the geo pose), the asset entry
 * of a picture (the file a captured photo minted), its geo pose and its
 * station.
 */
export interface TourObjectRecord {
  readonly format: typeof TOUR_OBJECT_RECORD_FORMAT;
  readonly block: Record<string, unknown>;
  readonly asset?: {
    readonly id: string;
    readonly path: string;
    readonly width?: number;
    readonly height?: number;
  };
  readonly geo: QrGeoPose;
  readonly station?: string;
}

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
  /** Which stations are offered: in order, or all at once. */
  order: TourOrder;
  /** Media files named by their own ids. */
  assets: TourAsset[];
  /** The stations, each with its blocks and its story. */
  stations: TourStation[];
  /**
   * The tour's printed codes place it on their own, so a viewer never asks
   * its visitors for their location and starts without it. Only `true` is
   * kept: `false` and absent both mean "location as usual".
   */
  needsNoGps?: true;
}

/** What a reader left out without failing the tour: a tour detail
 *  (`tour-details.ts`), a station's description or card image
 *  (`tour-stations.ts`; the kind that carries `station`, the station's
 *  id), or a block or one of its fields (`tour-blocks.ts`; the kind that
 *  carries `block`). A drop with no `cause` is not one a writer accepts. */
export type TourManifestDrop =
  TourDetailsDrop | TourStationDrop | TourBlockDrop;

/** How a reader or writer reports what it left out. The tour's details, a
 *  station's description and card image, and a block's optional texts are
 *  cosmetic, so a bad one costs the value, never the tour. The writer
 *  accepts only the drops with a `cause` (a picture that went); anything
 *  else handed to it fails loud. */
export interface TourManifestReadOptions {
  readonly onDropped?: (drop: TourManifestDrop) => void;
}

const ORDERS: ReadonlySet<string> = new Set(['fixed', 'any']);

/** Thrown when a manifest fails validation. */
export class TourManifestValidationError extends Error {
  constructor(message: string) {
    super(`tour-manifest: ${message}`);
    this.name = 'TourManifestValidationError';
  }
}

/**
 * Thrown for a tour in an older format this reader no longer opens
 * (versions 1 to 3): a page that kept something for that tour (a creator's
 * unsaved draft) can remove it, and say so, by this type.
 */
export class TourManifestOlderFormatError extends TourManifestValidationError {
  /** The file's format version. */
  readonly version: number;
  constructor(version: number) {
    super(
      `this tour is in an older format (version ${String(version)}) that this version of the app no longer opens; it has to be made again`
    );
    this.name = 'TourManifestOlderFormatError';
    this.version = version;
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

const IDENTITY_POSE: TourLocalPose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
};

/** The record's asset entry: the picture's own, read by the manifest's
 *  asset rules; for a model, an entry the record does not store, so its
 *  block reads (the model's file is the tour's asset, checked when the
 *  tour is written). */
function recordAssets(
  record: Record<string, unknown>,
  block: Record<string, unknown>,
  at: string
): TourAsset[] {
  if (block.kind === 'picture') {
    const asset = parseTourAsset(record.asset, `${at}.asset`, { fail });
    if (asset?.kind !== 'image' || asset.id !== block.image) {
      fail(`"${at}.asset" must be the image asset its picture names`);
    }
    return [asset];
  }
  if (record.asset !== undefined) {
    fail(`"${at}.asset" is only for a picture`);
  }
  return block.kind === 'model' && isTourId(block.asset)
    ? [{ id: block.asset, path: `content/${block.asset}.glb`, kind: 'model' }]
    : [];
}

/** A record's station: absent, or a station id. */
function recordStation(station: unknown, at: string): string | undefined {
  if (station === undefined || isTourId(station)) return station;
  return fail(`"${at}.station" must be a station id`);
}

/**
 * Validate one WORLD-VIEW object as a creator's on-device draft stores it
 * ({@link TourObjectRecord}: a free block in a world view, its picture's
 * asset entry, its geo pose and its station). Every rule is the block's
 * own (`tour-blocks.ts`), strictly: a record whose optional text a reader
 * would leave out fails too, so a draft never holds what a save would
 * refuse. Throws {@link TourManifestValidationError}. A model's asset is
 * checked for its shape only: the record has no tour beside it, and the
 * manifest's write re-validates the reference.
 */
export function parseTourObject(value: unknown, at = 'object'): TourObject {
  if (!isRecord(value)) return fail(`"${at}" must be an object`);
  if (value.format !== TOUR_OBJECT_RECORD_FORMAT) {
    fail(`"${at}.format" must be ${String(TOUR_OBJECT_RECORD_FORMAT)}`);
  }
  const { block } = value;
  if (!isRecord(block)) return fail(`"${at}.block" must be an object`);
  const assets = recordAssets(value, block, at);
  const options = {
    assets,
    fail,
    onDropped: (drop: TourBlockDrop) => fail(drop.reason),
  };
  const read = readTourBlocks([{ ...block, pose: IDENTITY_POSE }], at, options);
  // Shown by no step: it must stand in the world.
  const [placed] = placeTourBlocks(read, new Set(), options);
  if (placed === undefined) return fail(`"${at}.block" must be a block`);
  const geo = parseGeoPose(value.geo, { path: `${at}.geo`, fail });
  const station = recordStation(value.station, at);
  const { pose: _pose, ...fields } = placed;
  const [imageAsset] = placed.kind === 'picture' ? assets : [];
  return {
    ...fields,
    geo,
    ...(station === undefined ? {} : { station }),
    ...(imageAsset === undefined ? {} : { imageAsset }),
  } as TourObject;
}

/** An object as a creator's draft stores it ({@link TourObjectRecord}),
 *  read back by {@link parseTourObject}. */
export function tourObjectRecord(object: TourObject): TourObjectRecord {
  const { geo, station, ...rest } = object;
  const { imageAsset, ...block } = rest as typeof rest & {
    imageAsset?: TourAsset;
  };
  return {
    format: TOUR_OBJECT_RECORD_FORMAT,
    block,
    ...(imageAsset === undefined
      ? {}
      : {
          asset: {
            id: imageAsset.id,
            path: imageAsset.path,
            ...(imageAsset.width === undefined
              ? {}
              : { width: imageAsset.width, height: imageAsset.height }),
          },
        }),
    geo,
    ...(station === undefined ? {} : { station }),
  };
}

/** The format version, checked: 4; an older or a newer one is named. */
function checkFormatVersion(value: unknown): void {
  if (value === TOUR_MANIFEST_VERSION) return;
  if (value === 1 || value === 2 || value === 3) {
    throw new TourManifestOlderFormatError(value);
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
    // An order earlier apps read: said in words a creator can act on.
    if (value === 'branch') {
      fail(
        'this tour lets answers choose the next station, which this version of the app no longer does; change its order to fixed or any'
      );
    }
    fail('"order" must be "fixed" or "any"');
  }
  return value as TourOrder;
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
  assets: readonly TourAsset[],
  options: TourManifestReadOptions
): Pick<TourManifest, 'title' | 'description' | 'cover' | 'contact'> {
  // Trimmed, as the editor's name field writes it: an untrimmed title
  // differed from its own field and read as a change.
  const title =
    typeof data.title === 'string' && data.title.trim() !== ''
      ? data.title.trim()
      : undefined;
  // Dropped, never failed, at every minor: the details are cosmetic.
  const { details, dropped } = parseTourDetails(data, {
    imageIds: tourImageIds({ objects: [], assets }),
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
 * {@link TourManifestValidationError} naming the first violation (a
 * {@link TourManifestOlderFormatError} for versions 1 to 3).
 */
export function parseTourManifest(
  data: unknown,
  options: TourManifestReadOptions = {}
): TourManifest {
  if (!isRecord(data)) return fail('manifest must be a JSON object');
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
  const needsNoGps = needsNoGpsOf(data.needsNoGps, lenient);
  const tourId = tourIdOf(data.tourId);
  return {
    version: TOUR_MANIFEST_VERSION,
    minor,
    ...(tourId === undefined ? {} : { tourId }),
    ...titleAndDetailsOf(data, assets, options),
    order: orderOf(data.order, lenient),
    assets,
    stations,
    ...(needsNoGps === undefined ? {} : { needsNoGps }),
  };
}

/** Whether a writer accepts a drop quietly: a cover, or a station's card
 *  image, whose picture went (a deleted photo). */
function isGonePicture(drop: TourManifestDrop): boolean {
  return (
    'cause' in drop &&
    (drop.cause === 'image-gone' || drop.cause === 'station-image-gone')
  );
}

/**
 * Serialize a manifest to the JSON document `parseTourManifest` reads. The
 * input is re-validated first so a programming error fails LOUD here
 * instead of producing a broken file a creator uploads. A manifest of a
 * NEWER minor than {@link TOUR_MANIFEST_MINOR} is refused: it was read with
 * its unknown fields dropped, and writing it back would lose them. Written
 * at the lowest minor the tour needs (see the version policy).
 *
 * Only a cover or a station's card image whose image went (a deleted
 * photo, the drop's `cause`) is left out, reported through `onDropped`.
 * Any other drop - a cover that is not an image id, a description or a
 * contact the reader would drop, a station description that is malformed,
 * a block's optional text over its cap - is a programming error here (the
 * editor checks them with the same rules) and fails loud.
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
      if (!isGonePicture(drop)) fail(drop.reason);
      options.onDropped?.(drop);
    },
  });
  if (parsed.minor > TOUR_MANIFEST_MINOR) {
    fail(
      `this tour was made with a newer version of the app (format ${String(TOUR_MANIFEST_VERSION)}.${String(parsed.minor)}); saving it here would drop what this version cannot read`
    );
  }
  const minor = tourBlocksMinor(parsed.stations.flatMap((s) => s.blocks));
  return JSON.stringify({ ...parsed, minor }, null, 2);
}
