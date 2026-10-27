/**
 * A block's text fields as the desktop editor's inspector edits them
 * (pure): per kind, the fields beside the one the head already types (a
 * short text's caption): a short text's description; a long text's title
 * and body; a picture's title, caption and alt text; a video's or an
 * audio's title and transcript; a model's title; a character's name and
 * caption. Every cap, unit and need is the format's
 * (`TOUR_BLOCK_TEXT_RULES`) and every count the format's
 * (`tourTextCount`), so the counter beside a field, the refusal and the
 * file's reader agree. Also how a block is named where it is listed
 * (`blockTitle`).
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

interface FieldSpec {
  readonly name: string;
  readonly label: string;
  readonly prose: boolean;
}

/** A block the inspector reads: a free one in the world or one a story
 *  shows. */
type AnyBlock = TourObject | TourBlock;

const TITLE: FieldSpec = { name: "title", label: "Title", prose: false };
const TRANSCRIPT: FieldSpec = {
  name: "transcript",
  label: "Transcript",
  prose: true,
};

/** Each kind's fields in the inspector's order. */
const FIELDS: Readonly<Record<TourBlockKind, readonly FieldSpec[]>> = {
  shortText: [{ name: "description", label: "Description", prose: true }],
  longText: [TITLE, { name: "body", label: "Body", prose: true }],
  picture: [
    TITLE,
    { name: "caption", label: "Caption", prose: true },
    { name: "alt", label: "Alt text", prose: true },
  ],
  video: [TITLE, TRANSCRIPT],
  audio: [TITLE, TRANSCRIPT],
  model: [TITLE],
  character: [
    { name: "name", label: "Name", prose: false },
    { name: "caption", label: "Caption", prose: true },
  ],
};

/** Each kind in the block model's words. */
export const BLOCK_KIND_LABEL: Readonly<Record<TourBlockKind, string>> = {
  shortText: "Short text",
  longText: "Long text",
  picture: "Picture",
  video: "Video",
  audio: "Audio",
  model: "3D model",
  character: "Character",
};

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
  return FIELDS[block.kind].map((spec) => {
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

/** The text a block is named by where it is listed: a short text's
 *  caption, a character's name, else its title (for a picture, its
 *  caption when it has no title); its kind's words when it has none. */
export function blockTitle(block: AnyBlock): string {
  if (block.kind === "shortText") return block.caption;
  const own =
    block.kind === "character"
      ? textOf(block, "name").trim()
      : textOf(block, "title").trim() ||
        (block.kind === "picture" ? textOf(block, "caption").trim() : "");
  return own === "" ? BLOCK_KIND_LABEL[block.kind] : own;
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
  const spec = FIELDS[block.kind].find((f) => f.name === name);
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
      reason: `${articleOf(spec.label)} takes at most ${String(rule.max)} characters.`,
    };
  }
  const rest = { ...(block as unknown as Record<string, unknown>) };
  if (text === "") delete rest[name];
  else rest[name] = text;
  return { kind: "edited", after: rest as unknown as B };
}

/** "A title", "An alt text", "A description". */
function articleOf(label: string): string {
  const word = label.toLowerCase();
  return `${/^[aeiou]/.test(word) ? "An" : "A"} ${word}`;
}
