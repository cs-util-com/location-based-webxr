/**
 * How a block uses a file, read from the format's references
 * (`TourAssetRef`), never from a list of kinds: made of it (its own file),
 * mentioning it in a field it stands without (a narration, a poster, a
 * voice), or showing it inside its words (a long text's body). What the
 * shelf's delete of a file in use and its "Replace everywhere" do to each
 * block that names the file.
 *
 * @see file-uses.ts.md
 */
import { tourBlockRefs } from "gps-plus-slam-app-framework/ar/tour-kinds";

/** How a block uses one file. */
export type FileUse =
  /** Made of it: a picture's image, a sound's audio, a character's figure. */
  | { readonly kind: "own" }
  /** Shown inside its words: a long text's body pictures. */
  | { readonly kind: "inline" }
  /** Named only in optional fields the block stands without. */
  | { readonly kind: "mention"; readonly fields: readonly string[] };

/** The ids of the files `block` names anywhere, each once. */
export function fileIdsOf(block: { readonly kind?: unknown }): string[] {
  return [...new Set(tourBlockRefs(block).map((ref) => ref.id))];
}

/**
 * How `block` uses the file `assetId`; null when it names it nowhere. A
 * block made of the file is `own` whatever else names it there; one whose
 * words show it (and that is not made of it) is `inline`.
 */
export function fileUseOf(
  block: { readonly kind?: unknown },
  assetId: string,
): FileUse | null {
  const refs = tourBlockRefs(block).filter((ref) => ref.id === assetId);
  if (refs.length === 0) return null;
  if (refs.some((ref) => ref.required && ref.optional !== true)) {
    return { kind: "own" };
  }
  if (refs.some((ref) => !ref.required)) return { kind: "inline" };
  return {
    kind: "mention",
    fields: [...new Set(refs.map((ref) => ref.field))],
  };
}

/** `block` without the fields `fields`, everything else kept. */
export function withoutFields<B extends object>(
  block: B,
  fields: readonly string[],
): B {
  const copy = { ...block } as Record<string, unknown>;
  for (const field of fields) delete copy[field];
  return copy as B;
}

/** An `asset:` target of a text, with the id it names (an id is the
 *  format's: letters, digits, `_` and `-`). */
const ASSET_TARGET = /asset:([A-Za-z0-9_-]+)/g;

/**
 * `block` with every reference to the file `from` naming `to` instead:
 * the field holding the id, the record holding it (a narration's `audio`)
 * and the `asset:` targets of a text naming it. Null when `block` names
 * `from` nowhere. The id field itself is never touched: a captured photo's
 * id equals its picture's, and stays the photo's.
 */
export function withFileSwitched<B extends { readonly kind?: unknown }>(
  block: B,
  from: string,
  to: string,
): B | null {
  const refs = tourBlockRefs(block).filter((ref) => ref.id === from);
  if (refs.length === 0) return null;
  const next: Record<string, unknown> = { ...block };
  for (const field of new Set(refs.map((ref) => ref.field))) {
    if (field === "id") continue;
    const value = next[field];
    if (value === from) {
      next[field] = to;
    } else if (typeof value === "string") {
      next[field] = value.replace(ASSET_TARGET, (target, id: string) =>
        id === from ? `asset:${to}` : target,
      );
    } else if (typeof value === "object" && value !== null) {
      next[field] = Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, v === from ? to : v]),
      );
    }
  }
  return next as B;
}
