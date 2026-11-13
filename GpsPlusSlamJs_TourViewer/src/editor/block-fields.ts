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
import type { SliderTrack } from "./editor-shell/range-slider.js";

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
 *  bounds are the format's, refused on the write (`blockFieldEdit`). Its
 *  `value` is what the box shows (a volume in %). */
export interface BlockNumberField extends BlockFieldBase {
  readonly number: {
    readonly unit: string;
    /** What the box shows per unit the file holds (`FieldSpec`): 1, or
     *  100 for a volume in %. */
    readonly scale: number;
    /** A slider beside the box, over this track (`FieldSpec`). */
    readonly slider?: SliderTrack;
    /** The field that is the track's lower thumb, and what it shows. */
    readonly low?: {
      readonly name: string;
      readonly label: string;
      readonly value: string;
    };
    /** The zone's loudness curve under it, from what the file holds. */
    readonly curve?: LoudnessOf;
  };
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

/** A zone's reach as its loudness curve reads it. */
export interface LoudnessOf {
  readonly minM?: number;
  readonly maxM: number;
  readonly volume: number;
}

/** What the box shows for `n` held in the file: `scale` times it, with
 *  a binary fraction's noise rounded off (0.29 is 29, not 28.999...). */
export function shownNumber(n: number, scale = 1): number {
  return scale === 1 ? n : Number((n * scale).toFixed(6));
}

/** What the file holds for `n` shown in the box. */
export function heldNumber(n: number, scale = 1): number {
  return scale === 1 ? n : Number((n / scale).toFixed(9));
}

function shownText(block: AnyBlock, spec: FieldSpec | undefined): string {
  if (spec?.number === undefined) return "";
  const n = numberOf(block, spec.name);
  return n === undefined ? "" : String(shownNumber(n, spec.number.scale));
}

function numberFieldOf(
  block: AnyBlock,
  spec: FieldSpec & { readonly number: NonNullable<FieldSpec["number"]> },
  own: readonly FieldSpec[],
): BlockNumberField {
  const { unit, required, slider, low, curve, scale = 1 } = spec.number;
  const lowSpec = own.find((f) => f.name === low);
  return {
    name: spec.name,
    label: spec.label,
    prose: false,
    value: shownText(block, spec),
    required,
    number: {
      unit,
      scale,
      ...(slider === undefined ? {} : { slider }),
      ...(lowSpec === undefined
        ? {}
        : {
            low: {
              name: lowSpec.name,
              label: lowSpec.label,
              value: shownText(block, lowSpec),
            },
          }),
      ...(curve === undefined ? {} : { curve: loudnessOf(block) }),
    },
  };
}

function loudnessOf(block: AnyBlock): LoudnessOf {
  const minM = numberOf(block, "minM");
  return {
    ...(minM === undefined ? {} : { minM }),
    maxM: numberOf(block, "maxM") ?? 0,
    volume: numberOf(block, "volume") ?? 0,
  };
}

/** The fields the inspector types for `block`, besides a short text's
 *  caption (the head's). */
export function blockFields(block: AnyBlock): BlockField[] {
  const own = ownFields(block);
  // A choice is the kind's panel's, on chips: never a box to type in.
  return own
    .flatMap((spec) => (spec.choices === undefined ? [spec] : []))
    .map((spec) => {
      if (spec.number !== undefined) {
        return numberFieldOf(block, { ...spec, number: spec.number }, own);
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
  if (spec.choices !== undefined) {
    return choiceFieldEdit(block, spec.label, name, spec.choices, value);
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
  const held = heldNumber(n, bounds.scale);
  if (held === numberOf(block, name)) return { kind: "unchanged" };
  rest[name] = held;
  const { minM, maxM } = rest;
  if (typeof minM === "number" && typeof maxM === "number" && minM >= maxM) {
    return {
      kind: "refused",
      reason: "Full volume within must be less than the reach.",
    };
  }
  return { kind: "edited", after: rest as unknown as B };
}

/** What choosing `value` for a choice field writes (`blockFieldEdit`):
 *  one of its `choices`, or none for a blank one (the reader's default). */
function choiceFieldEdit<B extends AnyBlock>(
  block: B,
  label: string,
  name: string,
  choices: NonNullable<FieldSpec["choices"]>,
  value: string,
):
  | { readonly kind: "edited"; readonly after: B }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: string } {
  const rest = { ...(block as unknown as Record<string, unknown>) };
  const was = rest[name];
  if (value === "") {
    if (was === undefined) return { kind: "unchanged" };
    delete rest[name];
    return { kind: "edited", after: rest as unknown as B };
  }
  if (!choices.some((c) => c.value === value)) {
    return {
      kind: "refused",
      reason: `${label} is one of ${choices.map((c) => c.label).join(", ")}.`,
    };
  }
  if (was === value) return { kind: "unchanged" };
  rest[name] = value;
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
