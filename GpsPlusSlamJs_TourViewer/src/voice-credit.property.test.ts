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

import {
  VOICE_CREDIT_MAX,
  normalVoiceCredit,
  voiceCreditCut,
} from "./voice-credit.js";

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
        const collapsed = text.normalize("NFC").trim().replace(/\s+/gu, " ");
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

  // Why: the editor's toast says "Cut to 200 letters" on this answer; it
  // must be true exactly when storing the text dropped letters.
  it("says a cut exactly when the stored credit lost letters", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          typed,
          fc.string({
            minLength: VOICE_CREDIT_MAX - 2,
            maxLength: VOICE_CREDIT_MAX + 3,
          }),
        ),
        (text) => {
          const whole = tourTextCount(text.normalize("NFC"), RULE.unit);
          expect(voiceCreditCut(text)).toBe(whole > VOICE_CREDIT_MAX);
          // No cut said: the stored credit kept every letter.
          const kept = [...(normalVoiceCredit(text) ?? "")].length;
          expect(voiceCreditCut(text) || kept === whole).toBe(true);
        },
      ),
    );
  });

  // Why: a keyboard or a paste may hand over a decomposed accent ("e" and
  // a combining mark), two code points where the stored letter is one: the
  // credit is counted and stored in NFC, as every other text the editor
  // takes, so the same name is never cut on one device and kept on another.
  it("counts and stores a decomposed letter as the one letter it reads as", () => {
    const decomposed = "é".repeat(VOICE_CREDIT_MAX);
    expect([...decomposed].length).toBe(2 * VOICE_CREDIT_MAX);
    expect(voiceCreditCut(decomposed)).toBe(false);
    expect(normalVoiceCredit(decomposed)).toBe("é".repeat(VOICE_CREDIT_MAX));
  });

  // Why: a letter outside the basic plane is two UTF-16 units and one
  // code point; the cap counts code points, so a credit of such letters
  // at the cap is kept whole and one more is cut.
  it("counts an astral letter once", () => {
    const atCap = "\u{1D49C}".repeat(VOICE_CREDIT_MAX);
    expect(voiceCreditCut(atCap)).toBe(false);
    expect(normalVoiceCredit(atCap)).toBe(atCap);
    expect(voiceCreditCut(`${atCap}\u{1D49C}`)).toBe(true);
    expect(normalVoiceCredit(`${atCap}\u{1D49C}`)).toBe(atCap);
  });

  it("names the format's own cap", () => {
    expect(VOICE_CREDIT_MAX).toBe(RULE.max);
  });

  // Why: the cut and the "Cut to" toast must agree in whatever unit the
  // format counts. Cutting by code points matched the count only because
  // the rule happens to count code points; under a UTF-16 rule an astral
  // credit at the cap in code points is twice the cap in UTF-16 units.
  it("cuts in the rule's own unit, never half a surrogate pair (property)", () => {
    for (const unit of ["codePoints", "utf16"] as const) {
      const rule = { max: 5, unit, required: false };
      fc.assert(
        fc.property(typed, (text) => {
          const credit = normalVoiceCredit(text, rule) ?? "";
          expect(tourTextCount(credit, unit)).toBeLessThanOrEqual(rule.max);
          expect(/\p{Cs}/u.test(credit), "half a surrogate pair").toBe(false);
          const whole = tourTextCount(
            text.normalize("NFC").trim().replace(/\s+/gu, " "),
            unit,
          );
          expect(voiceCreditCut(text, rule)).toBe(whole > rule.max);
          const keptWhole = tourTextCount(credit, unit) === whole;
          expect(
            whole > rule.max || keptWhole,
            "an uncut credit is kept whole",
          ).toBe(true);
        }),
      );
    }
    const utf16 = { max: 5, unit: "utf16", required: false } as const;
    expect(normalVoiceCredit("😀😀😀", utf16)).toBe("😀😀");
    expect(voiceCreditCut("😀😀😀", utf16)).toBe(true);
  });
});
