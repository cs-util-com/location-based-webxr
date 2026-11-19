/**
 * A narration's voice credit (the "Spoken by" line) as the editor stores
 * it: in NFC (`inputText`), trimmed, every run of whitespace one space,
 * cut to the format's cap in the format's own count (`tourTextCount`, in
 * the field's unit), and none at all when nothing is left.
 *
 * @see voice-credit.ts.md
 */
import { tourTextCount } from "gps-plus-slam-app-framework/ar/tour-block-read";
import { TOUR_NARRATION_RULES } from "gps-plus-slam-app-framework/ar/tour-kinds";

import { inputText } from "./input-text.js";

const RULE = TOUR_NARRATION_RULES.voiceCredit;

/** The most letters a credit keeps: the format's cap. */
export const VOICE_CREDIT_MAX = RULE.max;

/** Whether storing `text` cuts it: more than the cap in the format's
 *  count, once in NFC. */
export function voiceCreditCut(text: string): boolean {
  return tourTextCount(inputText(text), RULE.unit) > VOICE_CREDIT_MAX;
}

/** `text` as a stored credit, or undefined for a blank one. */
export function normalVoiceCredit(text: string): string | undefined {
  // The spacing the format's count collapses is collapsed in the stored
  // credit too, so the stored letters are exactly the counted ones.
  const single = inputText(text).trim().replace(/\s+/gu, " ");
  const kept = [...single].slice(0, VOICE_CREDIT_MAX).join("").trimEnd();
  return kept === "" ? undefined : kept;
}
