/**
 * Why this test matters: a pin's caption may be 40 characters long, and a
 * label sized for a short word cut "This way to the guild house" to "way
 * to the guild ho" in the field. The sweep below checks every caption
 * length up to the format's limit, in wide and narrow letters and as one
 * long word, against the width the label really draws its text in.
 */
import { describe, expect, it } from "vitest";

import type { Measure } from "./kinds/short-text/plate.js";
import { PIN_LABEL, pinLabelLayout } from "./pin-label.js";

/** The format's longest caption (`tour-kinds.ts`, code points). */
const TOUR_SHORT_CAPTION_MAX = 40;

/** Bold sans-serif advance widths, in letter heights: close to a real
 *  bold Arial or Roboto, wide capitals wider than any lowercase. */
const ADVANCE: Readonly<Record<string, number>> = {
  W: 0.95,
  M: 0.84,
  m: 0.89,
  w: 0.78,
  i: 0.28,
  l: 0.28,
  " ": 0.28,
};
const boldMeasure: Measure = (font, text) => {
  const px = Number(/(\d+(?:\.\d+)?)px/u.exec(font)?.[1] ?? Number.NaN);
  let em = 0;
  for (const ch of text) {
    em += ADVANCE[ch] ?? (ch === ch.toUpperCase() ? 0.72 : 0.6);
  }
  return em * px;
};

/** Captions of every length 1..limit made by repeating `pattern`. */
const sweep = (pattern: string): string[] =>
  Array.from({ length: TOUR_SHORT_CAPTION_MAX }, (_, i) =>
    pattern.repeat(TOUR_SHORT_CAPTION_MAX).slice(0, i + 1),
  );

const PATTERNS = {
  wide: "W",
  "wide words": "MWm w",
  narrow: "il ",
  sentence: "This way to the guild house. ",
  "one long word": "Donaudampfschifffahrtsgesellschaft",
};

describe("a pin's label", () => {
  it.each(Object.entries(PATTERNS))(
    "draws every caption up to the limit whole (%s)",
    (_name, pattern) => {
      for (const caption of sweep(pattern)) {
        const lay = pinLabelLayout(caption, boldMeasure);
        // The text is drawn centred; it must clear the pill's inset and
        // its rounded ends on both sides.
        const drawn = boldMeasure(lay.font, caption);
        expect(
          drawn + 2 * PIN_LABEL.sidePx,
          `"${caption}" at ${String(lay.fontPx)} px`,
        ).toBeLessThanOrEqual(lay.canvasWidth);
        expect(lay.canvasWidth).toBeLessThanOrEqual(PIN_LABEL.maxWidthPx);
        expect(lay.fontPx).toBeGreaterThanOrEqual(PIN_LABEL.minFontPx);
      }
    },
  );

  it("keeps its full letter size for a caption that fits, and its height", () => {
    // Why: shrinking is the last resort; a typical caption must read at
    // the size every pin had, and every label stands as tall.
    const lay = pinLabelLayout("This way to the guild house", boldMeasure);
    expect(lay.fontPx).toBe(PIN_LABEL.fontPx);
    expect(lay.scale.y).toBe(PIN_LABEL.heightM);
    expect(lay.scale.x / lay.scale.y).toBeCloseTo(
      lay.canvasWidth / lay.canvasHeight,
      10,
    );
  });

  it("never draws a short word on a narrower pill than before", () => {
    // Why: a one-letter pin still needs a tap target and a readable pill.
    expect(pinLabelLayout("A", boldMeasure).canvasWidth).toBe(
      PIN_LABEL.minWidthPx,
    );
  });

  it("still fits a text longer than the limit, by its width alone", () => {
    // Why: a label is drawn as given; a longer text (an older file, a
    // future limit) must not clip either, it only grows past the cap.
    const text = "W".repeat(TOUR_SHORT_CAPTION_MAX * 2);
    const lay = pinLabelLayout(text, boldMeasure);
    expect(
      boldMeasure(lay.font, text) + 2 * PIN_LABEL.sidePx,
    ).toBeLessThanOrEqual(lay.canvasWidth);
  });
});
