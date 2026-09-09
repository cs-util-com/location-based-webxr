/**
 * Why these tests matter. A printed QR code is the one artefact in this
 * product that cannot be corrected after the fact - it is on a wall, and
 * the pose solve trusts the physical side length it was told. So the two
 * things that must never be wrong are the SIZE (a code printed 2 mm off
 * measures the world 2 mm off, silently) and the PLACEMENT (a code laid out
 * into a printer's unprintable border comes out clipped, and a clipped code
 * does not decode at all).
 *
 * Both are geometry, which is why the layout is a pure function with its
 * own tests rather than something you check by opening the file. The bytes
 * get a separate, structural check: a PDF that does not parse is at least a
 * loud failure, but "parses and is empty" is not, so the drawing operators
 * are counted too.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  buildQrPrintPdf,
  PAPER_SIZES_MM,
  planPrintPdf,
  type PrintablePdfCode,
} from './qr-print-pdf.js';

/** A checkerboard of `size` modules - dense enough to exercise the run
 *  merging, and every row differs from the next. */
function checkerboard(size: number, caption = 'Code 1'): PrintablePdfCode {
  const modules = new Uint8Array(size * size);
  for (let i = 0; i < modules.length; i += 1) {
    modules[i] = (Math.floor(i / size) + (i % size)) % 2 === 0 ? 1 : 0;
  }
  return { size, modules, caption };
}

describe('planPrintPdf', () => {
  it('keeps every code inside the printable area (property)', () => {
    // THE property. Everything else about this file is cosmetic next to
    // "the ink is on the paper": a block that starts inside the margin, or
    // ends past it, is a code that comes back from the printer clipped.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.double({ min: 0.02, max: 0.17, noNaN: true }),
        fc.constantFrom<'a4' | 'letter'>('a4', 'letter'),
        (count, sideM, paper) => {
          let plan;
          try {
            plan = planPrintPdf(count, { sideM, paper });
          } catch {
            return; // refused, which is the other correct answer
          }
          const margin = 6;
          for (const page of plan.pages) {
            for (const p of page) {
              expect(p.xMm).toBeGreaterThanOrEqual(margin - 1e-9);
              expect(p.yMm).toBeGreaterThanOrEqual(margin - 1e-9);
              expect(p.xMm + plan.blockMm).toBeLessThanOrEqual(
                plan.paper.widthMm - margin + 1e-9
              );
              expect(p.yMm + plan.blockMm).toBeLessThanOrEqual(
                plan.paper.heightMm - margin + 1e-9
              );
            }
          }
        }
      )
    );
  });

  it('places every code exactly once, across as many pages as it takes (property)', () => {
    // A dropped code is a poster nobody prints; a duplicated one is two
    // posters with the same identity, which the level lookup cannot tell
    // apart.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (count) => {
        const plan = planPrintPdf(count, { sideM: 0.05 });
        const placed = plan.pages.reduce((n, page) => n + page.length, 0);
        expect(placed).toBe(count);
        expect(plan.pages.length).toBe(Math.ceil(count / plan.perPage));
      })
    );
  });

  it('prints the symbol at the size that was asked for', () => {
    // The number the pose solve reads. `sideMm` is what a ruler on the
    // paper should measure across the dark modules, quiet zone excluded.
    expect(planPrintPdf(1, { sideM: 0.16 }).sideMm).toBe(160);
    // ...and the block it occupies is the symbol plus 8 % on each edge.
    expect(planPrintPdf(1, { sideM: 0.16 }).blockMm).toBeCloseTo(185.6, 6);
  });

  it('puts two small codes on a page and one large one', () => {
    // "One per page, two when the size allows" (the owner's request). At
    // 16 cm two would need 37 cm of paper, so this is a small-code case.
    expect(planPrintPdf(2, { sideM: 0.05 }).perPage).toBe(2);
    expect(planPrintPdf(2, { sideM: 0.16 }).perPage).toBe(1);
    // One code alone never shares a page with itself.
    expect(planPrintPdf(1, { sideM: 0.05 }).perPage).toBe(1);
  });

  it('refuses a size the paper cannot hold, and says which size would work', () => {
    // Why this matters: the alternative is a silently clipped code. The
    // message names the number the author should type, because the
    // arithmetic (page minus margins, divided by 1.16) is not something to
    // do standing at a printer.
    expect(() => planPrintPdf(1, { sideM: 0.25 })).toThrow(/does not fit A4/i);
    expect(() => planPrintPdf(1, { sideM: 0.25 })).toThrow(/use .* or less/i);
    // The ceiling it names must itself fit - a suggestion that also fails
    // would be worse than none.
    const message = (() => {
      try {
        planPrintPdf(1, { sideM: 0.25 });
        return '';
      } catch (err) {
        return err instanceof Error ? err.message : '';
      }
    })();
    const suggestedCm = Number(/use ([\d.]+) cm/i.exec(message)?.[1]);
    expect(Number.isFinite(suggestedCm)).toBe(true);
    expect(() => planPrintPdf(1, { sideM: suggestedCm / 100 })).not.toThrow();
  });

  it('rejects a count or a size that is not a real request', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => planPrintPdf(bad, { sideM: 0.1 }), String(bad)).toThrow(
        RangeError
      );
    }
    for (const bad of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planPrintPdf(1, { sideM: bad }), String(bad)).toThrow(
        RangeError
      );
    }
  });

  it('A4 and Letter are the real sheets, not rounded ones', () => {
    // Pinned because a wrong MediaBox is a page the printer rescales, and
    // rescaling is the exact failure this whole file exists to avoid.
    expect(PAPER_SIZES_MM.a4).toEqual({ width: 210, height: 297 });
    expect(PAPER_SIZES_MM.letter).toEqual({ width: 215.9, height: 279.4 });
  });
});

