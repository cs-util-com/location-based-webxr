/**
 * The poster text on the print PDF (Tour Viewer polish round D-P7/D-P8):
 * a title and an explanation above each code, a call to action below it.
 *
 * Why these tests matter: the owner asked twice for a sheet that can be
 * laminated and hung as it comes out of the printer. The text must never
 * cost the code anything - not its size, not its quiet zone, not its place
 * inside the printable area - so the code's geometry is asserted unchanged
 * and the text is held to the same ink rules as the code. And the text is
 * "scaled to the code": it shrinks where the sheet is short, and below a
 * readable size a part is dropped - the explanation first, the call to
 * action last.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  buildQrPrintPdf,
  captionEmMm,
  maxPrintablePdfSideM,
  planPrintPdf,
  type PosterText,
  type PrintablePdfCode,
} from './qr-print-pdf.js';
import { pdfLiteral, textWidthEm, toWinAnsi } from './pdf-text.js';

const POSTER: PosterText = {
  title: 'Harbour Lights',
  explanation: 'AR tour starts here',
  callToAction: 'Scan with your phone camera',
};

function checkerboard(size: number, caption = 'Code 1'): PrintablePdfCode {
  const modules = new Uint8Array(size * size);
  for (let i = 0; i < modules.length; i += 1) {
    modules[i] = (Math.floor(i / size) + (i % size)) % 2 === 0 ? 1 : 0;
  }
  return { size, modules, caption };
}

function parts(plan: ReturnType<typeof planPrintPdf>): string[] {
  return [...new Set(plan.poster.lines.map((line) => line.part))];
}

describe('the poster text in the plan', () => {
  it('changes nothing about the codes: same size, same ceiling, same refusal', () => {
    for (const sideM of [0.03, 0.05, 0.08, 0.12, 0.18]) {
      const bare = planPrintPdf(3, { sideM });
      const withText = planPrintPdf(3, { sideM, poster: POSTER });
      expect(withText.sideMm).toBe(bare.sideMm);
      expect(withText.blockMm).toBe(bare.blockMm);
      expect(withText.columns).toBe(bare.columns);
    }
    const ceiling = maxPrintablePdfSideM('a4');
    expect(() =>
      planPrintPdf(1, { sideM: ceiling, poster: POSTER })
    ).not.toThrow();
    expect(() =>
      planPrintPdf(1, { sideM: ceiling + 0.001, poster: POSTER })
    ).toThrow(/does not fit A4/);
  });

  // The owner's default poster: one 18 cm code on A4 with all three texts.
  it('puts all three texts on an 18 cm A4 poster: title and explanation above, call to action below', () => {
    const plan = planPrintPdf(1, { sideM: 0.18, poster: POSTER });
    expect(parts(plan)).toEqual(['title', 'explanation', 'callToAction']);
    const title = plan.poster.lines.find((l) => l.part === 'title');
    const cta = plan.poster.lines.find((l) => l.part === 'callToAction');
    expect(title?.dyMm).toBeGreaterThan(plan.blockMm);
    expect(cta?.dyMm).toBeLessThan(0);
    // Big enough to read from a few metres: a title of 30 pt or more.
    expect(((title?.emMm ?? 0) * 72) / 25.4).toBeGreaterThan(30);
    expect(title?.font).toBe('bold');
  });

  // A11: the owner's five 5 cm codes once came out two to a page, the rest
  // of each sheet empty. The text shrinks before a page loses a row, and a
  // row goes only where even the smallest readable text needs the room.
  it('shrinks the text before it costs a page a row of codes', () => {
    // Swept over every whole centimetre a sheet holds: with all three
    // texts kept, a page gives up at most one row.
    for (let cm = 3; cm <= 18; cm += 1) {
      const bare = planPrintPdf(12, { sideM: cm / 100 });
      const withText = planPrintPdf(12, { sideM: cm / 100, poster: POSTER });
      expect(parts(withText), `${String(cm)} cm`).toEqual([
        'title',
        'explanation',
        'callToAction',
      ]);
      expect(withText.rows, `${String(cm)} cm`).toBeGreaterThanOrEqual(
        bare.rows - 1
      );
    }
    // Where the bare grid leaves room between its rows, the text takes
    // that room and no row goes (measured: 5, 8, 9 and 12-18 cm; 3, 4, 6,
    // 7, 10 and 11 cm lose one).
    for (const sideM of [0.05, 0.08]) {
      expect(planPrintPdf(12, { sideM, poster: POSTER }).rows).toBe(
        planPrintPdf(12, { sideM }).rows
      );
    }
  });

  it('keeps the text in proportion to the code', () => {
    const small = planPrintPdf(1, { sideM: 0.06, poster: POSTER });
    const large = planPrintPdf(1, { sideM: 0.12, poster: POSTER });
    const em = (plan: typeof small) =>
      plan.poster.lines.find((l) => l.part === 'title')?.emMm ?? 0;
    expect(em(large)).toBeCloseTo(2 * em(small), 6);
  });

  // D-P8: below a readable size a part is dropped; the call to action is
  // the one kept longest - it is the instruction a passer-by needs.
  it('drops the explanation first, then the title, the call to action last', () => {
    const kept = (sideM: number): string[] =>
      parts(planPrintPdf(1, { sideM, poster: POSTER }));
    // The order holds at every size: no explanation without a title, no
    // title without the call to action.
    const allowed = [
      [],
      ['callToAction'],
      ['title', 'callToAction'],
      ['title', 'explanation', 'callToAction'],
    ];
    for (let mm = 10; mm <= 180; mm += 2) {
      expect(allowed, `${String(mm)} mm`).toContainEqual(kept(mm / 1000));
    }
    // The steps, at sizes chosen on either side of them: the call to action
    // keeps a readable floor where the others are proportional, so it is
    // the last to go - when even two lines of it no longer fit the code.
    expect(kept(0.012)).toEqual([]);
    expect(kept(0.016)).toEqual(['callToAction']);
    expect(kept(0.022)).toEqual(['title', 'callToAction']);
    expect(kept(0.06)).toEqual(['title', 'explanation', 'callToAction']);
  });

  it('leaves an empty or missing part off, and prints no text without a poster', () => {
    const plan = planPrintPdf(1, {
      sideM: 0.1,
      poster: { title: '  ', callToAction: 'Scan me' },
    });
    expect(parts(plan)).toEqual(['callToAction']);
    expect(planPrintPdf(1, { sideM: 0.1 }).poster.lines).toEqual([]);
  });

  it('wraps a long title onto a second line rather than off the paper', () => {
    const plan = planPrintPdf(1, {
      sideM: 0.18,
      poster: {
        title: 'The old harbour and the lighthouse walk of Neustadt',
      },
    });
    const titles = plan.poster.lines.filter((l) => l.part === 'title');
    expect(titles.length).toBe(2);
  });

  it('keeps every line of text inside the margin, off every quiet zone and above the check bar (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }),
        fc.double({ min: 0.02, max: 0.18, noNaN: true }),
        fc.constantFrom<'a4' | 'letter'>('a4', 'letter'),
        fc.record({
          title: fc.string({ maxLength: 40 }),
          explanation: fc.string({ maxLength: 40 }),
          callToAction: fc.string({ maxLength: 40 }),
        }),
        (count, sideM, paper, poster) => {
          const plan = planPrintPdf(count, { sideM, paper, poster });
          const margin = 6;
          const eps = 1e-6;
          for (const page of plan.pages) {
            const boxes = page.map((p) => ({
              x0: p.xMm,
              x1: p.xMm + plan.blockMm,
              y0: p.yMm,
              y1: p.yMm + plan.blockMm,
            }));
            for (const p of page) {
              for (const line of plan.poster.lines) {
                const x0 = p.xMm + plan.blockMm / 2 - line.widthMm / 2;
                const x1 = x0 + line.widthMm;
                // The line's box: a descender below the baseline, the
                // ascender above it.
                const y0 = p.yMm + line.dyMm - 0.25 * line.emMm;
                // 0.96 em: an accented capital (Å, Ü) rises above the
                // plain ascender (M0c review, finding 7).
                const y1 = p.yMm + line.dyMm + 0.96 * line.emMm;
                expect(x0).toBeGreaterThanOrEqual(margin - eps);
                expect(x1).toBeLessThanOrEqual(
                  plan.paper.widthMm - margin + eps
                );
                expect(y1).toBeLessThanOrEqual(
                  plan.paper.heightMm - margin + eps
                );
                expect(y0).toBeGreaterThanOrEqual(
                  plan.checkBar.yMm + plan.checkBar.bandMm - eps
                );
                for (const box of boxes) {
                  const clear =
                    x1 <= box.x0 + eps ||
                    x0 >= box.x1 - eps ||
                    y1 <= box.y0 + eps ||
                    y0 >= box.y1 - eps;
                  expect(clear).toBe(true);
                }
              }
            }
          }
        }
      )
    );
  });
});

describe('the caption under each code (M0c review, finding 4)', () => {
  // Why: the caption ("Code 12 - 3 cm - print at 100%") was drawn at 9 pt
  // whatever the code's size; at 2-3 cm it ran over its neighbours and off
  // the sheet, at 4 cm into the margin. It is ink: inside the margin and
  // inside its own code's column, at every legal size.
  it('stays inside the margin and its own column at every size (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.double({ min: 0.01, max: 0.18, noNaN: true }),
        fc.constantFrom<'a4' | 'letter'>('a4', 'letter'),
        (count, sideM, paper) => {
          const plan = planPrintPdf(count, { sideM, paper, poster: POSTER });
          const quiet = (plan.blockMm - plan.sideMm) / 2;
          const eps = 1e-6;
          for (const page of plan.pages) {
            for (const [i, p] of page.entries()) {
              const caption = `Code ${String(i + 12)} - ${String(
                Math.round(sideM * 1000) / 10
              )} cm - print at 100%`;
              const em = captionEmMm(caption, plan);
              const width = textWidthEm(toWinAnsi(caption), 'regular') * em;
              const x0 = p.xMm + quiet;
              expect(x0).toBeGreaterThanOrEqual(6 - eps);
              expect(x0 + width).toBeLessThanOrEqual(
                Math.min(plan.paper.widthMm - 6, x0 + plan.sideMm) + eps
              );
              expect(em).toBeLessThanOrEqual((9 * 25.4) / 72 + eps);
            }
          }
        }
      )
    );
  });

  it('keeps the full 9 pt where it fits', () => {
    const plan = planPrintPdf(1, { sideM: 0.18 });
    expect(captionEmMm('Code 1 - 18 cm - print at 100%', plan)).toBeCloseTo(
      (9 * 25.4) / 72,
      9
    );
  });
});

describe('a title that cannot fit (M0c review, finding 8a)', () => {
  // Why: the drop order is explanation, then title, then call to action;
  // a title too long to wrap at a small size took the explanation with it.
  it('keeps the explanation and the call to action', () => {
    const plan = planPrintPdf(1, {
      sideM: 0.04,
      poster: {
        ...POSTER,
        title: 'Stadtfuehrungsrundgangsbeschreibung',
      },
    });
    expect(parts(plan)).toEqual(['explanation', 'callToAction']);
  });
});

describe('the poster text in the file', () => {
  it('writes the text in the bold and the regular face, umlauts as WinAnsi bytes', () => {
    const pdf = buildQrPrintPdf([checkerboard(21)], {
      sideM: 0.18,
      poster: { ...POSTER, title: 'Hafenführung' },
    });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text).toContain('/BaseFont /Helvetica-Bold');
    expect(text).toContain(`(${pdfLiteral(toWinAnsi('Hafenführung'))}) Tj`);
    expect(text).toContain('(AR tour starts here) Tj');
    expect(text).toContain('(Scan with your phone camera) Tj');
    // The file stays ASCII: the umlaut is an octal escape, not two bytes.
    expect([...pdf].every((byte) => byte < 0x80)).toBe(true);
  });

  it('moves the code caption below the call to action', () => {
    const plan = planPrintPdf(1, { sideM: 0.1, poster: POSTER });
    const cta = plan.poster.lines.find((l) => l.part === 'callToAction');
    expect(plan.poster.captionDyMm).toBeLessThan(cta?.dyMm ?? 0);
  });
});

describe('a code without a caption (owner, on r821)', () => {
  // Why: the owner did not want the "Code 2 - 18cm - print at 100%" line
  // on the poster. An empty caption draws nothing - not even an empty
  // text object - and captionMm 0 gives its band back to the layout.
  it('draws no caption for an empty one', () => {
    const text = new TextDecoder('latin1').decode(
      buildQrPrintPdf([checkerboard(21, '')], { sideM: 0.1, captionMm: 0 })
    );
    expect(text).not.toContain('() Tj');
    expect((text.match(/ Tj/g) ?? []).length).toBe(1); // the check bar's line
  });

  // The band goes to the layout: never fewer codes per page, and at some
  // sizes more (a 10 cm A4 page holds two with all three texts).
  it('gives the caption band back with captionMm 0', () => {
    for (let cm = 3; cm <= 18; cm += 1) {
      const sideM = cm / 100;
      const withBand = planPrintPdf(12, { sideM, poster: POSTER });
      const without = planPrintPdf(12, { sideM, poster: POSTER, captionMm: 0 });
      expect(without.perPage, `${String(cm)} cm`).toBeGreaterThanOrEqual(
        withBand.perPage
      );
    }
    expect(
      planPrintPdf(2, { sideM: 0.1, poster: POSTER, captionMm: 0 }).perPage
    ).toBe(2);
  });
});
