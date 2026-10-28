/**
 * The STATIONS of `tour.json` version 4: each station a geo pose (position
 * and a rotation against north) with two radii, its BLOCKS - what it shows,
 * each at a local pose in the station's frame (`tour-blocks.ts`) - and its
 * STORY, the steps that show some of those blocks, ask choices and quizzes
 * (`tour-story.ts`). A block no step shows is free: it stands in the world
 * while its station is shown. A station may have no steps: an automatic
 * station only groups what was placed there, and finding it completes it.
 * Stations behave as pins: no code link, no code-only station.
 *
 * Every cross-reference resolves here: a block's media names an asset of
 * the right kind, a `show` a block of THIS station, a `goto` a step of this
 * station, and block ids are unique across the whole tour (asset ids are a
 * namespace of their own), so a renderer never meets a dangling id in the
 * middle of a walk. The walk is never branched by answers: a station's
 * `next` and a quiz's `route` are not part of the format (unknown fields,
 * ignored).
 *
 * Defensive by the rule of `tour-manifest.ts`: hand-editable external data,
 * every field checked at the boundary. Unknown fields are ignored, which is
 * the version policy of `tour-manifest.ts`. The caller's `fail` throws its
 * own validation error (the manifest's), so this module needs no error
 * class and no import of its parent (`check:cycles`).
 *
 * LENIENT for a NEWER MINOR: what this reader cannot show is skipped by the
 * block and story readers (see theirs), an unknown hint is the arrow; what
 * a renderer meets still resolves. At the reader's own minor or below the
 * same value is a broken file and fails.
 *
 * @see tour-stations.ts.md
 */

import { isFiniteNumber, isRecord } from '../utils/json-guards.js';
import { parseGeoPose } from './qr/geo-pose.js';
import type { QrGeoPose } from './qr/qr-gps-vote.js';
import type { TourAsset } from './tour-assets.js';
import {
  checkTourBlockIdsUnique,
  type TourBlock,
  type TourBlockDrop,
} from './tour-blocks.js';
import {
  checkTourDescription,
  TOUR_DESCRIPTION_MAX_CHARS,
  tourImageIds,
} from './tour-details.js';
import {
  assertUniqueTourIds,
  isTourId,
  requireTourArray,
  requireTourId,
  tourTextOf,
  type TourFail,
} from './tour-fields.js';
import { parseTourStationContent, type TourStep } from './tour-story.js';

/**
 * A station's description or card image the reader left out, the tour
 * details' model: a malformed value carries no `cause`, and a writer
 * refuses it (the editor checks with the same rules, so one reaching the
 * writer is a programming error). A well-formed card image naming no image
 * asset of the tour (a deleted photo or asset) carries `station-image-gone`:
 * the one station drop a writer accepts quietly, beside the cover's
 * `image-gone`, so deleting the photo a card shows never fails a save.
 */
export interface TourStationDrop {
  readonly field: 'description' | 'image';
  /** The id of the station whose value was left out. */
  readonly station: string;
  readonly reason: string;
  /** Absent: the value is malformed. */
  readonly cause?: 'station-image-gone';
}

export type TourOrder = 'fixed' | 'any';

export interface TourStation {
  readonly id: string;
  readonly title?: string;
  /** A few sentences for the station's card, trimmed, line breaks kept, at
   *  most {@link TOUR_DESCRIPTION_MAX_CHARS} characters (the tour
   *  description's rule, `checkTourDescription`). */
  readonly description?: string;
  /** The station's card image: the id of an image asset of the tour. */
  readonly image?: string;
  /** Where the station is and how it is turned against north: the frame
   *  its blocks' local poses are relative to. */
  readonly geo: QrGeoPose;
  readonly activateRadiusM: number;
  readonly foundRadiusM: number;
  /** The HUD's exact arrow plus distance (the only hint mode). */
  readonly hint: 'arrow';
  /** What the station shows: its free blocks (no step shows them; they
   *  stand in the world) and its story blocks (a `show` step names them),
   *  in the file's order. */
  readonly blocks: readonly TourBlock[];
  /** The station's story; may be empty. */
  readonly steps: readonly TourStep[];
}

/** How the stations are read: the tour's (already validated) assets, the
 *  caller's `fail`, a newer minor (`lenient`), and who hears what was
 *  left out (a station's description or card image, or a block or one of
 *  its fields). */
export interface TourStationsReadOptions {
  readonly assets: readonly TourAsset[];
  readonly fail: TourFail;
  readonly lenient?: boolean;
  readonly onDropped?: (drop: TourStationDrop | TourBlockDrop) => void;
}

