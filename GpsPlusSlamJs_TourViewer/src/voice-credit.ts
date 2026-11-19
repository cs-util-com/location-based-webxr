/**
 * A narration's voice credit (the "Spoken by" line) as the editor stores
 * it: trimmed, every run of whitespace one space, cut to the format's cap
 * by letters (code points), and none at all when nothing is left.
 *
 * @see voice-credit.ts.md
 */
import { TOUR_NARRATION_RULES } from "gps-plus-slam-app-framework/ar/tour-kinds";

/** The most letters a credit keeps: the format's cap. */
export const VOICE_CREDIT_MAX = TOUR_NARRATION_RULES.voiceCredit.max;

/** `text` trimmed, every whitespace run one space. */
function collapsed(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

/** Whether storing `text` cuts it: more letters than the cap once its
 *  whitespace is collapsed. */
export function voiceCreditCut(text: string): boolean {
  return [...collapsed(text)].length > VOICE_CREDIT_MAX;
}

/** `text` as a stored credit, or undefined for a blank one. */
export function normalVoiceCredit(text: string): string | undefined {
  const single = collapsed(text);
  const kept = [...single].slice(0, VOICE_CREDIT_MAX).join("").trimEnd();
  return kept === "" ? undefined : kept;
}
