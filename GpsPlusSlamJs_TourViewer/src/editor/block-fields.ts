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

/** One field of a block, as the inspector draws it. */
export type BlockField = BlockTextField | BlockNumberField;

interface BlockFieldBase {
  /** The block's own field (`data-field` in the inspector). */
  readonly name: string;
  readonly label: string;
  /** Its text now ("" when the block has none). */
  readonly value: string;
  /** The block needs it: it may not be emptied. */
  readonly required: boolean;
  /** Prose: a text area that keeps its lines, else one line. */
  readonly prose: boolean;
}

/** A text to type, counted against the format's cap. */
interface BlockTextField extends BlockFieldBase {
  /** The most it takes, in `unit` (the format's cap). */
  readonly max: number;
  /** How the cap counts: characters, or UTF-16 units (a long text's
   *  body). */
  readonly unit: TourTextUnit;
  readonly number?: undefined;
}

/** A number to type, with its unit (`FieldSpec` `number`). No cap: its
 *  bounds are the format's, refused on the write (`blockFieldEdit`). */
interface BlockNumberField extends BlockFieldBase {
  readonly number: { readonly unit: string };
  readonly max?: undefined;
  readonly unit?: undefined;
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

/** A plain decimal: a sign, digits and one decimal point or comma. */
const DECIMAL = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;

/** A typed number: a plain decimal, a comma as its decimal point (one
 *  comma always is: "1,000" is 1); blank, or anything else (hex, an
 *  exponent, a second comma or point), is none. */
export function typedNumber(value: string): number | null {
  const text = value.trim();
  if (!DECIMAL.test(text)) return null;
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** `block`'s own fields in its view: a field its row names for some
 *  views only is left out of the others. */
function ownFields(block: AnyBlock): readonly FieldSpec[] {
  const own: readonly FieldSpec[] = KIND_EDIT[block.kind].fields;
  return own.filter(
    (spec) => spec.views === undefined || spec.views.includes(block.view),
  );
}

function numberOf(block: AnyBlock, name: string): number | undefined {
  const value = (block as unknown as Record<string, unknown>)[name];
  return typeof value === "number" ? value : undefined;
}

/** The fields the inspector types for `block`, besides a short text's
 *  caption (the head's). */
export function blockFields(block: AnyBlock): BlockField[] {
  return ownFields(block).map((spec) => {
    if (spec.number !== undefined) {
      const n = numberOf(block, spec.name);
      return {
        name: spec.name,
        label: spec.label,
        prose: false,
        value: n === undefined ? "" : String(n),
        required: spec.number.required,
        number: { unit: spec.number.unit },
      };
    }
    const rule = ruleOf(block.kind, spec.name);
    return {
      name: spec.name,
      label: spec.label,
      prose: spec.prose,
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
        name: CAPTION.name,
        label: CAPTION.label,
        prose: CAPTION.prose,
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
  const own = ownFields(block);
  const specs = block.kind === "shortText" ? [CAPTION, ...own] : own;
  const spec = specs.find((f) => f.name === name);
  if (spec === undefined) return { kind: "unchanged" };
  if (spec.number !== undefined) {
    return numberFieldEdit(block, spec.label, name, spec.number, value);
  }
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

/** What typing `value` into a number field writes (`blockFieldEdit`):
 *  the number within `bounds`, or none for a blank optional one; a zone's
 *  calm (`minM`) stays less than its reach, as the reader needs. */
function numberFieldEdit<B extends AnyBlock>(
  block: B,
  label: string,
  name: string,
  bounds: NonNullable<FieldSpec["number"]>,
  value: string,
):
  | { readonly kind: "edited"; readonly after: B }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: string } {
  const rest = { ...(block as unknown as Record<string, unknown>) };
  if (value.trim() === "") {
    if (numberOf(block, name) === undefined) return { kind: "unchanged" };
    if (bounds.required) {
      return { kind: "refused", reason: `${label} cannot be empty.` };
    }
    delete rest[name];
    return { kind: "edited", after: rest as unknown as B };
  }
  const n = typedNumber(value);
  if (n === null || n < bounds.min || n > bounds.max) {
    const unit = bounds.unit === "" ? "" : ` ${bounds.unit}`;
    return {
      kind: "refused",
      reason: `${label} takes a number from ${String(bounds.min)} to ${String(bounds.max)}${unit}.`,
    };
  }
  if (n === numberOf(block, name)) return { kind: "unchanged" };
  rest[name] = n;
  const { minM, maxM } = rest;
  if (typeof minM === "number" && typeof maxM === "number" && minM >= maxM) {
    return {
      kind: "refused",
      reason: "Full volume within must be less than the reach.",
    };
  }
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
