/**
 * Why these tests matter: a narration's "Spoken by" line is typed by a
 * creator and shown to every visitor after the speaker's name. Whatever
 * is typed, the editor must store a line the format takes (its cap, no
 * blank credit: an empty one means none), and storing it twice must not
 * change it again, or every reopen of the field would count as an edit.
 */
import fc from "fast-check";
import {
  checkTourBlockText,
  tourTextCount,
} from "gps-plus-slam-app-framework/ar/tour-block-read";
import { TOUR_NARRATION_RULES } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { describe, expect, it } from "vitest";

import { VOICE_CREDIT_MAX, normalVoiceCredit } from "./voice-credit.js";

const RULE = TOUR_NARRATION_RULES.voiceCredit;

/** Any text, with whitespace of several kinds and astral letters mixed in. */
const typed = fc.string({
  unit: fc.oneof(
    fc.constantFrom(" ", "\t", "\n", " ", "　", "😀", "é"),
    fc.string({ minLength: 1, maxLength: 1 }),
  ),
  maxLength: 400,
});

describe("normalVoiceCredit", () => {
  it("gives a credit the format takes, or none for a blank one", () => {
    fc.assert(
      fc.property(typed, (text) => {
        const credit = normalVoiceCredit(text);
        // None exactly when nothing but whitespace was typed.
        expect(credit === undefined).toBe(text.trim() === "");
        fc.pre(credit !== undefined);
        expect(checkTourBlockText(RULE, credit)).toEqual({
          ok: true,
          value: credit,
        });
        expect(credit).toBe(credit.trim());
        expect(tourTextCount(credit)).toBe([...credit].length);
        expect([...credit].length).toBeLessThanOrEqual(VOICE_CREDIT_MAX);
      }),
    );
  });

  it("is the same once normal: storing a stored credit changes nothing", () => {
    fc.assert(
      fc.property(typed, (text) => {
        const once = normalVoiceCredit(text);
        expect(normalVoiceCredit(once ?? "")).toBe(once);
      }),
    );
  });

  it("keeps a credit within the cap word for word, its spacing made single", () => {
    fc.assert(
      fc.property(typed, (text) => {
        const collapsed = text.trim().replace(/\s+/gu, " ");
        const credit = normalVoiceCredit(text);
        const within = [...collapsed].length <= VOICE_CREDIT_MAX;
        // Within the cap the collapsed line is kept whole; past it, it is
        // cut, never rewritten: what is kept starts the typed line.
        const kept = within
          ? collapsed
          : [...collapsed].slice(0, VOICE_CREDIT_MAX).join("").trimEnd();
        expect(credit).toBe(kept === "" ? undefined : kept);
        expect(collapsed.startsWith(credit ?? "")).toBe(true);
      }),
    );
  });
});

describe("normalVoiceCredit, by example", () => {
  it("trims, collapses inner spacing, and cuts by letters, not UTF-16 units", () => {
    expect(normalVoiceCredit("  Read by   Anna\tBerg  ")).toBe(
      "Read by Anna Berg",
    );
    expect(normalVoiceCredit("   ")).toBeUndefined();
    expect(normalVoiceCredit("")).toBeUndefined();
    const astral = "😀".repeat(VOICE_CREDIT_MAX + 5);
    const cut = normalVoiceCredit(astral);
    expect([...(cut ?? "")].length).toBe(VOICE_CREDIT_MAX);
    // No half of a surrogate pair is left at the end.
    expect(cut?.endsWith("😀")).toBe(true);
  });

  it("names the format's own cap", () => {
    expect(VOICE_CREDIT_MAX).toBe(RULE.max);
  });
});
