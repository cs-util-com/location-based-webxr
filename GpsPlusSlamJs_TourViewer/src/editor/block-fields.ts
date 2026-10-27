/**
 * A free block's text fields as the desktop editor's inspector edits them
 * (B2c of the station-blocks plan; pure): per kind, the fields beside the
 * one the head already types (a short text's caption): a short text's
 * description; a picture's title, caption and alt text; a model's title.
 * Every cap is the format's (`TOUR_BLOCK_TEXT_RULES`) and every count the
 * format's (`tourTextCount`), so the counter beside a field, the refusal
 * and the file's reader agree.
 *
 * @see block-fields.ts.md
 */
import {
  TOUR_BLOCK_TEXT_RULES,
  tourTextCount,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";

import type { WorldBlock } from "../tour-document.js";

/** One text field of a block, as the inspector draws it. */
export interface BlockField {
  /** The block's own field (`data-field` in the inspector). */
  readonly name: string;
  readonly label: string;
  /** Its text now ("" when the block has none). */
  readonly value: string;
  /** The most characters it takes (the format's cap). */
  readonly max: number;
  /** Prose: a text area that keeps its lines, else one line. */
  readonly prose: boolean;
}

interface FieldSpec {
  readonly name: string;
  readonly label: string;
  readonly prose: boolean;
}

/** Each kind's fields in the inspector's order. All are optional in the
 *  format, so an emptied one leaves the block without it. */
const FIELDS: Readonly<Record<WorldBlock["kind"], readonly FieldSpec[]>> = {
  shortText: [{ name: "description", label: "Description", prose: true }],
  picture: [
    { name: "title", label: "Title", prose: false },
    { name: "caption", label: "Caption", prose: true },
    { name: "alt", label: "Alt text", prose: true },
  ],
  model: [{ name: "title", label: "Title", prose: false }],
};

function capOf(kind: WorldBlock["kind"], name: string): number {
  const rules = TOUR_BLOCK_TEXT_RULES[kind] as Readonly<
    Record<string, { readonly max: number } | undefined>
  >;
  return rules[name]?.max ?? 0;
}

function textOf(block: TourObject | WorldBlock, name: string): string {
  const value = (block as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value : "";
}

/** The fields the inspector types for `block`, besides a short text's
 *  caption (the head's). */
export function blockFields(block: TourObject | WorldBlock): BlockField[] {
  return FIELDS[block.kind].map((spec) => ({
    ...spec,
    value: textOf(block, spec.name),
    max: capOf(block.kind, spec.name),
  }));
}

/**
 * What typing `value` into `block`'s field `name` writes: the block with
 * the text trimmed at its ends (its lines kept), or without the field when
 * the text is blank; `unchanged` for the same text or a field the kind
 * does not have here; `refused`, in words, for a text over its cap.
 */
export function blockFieldEdit(
  block: TourObject,
  name: string,
  value: string,
):
  | { readonly kind: "edited"; readonly after: TourObject }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: string } {
  const spec = FIELDS[block.kind].find((f) => f.name === name);
  if (spec === undefined) return { kind: "unchanged" };
  const text = value.trim();
  if (text === textOf(block, name)) return { kind: "unchanged" };
  const max = capOf(block.kind, name);
  if (tourTextCount(text) > max) {
    return {
      kind: "refused",
      reason: `${articleOf(spec.label)} takes at most ${String(max)} characters.`,
    };
  }
  const rest = { ...(block as unknown as Record<string, unknown>) };
  if (text === "") delete rest[name];
  else rest[name] = text;
  return { kind: "edited", after: rest as unknown as TourObject };
}

/** "A title", "An alt text", "A description". */
function articleOf(label: string): string {
  const word = label.toLowerCase();
  return `${/^[aeiou]/.test(word) ? "An" : "A"} ${word}`;
}
