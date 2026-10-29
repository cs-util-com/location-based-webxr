/**
 * A tour's recurring CHARACTERS (`tour.json` version 4, minor 2): declared
 * once for the whole tour - an id, a name and a cut-out image - and named
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
  /** A cut-out image asset. */
  readonly image: string;
}

/** The most characters one tour declares. */
const TOUR_MAX_CHARACTERS = 32;

/** A declaration a lenient reader left out. */
export interface TourCharacterDrop {
  readonly kind: 'character';
  readonly character: string;
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
    if (why === null) {
      return [{ id, name: entry.name as string, image: entry.image as string }];
    }
    if (options.lenient !== true) return fail(why);
    options.onDropped?.({ kind: 'character', character: id, reason: why });
    return [];
  });
  assertUniqueTourIds(ids, 'character', fail);
  return read;
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
