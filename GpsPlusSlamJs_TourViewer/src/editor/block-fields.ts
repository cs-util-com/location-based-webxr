/**
 * A block's text fields as the desktop editor's inspector edits them
 * (pure): per kind, the fields its row lists (`KIND_EDIT` `fields`), beside
 * the one the head already types (a short text's caption). Every cap, unit
 * and need is the format's (`TOUR_BLOCK_TEXT_RULES`) and every count the
 * format's (`tourTextCount`), so the counter beside a field, the refusal and the
 * file's reader agree. How a block is named where it is listed is
 * `object-describe.ts`'s one rule (`objectTitle`).
 *
 * @see block-fields.ts.md
 */
import {
  TOUR_BLOCK_TEXT_RULES,
  tourTextCount,
  type TourBlock,
  type TourBlockKind,
  type TourTextRule,
  type TourTextUnit,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { KIND_EDIT, type FieldSpec } from "../kinds/edit-kinds.js";

/** One text field of a block, as the inspector draws it. */
export interface BlockField {
  /** The block's own field (`data-field` in the inspector). */
  readonly name: string;
  readonly label: string;
  /** Its text now ("" when the block has none). */
  readonly value: string;
  /** The most it takes, in `unit` (the format's cap). */
  readonly max: number;
  /** How the cap counts: characters, or UTF-16 units (a long text's
   *  body). */
  readonly unit: TourTextUnit;
  /** The block needs it: it may not be emptied. */
  readonly required: boolean;
  /** Prose: a text area that keeps its lines, else one line. */
  readonly prose: boolean;
}

/** A block the inspector reads: a free one in the world or one a story
 *  shows. */
type AnyBlock = TourObject | TourBlock;

/** A short text's caption: the head types it for a free one, the station's
 *  inspector for one its story shows. */
const CAPTION: FieldSpec = { name: "caption", label: "Caption", prose: false };

const NO_RULE: TourTextRule = { max: 0, unit: "codePoints", required: false };

function ruleOf(kind: TourBlockKind, name: string): TourTextRule {
  const rules = TOUR_BLOCK_TEXT_RULES[kind] as Readonly<
    Record<string, TourTextRule | undefined>
  >;
  return rules[name] ?? NO_RULE;
}

function textOf(block: AnyBlock, name: string): string {
  const value = (block as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value : "";
}

/** The fields the inspector types for `block`, besides a short text's
 *  caption (the head's). */
export function blockFields(block: AnyBlock): BlockField[] {
  const own: readonly FieldSpec[] = KIND_EDIT[block.kind].fields;
  return own.map((spec) => {
    const rule = ruleOf(block.kind, spec.name);
    return {
      ...spec,
      value: textOf(block, spec.name),
      max: rule.max,
      unit: rule.unit,
      required: rule.required,
    };
  });
}

/** The fields the station's inspector types for `block`, one its story
 *  shows: a short text's caption too (no head types it there), and no
 *  name for a declared character (his declaration's, written over on
 *  every read). */
export function storyBlockFields(block: TourBlock): BlockField[] {
  const fields = blockFields(block);
  if (block.kind === "shortText") {
    const rule = ruleOf("shortText", CAPTION.name);
    return [
      {
        ...CAPTION,
        value: block.caption,
        max: rule.max,
        unit: rule.unit,
        required: rule.required,
      },
      ...fields,
    ];
  }
  if (block.kind === "character" && block.character !== undefined) {
    return fields.filter((f) => f.name !== "name");
  }
  return fields;
}

/**
 * What typing `value` into `block`'s field `name` writes: the block with
 * the text trimmed at its ends (its lines kept), or without the field when
 * the text is blank; `unchanged` for the same text or a field the kind
 * does not have here; `refused`, in words, for a text over its cap or a
 * field the block needs emptied.
 */
export function blockFieldEdit<B extends AnyBlock>(
  block: B,
  name: string,
  value: string,
):
  | { readonly kind: "edited"; readonly after: B }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: string } {
  const own: readonly FieldSpec[] = KIND_EDIT[block.kind].fields;
  const specs = block.kind === "shortText" ? [CAPTION, ...own] : own;
  const spec = specs.find((f) => f.name === name);
  if (spec === undefined) return { kind: "unchanged" };
  const text = value.trim();
  if (text === textOf(block, name)) return { kind: "unchanged" };
  const rule = ruleOf(block.kind, name);
  if (text === "" && rule.required) {
    return {
      kind: "refused",
      reason: `${articleOf(spec.label)} cannot be empty.`,
    };
  }
  if (tourTextCount(text, rule.unit) > rule.max) {
    return {
      kind: "refused",
      reason: `${articleOf(spec.label)} takes at most ${String(rule.max)} ${UNIT_WORDS[rule.unit]}.`,
    };
  }
  const rest = { ...(block as unknown as Record<string, unknown>) };
  if (text === "") delete rest[name];
  else rest[name] = text;
  return { kind: "edited", after: rest as unknown as B };
}

/** What a cap counts, in the refusal's words. */
const UNIT_WORDS: Readonly<Record<TourTextUnit, string>> = {
  codePoints: "characters",
  utf16: "UTF-16 units",
};

/** The empty field's hint: whether the block needs the field. */
export function blockFieldPlaceholder(field: BlockField): string {
  return field.required ? "Required" : "Optional";
}

/** "A title", "An alt text", "A description". */
function articleOf(label: string): string {
  const word = label.toLowerCase();
  return `${/^[aeiou]/.test(word) ? "An" : "A"} ${word}`;
}
