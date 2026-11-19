/**
 * A narration's voice credit (the "Spoken by" line) as the editor stores
 * it: in NFC (`inputText`), trimmed, every run of whitespace one space,
 * cut to the format's cap in the format's own count (`tourTextCount`, in
 * the field's unit), and none at all when nothing is left.
 *
 * @see voice-credit.ts.md
 */
import {
  tourTextCount,
  type TourTextRule,
} from "gps-plus-slam-app-framework/ar/tour-block-read";
import { TOUR_NARRATION_RULES } from "gps-plus-slam-app-framework/ar/tour-kinds";

import { inputText } from "./input-text.js";

const RULE: TourTextRule = TOUR_NARRATION_RULES.voiceCredit;

/** The most letters a credit keeps: the format's cap. */
export const VOICE_CREDIT_MAX = RULE.max;

/** `text` in NFC, trimmed, its spacing single: the line that is counted
 *  and stored. The spacing the format's count collapses is collapsed in
 *  the stored credit too, so the stored letters are exactly the counted
 *  ones. */
const singleSpaced = (text: string): string =>
  inputText(text).trim().replace(/\s+/gu, " ");

/** Whether storing `text` cuts it: more than the cap in the rule's
 *  count, once in NFC. `rule` is the format's; a test may pass another. */
export function voiceCreditCut(text: string, rule = RULE): boolean {
  return tourTextCount(singleSpaced(text), rule.unit) > rule.max;
}

/** `text` as a stored credit, or undefined for a blank one: cut in the
 *  rule's own unit, so the cut and `voiceCreditCut` always agree, and
 *  never inside a surrogate pair. */
export function normalVoiceCredit(
  text: string,
  rule = RULE,
): string | undefined {
  const single = singleSpaced(text);
  let kept = "";
  for (const letter of single) {
    if (tourTextCount(kept + letter, rule.unit) > rule.max) break;
    kept += letter;
  }
  kept = kept.trimEnd();
  return kept === "" ? undefined : kept;
}