describe('buildQrPrintPdf', () => {
  it('writes a file a reader can open: header, xref, trailer, and the offsets', () => {
    // A PDF stands or falls on its cross-reference table; an off-by-one
    // there is a file that opens in one viewer and not another. This
    // re-derives every offset from the produced bytes.
    const pdf = buildQrPrintPdf([checkerboard(21)], { sideM: 0.1 });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);

    const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');

    const entries = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1])
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const [i, at] of entries.entries()) {
      expect(text.slice(at, at + 8), `object ${String(i + 1)}`).toMatch(
        new RegExp(`^${String(i + 1)} 0 obj`)
      );
    }
  });

  it('declares the paper it was asked for, one page per page of the plan', () => {
    const codes = [checkerboard(21, '1'), checkerboard(21, '2')];
    const pdf = buildQrPrintPdf(codes, { sideM: 0.16 });
    const text = new TextDecoder('latin1').decode(pdf);
    // A4 at 72 dpi: 210 mm = 595.28 pt, 297 mm = 841.89 pt.
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
    expect((text.match(/\/Type \/Page[^s]/g) ?? []).length).toBe(2);
    expect(text).toContain('/Count 2');
  });

  it('actually draws the code, not just a page around it', () => {
    // "Parses and is empty" is the failure the structural test above
    // cannot see. A 21-module checkerboard has 21*21/2 dark modules, and
    // run-merging cannot reduce a checkerboard at all - so the count is
    // known exactly and a silently blank page fails here.
    const pdf = buildQrPrintPdf([checkerboard(21)], { sideM: 0.1 });
    const text = new TextDecoder('latin1').decode(pdf);
    const fills = (text.match(/ re f/g) ?? []).length;
    expect(fills).toBe(221 + 1); // dark modules + the white quiet-zone box
  });

  it("merges each row's dark modules into runs", () => {
    // The reason a version-25 code (117x117 = 13689 modules) is a file a
    // phone can print rather than one it chokes on.
    const solid: PrintablePdfCode = {
      size: 10,
      modules: new Uint8Array(100).fill(1),
      caption: 'solid',
    };
    const pdf = buildQrPrintPdf([solid], { sideM: 0.1 });
    const text = new TextDecoder('latin1').decode(pdf);
    // Ten full rows collapse to ten rectangles, not a hundred.
    expect((text.match(/ re f/g) ?? []).length).toBe(10 + 1);
  });

  it('puts the caption on the page, with the characters a PDF string cannot carry removed', () => {
    // The caption is how an author tells poster 3 from poster 4 while
    // hanging them. An unescaped bracket would end the string early and
    // corrupt the page.
    const pdf = buildQrPrintPdf([checkerboard(21, 'Code 3 (16 cm) \\ 100%')], {
      sideM: 0.1,
    });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text).toContain('(Code 3 \\(16 cm\\) \\\\ 100%) Tj');
  });

  it('refuses a matrix whose length does not match its size', () => {
    // Defensive at the boundary: a short matrix would read undefined
    // modules as light and print a code that decodes to something else.
    expect(() =>
      buildQrPrintPdf(
        [{ size: 21, modules: new Uint8Array(10), caption: 'x' }],
        { sideM: 0.1 }
      )
    ).toThrow(/needs 441 modules/);
  });

  it('draws the matrix the right way up', () => {
    // PDF's y grows upward and a QR matrix's first row is its TOP one. Get
    // this wrong and every code prints mirrored top-to-bottom - which
    // still scans as a valid QR for a symmetric pattern and silently does
    // not for a real one, so it is worth pinning directly.
    const topRowOnly: PrintablePdfCode = {
      size: 4,
      modules: new Uint8Array([1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      caption: 'top',
    };
    const plan = planPrintPdf(1, { sideM: 0.1 });
    const pdf = buildQrPrintPdf([topRowOnly], { sideM: 0.1 });
    const text = new TextDecoder('latin1').decode(pdf);
    // The one dark run must sit in the TOP quarter of the symbol box.
    const runs = [
      ...text.matchAll(/^([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f$/gm),
    ];
    expect(runs.length).toBe(2); // the white quiet box, then the one dark run
    const quietMm = (plan.blockMm - plan.sideMm) / 2;
    const bottomOfSymbolPt =
      ((plan.pages[0]?.[0]?.yMm ?? 0) + quietMm) * (72 / 25.4);
    const symbolHeightPt = plan.sideMm * (72 / 25.4);
    // The drawn run (the last rectangle emitted for this code) starts in
    // the top quarter.
    const runY = Number(runs.at(-1)?.[2]);
    expect(runY).toBeGreaterThan(bottomOfSymbolPt + symbolHeightPt * 0.7);
  });
});

describe('the drawn page round-trips back to the matrix it was given', () => {
  /**
   * Re-sample the content stream onto the module grid: for each module,
   * take its centre point and ask whether any black rectangle covers it.
   *
   * Why this is the test that matters. Everything the drawing can get
   * wrong - a transposed matrix, a vertical mirror, an off-by-one in the
   * run merge, a step that drifts across 117 modules - produces a file
   * that still parses, still looks like a QR code, and decodes to
   * something else or to nothing. A renderer would catch it; there is no
   * renderer in this suite, so the drawing is read back instead.
   */
  function sampleBack(
    pdfText: string,
    code: PrintablePdfCode,
    plan: ReturnType<typeof planPrintPdf>
  ): Uint8Array {
    const ptPerMm = 72 / 25.4;
    const rects = [
      ...pdfText.matchAll(/^([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f$/gm),
    ]
      .map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
        w: Number(m[3]),
        h: Number(m[4]),
      }))
      // The first rectangle of each code is its white quiet-zone box.
      .slice(1);
    const placement = plan.pages[0]?.[0];
    if (placement === undefined) throw new Error('no placement');
    const quietMm = (plan.blockMm - plan.sideMm) / 2;
    const originX = (placement.xMm + quietMm) * ptPerMm;
    const originY = (placement.yMm + quietMm) * ptPerMm;
    const step = (plan.sideMm * ptPerMm) / code.size;
    const out = new Uint8Array(code.size * code.size);
    for (let row = 0; row < code.size; row += 1) {
      for (let col = 0; col < code.size; col += 1) {
        const cx = originX + (col + 0.5) * step;
        // The matrix's row 0 is the TOP one; PDF y grows upward.
        const cy = originY + (code.size - 1 - row + 0.5) * step;
        const covered = rects.some(
          (r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
        );
        out[row * code.size + col] = covered ? 1 : 0;
      }
    }
    return out;
  }

  it('reproduces a real QR matrix module for module (property over sizes)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 21, max: 77 }).map((n) => n - ((n - 21) % 4)),
        fc.integer({ min: 0, max: 2 ** 30 }),
        (size, seed) => {
          // A pseudo-random matrix of the right shape: the drawing does not
          // know or care that a real QR has finder patterns, and a random
          // grid exercises far more run boundaries than one code would.
          const modules = new Uint8Array(size * size);
          let x = seed | 1;
          for (let i = 0; i < modules.length; i += 1) {
            x = (x * 1103515245 + 12345) & 0x7fffffff;
            modules[i] = (x >> 16) & 1;
          }
          const code: PrintablePdfCode = { size, modules, caption: 'c' };
          const plan = planPrintPdf(1, { sideM: 0.16 });
          const text = new TextDecoder('latin1').decode(
            buildQrPrintPdf([code], { sideM: 0.16 })
          );
          expect(Array.from(sampleBack(text, code, plan))).toEqual(
            Array.from(modules)
          );
        }
      ),
      { numRuns: 15 }
    );
  });
});
