/**
 * A tour's recurring CHARACTERS (`tour.json` version 4, minor 2): declared
 * once for the whole tour - an id, a name, a cut-out image and, optionally,
 * a sheet of his four poses (`frames`) - and named
 * by the `character` blocks of any station (`tour-blocks.ts`, the block's
 * `character` field). A block that names one takes its name and image from
 * here; the writer keeps the block's own inline name and image as well, in
 * step with the declaration, so a reader of an older minor (which knows no
 * declaration) still shows him by name.
 *
 * Defensive by the rule of `tour-manifest.ts`: an id is structural and
 * fails at every minor; a name over its cap, or an image that is not an
 * image asset, fails a file of this reader's own minor and, read from a
 * newer one, leaves out just that declaration (reported). Character ids
 * are a namespace of their own (blocks and assets each have theirs).
 *
 * @see tour-characters.ts.md
 */

import { isRecord } from '../utils/json-guards.js';
import type { TourAsset } from './tour-assets.js';
import { checkTourBlockText, TOUR_BLOCK_TEXT_RULES } from './tour-blocks.js';

export { TOUR_CHARACTER_VIEWS, type TourCharacterView } from './tour-blocks.js';
import {
  assertUniqueTourIds,
  requireTourId,
  type TourFail,
} from './tour-fields.js';

/** One declared character. */
export interface TourCharacter {
  readonly id: string;
  /** 1-80 characters, the block's own rule. */
  readonly name: string;
  /** A cut-out image asset: his one pose, and the fallback when no sheet
   *  is declared (no talking or beckoning frames then). */
  readonly image: string;
  /** An image asset holding his four poses as a CANONICAL sheet: four
   *  equal cells in one row, in the order of `TOUR_CHARACTER_FRAMES`, on
   *  a transparent background, every figure centred in its cell with his
   *  feet on one common baseline. A reader slices it into equal cells and
   *  trusts that layout. */
  readonly frames?: string;
}

/**
 * The poses of a character's frames sheet, left to right: standing idle,
 * mouth half open, mouth open, and beckoning (one arm out to the VIEWER'S
 * RIGHT with an open hand; a viewer mirrors it toward a station on the
 * left).
 */
export const TOUR_CHARACTER_FRAMES = [
  'idle',
  'talk-a',
  'talk-b',
  'beckon',
] as const;

/** The most characters one tour declares. */
const TOUR_MAX_CHARACTERS = 32;

/** What a lenient reader left out of a declaration: the whole declaration
 *  when `field` is absent, or just that field (`characters[i].frames`)
 *  when present - he then stays, with what was readable. */
export interface TourCharacterDrop {
  readonly kind: 'character';
  readonly character: string;
  readonly field?: string;
  readonly reason: string;
}

export interface TourCharactersReadOptions {
  /** The tour's (already validated) assets. */
  readonly assets: readonly TourAsset[];
  readonly fail: TourFail;
  /** A newer minor: what breaks a rule a later minor may relax is left out. */
  readonly lenient?: boolean;
  readonly onDropped?: (drop: TourCharacterDrop) => void;
}

/**
 * Read the tour's `characters` (`value`): absent or empty is none. Throws
 * through `fail` naming the first violation; a lenient reader leaves out
 * (and reports) a declaration whose name or image it cannot take.
 */
export function parseTourCharacters(
  value: unknown,
  options: TourCharactersReadOptions
): TourCharacter[] {
  const { fail } = options;
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail('"characters" must be an array');
  const images = new Set(
    options.assets.filter((a) => a.kind === 'image').map((a) => a.id)
  );
  const list = value as unknown[];
  const ids: string[] = [];
  const read = list.flatMap((entry, i): TourCharacter[] => {
    const at = `characters[${String(i)}]`;
    if (!isRecord(entry)) return fail(`"${at}" must be an object`);
    const id = requireTourId(entry.id, `${at}.id`, fail);
    ids.push(id);
    const why = problemOf(entry, at, images, i);
    if (why !== null) {
      if (options.lenient !== true) return fail(why);
      options.onDropped?.({ kind: 'character', character: id, reason: why });
      return [];
    }
    const character: TourCharacter = {
      id,
      name: entry.name as string,
      image: entry.image as string,
    };
    if (entry.frames === undefined) return [character];
    const sheet = sheetProblemOf(entry.frames, character.image, at, images);
    if (sheet === null) {
      return [{ ...character, frames: entry.frames as string }];
    }
    // A sheet this reader cannot take: a newer minor may describe it
    // otherwise, and he still stands with his one image - so only the
    // field is left out.
    if (options.lenient !== true) return fail(sheet);
    options.onDropped?.({
      kind: 'character',
      character: id,
      field: `${at}.frames`,
      reason: sheet,
    });
    return [character];
  });
  assertUniqueTourIds(ids, 'character', fail);
  return read;
}

/** Why a declaration's `frames` is no sheet this reader takes, or null: it
 *  must name an image asset other than his one image (a sheet that is his
 *  one pose would be sliced into four quarters of it). */
function sheetProblemOf(
  frames: unknown,
  image: string,
  at: string,
  images: ReadonlySet<string>
): string | null {
  if (typeof frames !== 'string' || !images.has(frames)) {
    return `"${at}.frames" must name an image asset`;
  }
  if (frames === image) {
    return `"${at}.frames" must name an image other than "${at}.image"`;
  }
  return null;
}

/** Why a declaration breaks a rule a later minor may relax, or null. */
function problemOf(
  entry: Readonly<Record<string, unknown>>,
  at: string,
  images: ReadonlySet<string>,
  index: number
): string | null {
  if (index >= TOUR_MAX_CHARACTERS) {
    return `"characters" must hold at most ${String(TOUR_MAX_CHARACTERS)} characters`;
  }
  const name = checkTourBlockText(
    TOUR_BLOCK_TEXT_RULES.character.name,
    entry.name
  );
  if (!name.ok) return `"${at}.name" ${name.reason}`;
  if (typeof entry.image !== 'string' || !images.has(entry.image)) {
    return `"${at}.image" must name an image asset`;
  }
  return null;
}
