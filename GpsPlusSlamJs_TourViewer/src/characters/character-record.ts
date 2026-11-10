/**
 * The character record (`character.json`): what the library keeps next to
 * a character's pictures, and what an exchange file carries inside its
 * PNG. Pure validation, no storage.
 */

export const CHARACTER_FORMAT = 1;
const NAME_MAX = 40;
export const DEFAULT_TOOL = "character maker";

export interface CharacterRecord {
  readonly format: number;
  readonly libraryId: string;
  readonly name: string;
  /** True when the name was given automatically ("Guide N"). */
  readonly autoName: boolean;
  readonly createdAtIso: string;
  /** True for "steady body" (aligned frames), false for "as drawn". */
  readonly steady: boolean;
  readonly describedAs: string;
  readonly tool: string;
}

export type ImportedRecord =
  | {
      readonly kind: "ok";
      readonly name: string;
      readonly steady: boolean;
      readonly describedAs: string;
    }
  | { readonly kind: "newer" }
  | { readonly kind: "unreadable" };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const LIBRARY_ID = /^c[0-9a-z]+$/;

/** A full library record, or null when any field is missing or wrong. */
export function recordOf(v: unknown): CharacterRecord | null {
  if (!isObject(v) || v.format !== CHARACTER_FORMAT) return null;
  const { libraryId, name, autoName, createdAtIso } = v;
  const { steady, describedAs, tool } = v;
  if (typeof libraryId !== "string" || !LIBRARY_ID.test(libraryId)) {
    return null;
  }
  if (typeof name !== "string" || nameProblem(name) !== null) return null;
  if (typeof createdAtIso !== "string" || !ISO.test(createdAtIso)) return null;
  if (Number.isNaN(Date.parse(createdAtIso))) return null;
  if (typeof autoName !== "boolean" || typeof steady !== "boolean") return null;
  if (typeof describedAs !== "string" || typeof tool !== "string") return null;
  return {
    format: CHARACTER_FORMAT,
    libraryId,
    name,
    autoName,
    createdAtIso,
    steady,
    describedAs,
    tool,
  };
}

/** Why a name cannot be stored, in the words the field shows, or null. */
export function nameProblem(name: string): string | null {
  const letters = [...name.trim()];
  if (letters.length === 0) return "A name needs at least one letter.";
  if (letters.length > NAME_MAX) {
    return `A name can have up to ${NAME_MAX} letters.`;
  }
  return null;
}

/** The name trimmed and cut to the cap (by letters, not UTF-16 units). */
export function cappedName(name: string): string {
  return [...name.trim()].slice(0, NAME_MAX).join("").trim();
}

/** The first "Guide N" not in the list. */
export function nextGuideName(names: readonly string[]): string {
  const taken = new Set(names);
  let n = 1;
  while (taken.has(`Guide ${n}`)) n++;
  return `Guide ${n}`;
}

/** A folder-safe id: "c", the time and a random tail, base 36. */
export function newLibraryId(now: number, random: () => number): string {
  const tail = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `c${Math.max(0, Math.floor(now)).toString(36)}${tail}`;
}

/**
 * The fields an exchange file may bring: only known ones, of the right
 * type. A missing format reads as unreadable, a higher one as newer.
 */
export function importedRecordOf(v: unknown): ImportedRecord {
  if (!isObject(v) || typeof v.format !== "number") {
    return { kind: "unreadable" };
  }
  if (v.format > CHARACTER_FORMAT) return { kind: "newer" };
  if (v.format !== CHARACTER_FORMAT) return { kind: "unreadable" };
  return {
    kind: "ok",
    name: typeof v.name === "string" ? cappedName(v.name) : "",
    steady: v.steady === true,
    describedAs: typeof v.describedAs === "string" ? v.describedAs : "",
  };
}
