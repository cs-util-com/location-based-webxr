/**
 * The tour's declared characters as the tour document edits them: the
 * rules a declaration must keep before the document takes it, the words a
 * page shows when it does not, how many changes a list of them is against
 * the written file, and how a draft's settings record reads them back.
 * Pure; the reducer glue lives in `tour-document.ts`.
 *
 * @see declared-characters.ts.md
 */

import {
  checkTourBlockText,
  TOUR_BLOCK_TEXT_RULES,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import { TOUR_ID_PATTERN } from "gps-plus-slam-app-framework/ar/tour-archive";
import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { sameJson } from "./same-json.js";

/** The most characters one tour declares (the format's own cap). */
export const MAX_TOUR_CHARACTERS = 32;

/** Why the document would not take `character` into `declared`, in words
 *  a page shows; null when it would. `heldImages`: the ids of the image
 *  files the tour holds (written and brought in). */
export function characterDeclareRefusal(
  declared: readonly TourCharacter[],
  character: TourCharacter,
  heldImages: ReadonlySet<string>,
): string | null {
  if (!TOUR_ID_PATTERN.test(character.id)) {
    return "This character has no id a tour can carry.";
  }
  // The tour mints each id, so the same character added again comes with
  // a new one: the same four poses (one file, named by its bytes) tell.
  const same = declared.find(
    (c) =>
      c.id === character.id ||
      (c.frames !== undefined && c.frames === character.frames),
  );
  if (same !== undefined) {
    return `${same.name} is in this tour already.`;
  }
  if (declared.length >= MAX_TOUR_CHARACTERS) {
    return `A tour holds at most ${String(MAX_TOUR_CHARACTERS)} characters.`;
  }
  const name = checkTourBlockText(
    TOUR_BLOCK_TEXT_RULES.character.name,
    character.name,
  );
  if (!name.ok) return `The character's name ${name.reason}.`;
  if (!heldImages.has(character.image)) {
    return "The character's picture is not in this tour.";
  }
  if (character.frames !== undefined) {
    if (character.frames === character.image) {
      return "The character's four poses must be a picture of their own.";
    }
    if (!heldImages.has(character.frames)) {
      return "The character's four poses are not in this tour.";
    }
  }
  return null;
}

/** A draft's characters as a restore takes them: each whose picture (and
 *  four poses) the tour holds, once per id, at most the format's cap. One
 *  whose four poses alone the tour lacks (a draft that lost that one file)
 *  is kept without them, which the format allows: dropping him would leave
 *  every item naming him dangling. The declare brings the four poses in
 *  first and the picture second, so a draft that ran out of room between
 *  the two lacks the picture instead: that declaration is dropped, and the
 *  items naming him with it. */
export function restoredCharacters(
  recorded: readonly TourCharacter[],
  held: ReadonlySet<string>,
): TourCharacter[] {
  const kept: TourCharacter[] = [];
  for (const character of recorded) {
    const sheetLost =
      character.frames !== undefined && !held.has(character.frames);
    const taken: TourCharacter = sheetLost
      ? { id: character.id, name: character.name, image: character.image }
      : character;
    if (characterDeclareRefusal(kept, taken, held) === null) kept.push(taken);
  }
  return kept;
}

/** How many changes lead from `written`'s characters to `now`: each one
 *  added, each one gone, each one whose declaration differs. */
export function characterChanges(
  written: readonly TourCharacter[],
  now: readonly TourCharacter[],
): number {
  const was = new Map(written.map((c) => [c.id, c]));
  const ids = new Set(now.map((c) => c.id));
  const changed = now.filter((c) => {
    const other = was.get(c.id);
    return other === undefined || !sameJson(other, c);
  }).length;
  return changed + written.filter((c) => !ids.has(c.id)).length;
}

/** `manifest` with `characters` as its declarations (none: the field
 *  left out, as the format writes it). The same manifest when they agree. */
export function withCharacters(
  manifest: TourManifest,
  characters: readonly TourCharacter[],
): TourManifest {
  if (sameJson(manifest.characters ?? [], characters)) return manifest;
  if (characters.length > 0) {
    return { ...manifest, characters: [...characters] };
  }
  const copy = { ...manifest };
  delete copy.characters;
  return copy;
}

/** The images `characters` name: each one's picture and four poses. */
export function characterImageIds(
  characters: readonly TourCharacter[],
): string[] {
  return characters.flatMap((c) =>
    c.frames === undefined ? [c.image] : [c.image, c.frames],
  );
}

const isTourId = (v: unknown): v is string =>
  typeof v === "string" && TOUR_ID_PATTERN.test(v);

/** One stored entry as a declaration, or null where it does not read. */
function recordedCharacter(entry: unknown): TourCharacter | null {
  if (entry === null || typeof entry !== "object") return null;
  const { id, name, image, frames } = entry as Record<string, unknown>;
  if (!isTourId(id) || !isTourId(image)) return null;
  if (frames !== undefined && !isTourId(frames)) return null;
  if (!checkTourBlockText(TOUR_BLOCK_TEXT_RULES.character.name, name).ok) {
    return null;
  }
  return {
    id,
    name: name as string,
    image,
    ...(frames === undefined ? {} : { frames }),
  };
}

/** A stored record's characters: undefined when absent or not a list.
 *  Each entry is read on its own and one that does not read is left out
 *  (its id, name and image ids as the format takes them); whether its
 *  files are in the tour is the restore's to judge, which holds them. */
export function parseRecordedCharacters(
  value: unknown,
): TourCharacter[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const read: TourCharacter[] = [];
  for (const entry of value as unknown[]) {
    const character = recordedCharacter(entry);
    if (character !== null && !read.some((c) => c.id === character.id)) {
      read.push(character);
    }
  }
  return read;
}
