/**
 * The pin text rule both creator pages share: why these tests matter - a
 * pin's text is a short text's caption in the file, which a writer refuses
 * past 40 characters, so a page that let a 41st character through would
 * make every later save of the tour throw. The count must be the format's
 * own (code points after collapsing whitespace), never the field's UTF-16
 * length.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  TOUR_BLOCK_TEXT_RULES,
  tourTextCount,
} from "gps-plus-slam-app-framework/ar/tour-blocks";

import {
  PIN_TEXT_MAX_CHARS,
  PIN_TEXT_TOO_LONG,
  pinTextCount,
  pinTextCounterLine,
  pinTextTooLong,
  textCounterLine,
  wirePinTextCounter,
} from "./pin-text.js";

describe("pin text", () => {
  it("takes the format's caption cap, 40", () => {
    expect(PIN_TEXT_MAX_CHARS).toBe(
      TOUR_BLOCK_TEXT_RULES.shortText.caption.max,
    );
    expect(PIN_TEXT_MAX_CHARS).toBe(40);
    expect(PIN_TEXT_TOO_LONG).toContain("40 characters");
  });

  it("counts characters by code point, not UTF-16 units", () => {
    const emoji = "\u{1F600}".repeat(40);
    expect(emoji.length).toBe(80);
    expect(pinTextCount(emoji)).toBe(40);
    expect(pinTextTooLong(emoji)).toBe(false);
    expect(pinTextTooLong(`${emoji}a`)).toBe(true);
  });

  it("counts trimmed text with each whitespace run as one space", () => {
    expect(pinTextCount("  a   b  ")).toBe(3);
    expect(pinTextTooLong(` ${"x".repeat(40)}   `)).toBe(false);
  });

  it("says the count against the cap", () => {
    expect(pinTextCounterLine("Gate")).toBe("4 / 40");
    expect(pinTextCounterLine("")).toBe("0 / 40");
  });

  // Why (B2a review finding 6): the counter counts what is stored, the
  // text in NFC, so a decomposed accent counts once.
  it("counts the text in NFC, as it is stored", () => {
    const decomposed = `e${String.fromCodePoint(0x301)}`;
    expect(pinTextCount(decomposed)).toBe(1);
    expect(pinTextTooLong(decomposed.repeat(40))).toBe(false);
  });

  // Why: the counter must say what the refusal decides. Counted as typed,
  // 40 decomposed accents read "80 / 40" in red while the page accepts and
  // stores them; the counter and every block field's counter
  // (`wireTextCounter`) count the NFC text too.
  it("shows the count of the NFC text in the counter", () => {
    const decomposed = `e${String.fromCodePoint(0x301)}`.repeat(40);
    expect(pinTextCounterLine(decomposed)).toBe("40 / 40");
    expect(textCounterLine(decomposed, 40, "utf16")).toBe("40 / 40");
  });

  it("is the format's count of the NFC text for any text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 80 }), (text) => {
        const stored = text.normalize("NFC");
        expect(pinTextCount(text)).toBe(tourTextCount(stored));
        expect(pinTextTooLong(text)).toBe(tourTextCount(stored) > 40);
      }),
    );
  });

  // Why: a counter that disagrees with the refusal shows red for a text
  // the page stores, or calm for one it refuses.
  it("counter and refusal agree for any text", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: "grapheme", maxLength: 80 }),
          fc
            .array(fc.constantFrom("é", "a", " ", "\u{1F600}"), {
              maxLength: 60,
            })
            .map((parts) => parts.join("")),
        ),
        (text) => {
          const { field, out, attrs } = fakeCounter(text);
          wirePinTextCounter(field, out);
          expect(out.textContent).toBe(
            `${String(pinTextCount(text))} / ${String(PIN_TEXT_MAX_CHARS)}`,
          );
          expect(attrs.has("data-over")).toBe(pinTextTooLong(text));
        },
      ),
    );
  });
});

function fakeCounter(value: string) {
  let handler = (): void => {};
  const field = {
    value,
    addEventListener: (_type: "input", h: () => void) => {
      handler = h;
    },
  };
  const attrs = new Set<string>();
  const set = new Map<string, string>();
  const out = {
    textContent: null as string | null,
    toggleAttribute(name: string, force: boolean) {
      if (force) attrs.add(name);
      else attrs.delete(name);
      return force;
    },
    setAttribute(name: string, value: string) {
      set.set(name, value);
    },
  };
  return { field, out, attrs, set, type: () => handler() };
}

describe("wirePinTextCounter", () => {
  const fakes = fakeCounter;

  it("shows the count at once and as it is typed, marked while too long", () => {
    const { field, out, attrs, type } = fakes("Gate");
    const counter = wirePinTextCounter(field, out);
    expect(out.textContent).toBe("4 / 40");
    expect(attrs.has("data-over")).toBe(false);
    field.value = "y".repeat(41);
    type();
    expect(out.textContent).toBe("41 / 40");
    expect(attrs.has("data-over")).toBe(true);
    field.value = "short";
    counter.update();
    expect(out.textContent).toBe("5 / 40");
    expect(attrs.has("data-over")).toBe(false);
  });

  // Why: an <output> is a live region by default, so a screen reader
  // could announce the count at every keystroke. The field names its
  // count (aria-describedby), which is read when the field is focused, so
  // the count itself is not live.
  it("is not a live region: the count is read with its field", () => {
    const { field, out, set } = fakes("Gate");
    wirePinTextCounter(field, out);
    expect(set.get("aria-live")).toBe("off");
  });
});
