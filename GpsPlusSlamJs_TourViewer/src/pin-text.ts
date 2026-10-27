/**
 * A pin's text as both creator pages take it: at most
 * `PIN_TEXT_MAX_CHARS` characters (a short text's caption,
 * `TOUR_BLOCK_TEXT_RULES`), counted by the format's own count
 * (`tourTextCount`: code points after trimming and collapsing each
 * whitespace run), so the counter beside the field, the page's refusal and
 * the file's reader never disagree. No `maxlength` on the field: it counts
 * UTF-16 units, so an emoji would end a pin early.
 *
 * @see pin-text.ts.md
 */

import {
  TOUR_BLOCK_TEXT_RULES,
  tourTextCount,
} from "gps-plus-slam-app-framework/ar/tour-blocks";

/** The most characters a pin's text takes. */
export const PIN_TEXT_MAX_CHARS = TOUR_BLOCK_TEXT_RULES.shortText.caption.max;

/** Said when a page refuses a pin's text as too long. */
export const PIN_TEXT_TOO_LONG = `A pin's text takes at most ${String(PIN_TEXT_MAX_CHARS)} characters.`;

/** How many characters of a pin's text count. */
export function pinTextCount(text: string): number {
  return tourTextCount(text);
}

/** Whether `text` is longer than a pin takes. */
export function pinTextTooLong(text: string): boolean {
  return pinTextCount(text) > PIN_TEXT_MAX_CHARS;
}

/** A counter's line for `text` against `max`, by the format's count:
 *  "12 / 160" (every text counter of the creator pages, B2a review #4). */
export function textCounterLine(text: string, max: number): string {
  return `${String(tourTextCount(text))} / ${String(max)}`;
}

/** The counter's line for `text`: "12 / 40". */
export function pinTextCounterLine(text: string): string {
  return textCounterLine(text, PIN_TEXT_MAX_CHARS);
}

/** The field and its counter (structural, so the unit tests run in
 *  node). */
export interface PinTextField {
  value: string;
  addEventListener(type: "input", handler: () => void): void;
}
export interface PinTextCounterOutput {
  textContent: string | null;
  toggleAttribute(name: string, force: boolean): boolean;
  setAttribute(name: string, value: string): void;
}

/**
 * Show `field`'s count in `out` as it is typed, marked `data-over` while
 * the text is too long. `update()` shows it now (after the page set the
 * field's value itself). `out` is not a live region (`aria-live="off"`;
 * an <output> is one by default and could be announced at every
 * keystroke): the field names it with `aria-describedby`, so it is read
 * as the field is focused.
 */
export function wirePinTextCounter(
  field: PinTextField,
  out: PinTextCounterOutput,
): { update(): void } {
  return wireTextCounter(field, out, PIN_TEXT_MAX_CHARS);
}

/** `wirePinTextCounter` for any text and its cap `max` (a block's
 *  fields, `editor/block-fields.ts`). */
export function wireTextCounter(
  field: PinTextField,
  out: PinTextCounterOutput,
  max: number,
): { update(): void } {
  const update = (): void => {
    out.textContent = textCounterLine(field.value, max);
    out.toggleAttribute("data-over", tourTextCount(field.value) > max);
  };
  out.setAttribute("aria-live", "off");
  field.addEventListener("input", update);
  update();
  return { update };
}