function parseRadii(
  v: Record<string, unknown>,
  at: string,
  fail: TourFail
): { activateRadiusM: number; foundRadiusM: number } {
  const { activateRadiusM, foundRadiusM } = v;
  for (const [name, r] of [
    ['activateRadiusM', activateRadiusM],
    ['foundRadiusM', foundRadiusM],
  ] as const) {
    if (!isFiniteNumber(r) || r <= 0)
      fail(`"${at}.${name}" must be a number of metres > 0`);
  }
  const activate = activateRadiusM as number;
  const found = foundRadiusM as number;
  if (found > activate) {
    fail(`"${at}.foundRadiusM" must not exceed "activateRadiusM"`);
  }
  return { activateRadiusM: activate, foundRadiusM: found };
}

interface StationContext {
  readonly id: string;
  readonly at: string;
  readonly lenient: boolean;
  readonly onDropped: TourStationsReadOptions['onDropped'];
}

/**
 * A station's description by the tour description's rule
 * (`checkTourDescription`: trimmed, at most
 * {@link TOUR_DESCRIPTION_MAX_CHARS} characters), so what an editor's field
 * accepts is what a reader keeps. A blank one is none, as a blank title.
 * Any other value is dropped, never failing the tour (a refused tour could
 * not even be opened to fix it): reported with no cause at this reader's
 * minor, silently in a file of a newer minor (which may widen the rule).
 */
function descriptionOf(
  value: unknown,
  ctx: StationContext
): { description?: string } {
  if (value === undefined) return {};
  if (typeof value === 'string' && value.trim() === '') return {};
  const checked = checkTourDescription(value);
  if (checked.ok) return { description: checked.value };
  if (!ctx.lenient) {
    ctx.onDropped?.({
      field: 'description',
      station: ctx.id,
      reason: `"${ctx.at}.description" must be text of at most ${String(TOUR_DESCRIPTION_MAX_CHARS)} characters`,
    });
  }
  return {};
}

/**
 * A station's card image: an id naming an image asset of the tour. Never a
 * failure, and at this reader's minor always reported: a well-formed id
 * naming none (the photo or asset was deleted) as `station-image-gone`, a
 * value that is not an id with no cause. In a file of a newer minor either
 * is left out silently: that minor may widen the rule, and the picture may
 * be one this reader skipped (a newer media type), which is not gone.
 */
function imageOf(
  value: unknown,
  images: ReadonlySet<string>,
  ctx: StationContext
): { image?: string } {
  if (value === undefined) return {};
  if (isTourId(value) && images.has(value)) return { image: value };
  if (ctx.lenient) return {};
  const at = `${ctx.at}.image`;
  ctx.onDropped?.(
    isTourId(value)
      ? {
          field: 'image',
          station: ctx.id,
          reason: `"${at}" names no image of this tour`,
          cause: 'station-image-gone',
        }
      : {
          field: 'image',
          station: ctx.id,
          reason: `"${at}" must be an image id`,
        }
  );
  return {};
}

function parseStation(
  value: unknown,
  at: string,
  options: TourStationsReadOptions,
  images: ReadonlySet<string>
): TourStation {
  const { fail } = options;
  const lenient = options.lenient === true;
  if (!isRecord(value)) return fail(`"${at}" must be an object`);
  // A newer minor's hint mode falls back to the arrow.
  if (value.hint !== undefined && value.hint !== 'arrow' && !lenient) {
    fail(`"${at}.hint" must be "arrow"`);
  }
  const id = requireTourId(value.id, `${at}.id`, fail);
  const ctx: StationContext = {
    id,
    at,
    lenient,
    onDropped: options.onDropped,
  };
  const title = tourTextOf(value.title);
  const content = parseTourStationContent(value, at, {
    assets: options.assets,
    fail,
    lenient,
    ...(options.onDropped === undefined
      ? {}
      : { onDropped: options.onDropped }),
  });
  return {
    id,
    ...(title === undefined ? {} : { title }),
    ...descriptionOf(value.description, ctx),
    ...imageOf(value.image, images, ctx),
    geo: parseGeoPose(value.geo, { path: `${at}.geo`, fail }),
    ...parseRadii(value, at, fail),
    hint: 'arrow',
    blocks: content.blocks,
    steps: content.steps,
  };
}

/**
 * Validate the tour's stations against its (already validated) assets.
 * Station ids are unique; block ids are unique across the tour; step ids
 * are unique per station; every reference resolves (see the module
 * comment). `lenient` (a newer minor) skips what this reader cannot show
 * instead of failing. `onDropped` hears each station description or card
 * image left out ({@link TourStationDrop}), and each block or block field
 * a reader left out (`TourBlockDrop`); none fails the tour.
 */
export function parseTourStations(
  value: unknown,
  options: TourStationsReadOptions
): TourStation[] {
  const { fail } = options;
  const images = tourImageIds({ objects: [], assets: options.assets });
  const stations = requireTourArray(value, 'stations', fail).map((s, i) =>
    parseStation(s, `stations[${String(i)}]`, options, images)
  );
  assertUniqueTourIds(
    stations.map((s) => s.id),
    'station',
    fail
  );
  checkTourBlockIdsUnique(stations, fail);
  return stations;
}
