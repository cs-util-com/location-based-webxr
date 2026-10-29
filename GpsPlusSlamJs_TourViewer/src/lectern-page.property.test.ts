/**
 * Why this property matters: the reading stand must never show a page
 * without the sentence it is on, and its tap must always lead somewhere:
 * on, through every paragraph, and back to the start. A sentence split that
 * loses characters, a window that slides past its sentence, or a turn that
 * sticks (a long sentence wider than seven lines) would each leave a
 * visitor tapping a page that does not change. Swept over random texts,
 * widths from a narrow 4 units to a wide 60 and measures of one or two
 * units per character, so no single line width carries the verdict.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  analyzeLecternText,
  LECTERN_PAGE,
  lecternTurn,
  lecternWindowStart,
  wrapLecternParagraph,
} from "./lectern-page";

const word = fc.stringMatching(/^[A-Za-z0-9]{1,9}$/);
const sentence = fc
  .tuple(
    fc.array(word, { minLength: 1, maxLength: 12 }),
    fc.constantFrom(".", "!", "?", "…", ""),
  )
  .map(([words, end]) => {
    const [first = "A", ...rest] = words;
    return (
      `${first.charAt(0).toUpperCase()}${first.slice(1)} ${rest.join(" ")}`.trim() +
      end
    );
  });
const paragraph = fc
  .array(sentence, { minLength: 1, maxLength: 12 })
  .map((s) => s.join(" "));
const text = fc
  .array(paragraph, { minLength: 0, maxLength: 5 })
  .map((p) => p.join("\n\n"));
const width = fc.integer({ min: 4, max: 60 });
const perChar = fc.constantFrom(1, 2);

describe("lectern page invariants", () => {
  it("every sentence lies inside its paragraph, in order, and covers its words", () => {
    fc.assert(
      fc.property(text, (t) => {
        const a = analyzeLecternText(t);
        let last = -1;
        for (const s of a.sentences) {
          const p = a.paragraphs[s.p];
          expect(p).toBeDefined();
          expect(s.from).toBeGreaterThan(last);
          expect(s.to).toBeGreaterThan(s.from);
          expect(s.from).toBeGreaterThanOrEqual(p!.from);
          expect(s.to).toBeLessThanOrEqual(p!.to);
          last = s.to - 1;
        }
        // Every non-space character of a paragraph belongs to a sentence.
        for (const p of a.paragraphs) {
          for (let i = p.from; i < p.to; i += 1) {
            if (/\s/.test(t[i] ?? "")) continue;
            expect(
              a.sentences.some((s) => s.p >= 0 && s.from <= i && i < s.to),
            ).toBe(true);
          }
        }
      }),
    );
  });

  it("the window always shows the line the current sentence starts on", () => {
    fc.assert(
      fc.property(text, width, perChar, (t, w, k) => {
        const a = analyzeLecternText(t);
        const measure = (s: string) => s.length * k;
        a.sentences.forEach((s) => {
          const lines = wrapLecternParagraph(a, s.p, measure, w * k);
          const start = lecternWindowStart(lines, s.from);
          const shown = lines.slice(start, start + LECTERN_PAGE.rows);
          // A sentence starts on a word (it is split after a space), so
          // the word it starts with is on the page.
          expect(shown.some((l) => l.some((tk) => tk.from === s.from))).toBe(
            true,
          );
        });
      }),
    );
  });

  it("a turn moves forward or wraps to the first sentence, and tapping visits every paragraph", () => {
    fc.assert(
      fc.property(text, width, perChar, (t, w, k) => {
        const a = analyzeLecternText(t);
        const measure = (s: string) => s.length * k;
        let s = 0;
        const seen = new Set<number>();
        // Enough taps to go round once: each moves on by at least one
        // sentence, so one per sentence plus the wrap.
        for (let i = 0; i <= a.sentences.length; i += 1) {
          if (a.sentences[s] !== undefined) seen.add(a.sentences[s]!.p);
          const next = lecternTurn(a, s, measure, w * k);
          expect(Number.isInteger(next)).toBe(true);
          expect(next === 0 || next > s).toBe(true);
          expect(next).toBeLessThan(Math.max(1, a.sentences.length));
          s = next;
        }
        expect(seen.size).toBe(a.paragraphs.length);
      }),
    );
  });
});
