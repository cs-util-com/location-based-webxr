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
  maxPrintablePdfSideM,
  PAPER_SIZES_MM,
  planPrintPdf,
  type PrintablePdfCode,
} from './qr-print-pdf.js';
import { MAX_HOME_PRINTABLE_SIDE_M } from './qr-print-plan.js';
import { AUTHOR_DEFAULT_SIZE_M } from '../../ar/qr/qr-mint-level.js';

/** A checkerboard of `size` modules - dense enough to exercise the run
 *  merging, and every row differs from the next. */
function checkerboard(size: number, caption = 'Code 1'): PrintablePdfCode {
  const modules = new Uint8Array(size * size);
  for (let i = 0; i < modules.length; i += 1) {
    modules[i] = (Math.floor(i / size) + (i % size)) % 2 === 0 ? 1 : 0;
  }
  return { size, modules, caption };
}

/**
 * How many filled rectangles a page draws besides the code's dark runs:
 * the white quiet box and the 10 cm check bar. Read from a render of an
 * all-light code rather than restated, so the counts below stay about the
 * code itself.
 */
function baselineFills(sideM: number): number {
  const light = new TextDecoder('latin1').decode(
    buildQrPrintPdf(
      [{ size: 4, modules: new Uint8Array(16), caption: 'light' }],
      { sideM }
    )
  );
  return (light.match(/ re f/g) ?? []).length;
}

describe('planPrintPdf', () => {
  it('keeps all ink inside the margin and every quiet zone on the paper (property)', () => {
    // THE property, restated for the polish round (M0b, the owner's P7: "as
    // large as possible, as little margin as possible"). The margin exists
    // because a printer cannot put INK into its unprintable border; the
    // quiet zone is blank paper and may reach into it. So: the symbol, its
    // caption and the check bar stay 6 mm inside the edge; the white
    // quiet-zone box only has to be on the sheet; and no two codes (with
    // their captions) overlap.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.double({ min: 0.02, max: 0.19, noNaN: true }),
        fc.constantFrom<'a4' | 'letter'>('a4', 'letter'),
        (count, sideM, paper) => {
          let plan;
          try {
            plan = planPrintPdf(count, { sideM, paper });
          } catch {
            return; // refused, which is the other correct answer
          }
          const margin = 6;
          const caption = 8;
          const eps = 1e-9;
          const quiet = (plan.blockMm - plan.sideMm) / 2;
          for (const page of plan.pages) {
            for (const p of page) {
              // The quiet box is on the sheet.
              expect(p.xMm).toBeGreaterThanOrEqual(-eps);
              expect(p.xMm + plan.blockMm).toBeLessThanOrEqual(
                plan.paper.widthMm + eps
              );
              expect(p.yMm + plan.blockMm).toBeLessThanOrEqual(
                plan.paper.heightMm + eps
              );
              // The symbol is inside the margin.
              expect(p.xMm + quiet).toBeGreaterThanOrEqual(margin - eps);
              expect(p.xMm + quiet + plan.sideMm).toBeLessThanOrEqual(
                plan.paper.widthMm - margin + eps
              );
              expect(p.yMm + quiet + plan.sideMm).toBeLessThanOrEqual(
                plan.paper.heightMm - margin + eps
              );
              // The caption under the box clears the check bar's band.
              expect(p.yMm - caption).toBeGreaterThanOrEqual(
                plan.checkBar.yMm + plan.checkBar.bandMm - eps
              );
            }
            // No two codes (box and caption) overlap.
            for (const [i, a] of page.entries()) {
              for (const b of page.slice(i + 1)) {
                const apart =
                  a.xMm + plan.blockMm <= b.xMm + eps ||
                  b.xMm + plan.blockMm <= a.xMm + eps ||
                  a.yMm + plan.blockMm <= b.yMm - caption + eps ||
                  b.yMm + plan.blockMm <= a.yMm - caption + eps;
                expect(apart).toBe(true);
              }
            }
          }
          // The check bar is ink too: inside the margin.
          expect(plan.checkBar.xMm).toBeGreaterThanOrEqual(margin - eps);
          expect(plan.checkBar.yMm).toBeGreaterThanOrEqual(margin - eps);
          expect(
            plan.checkBar.xMm + plan.checkBar.lengthMm
          ).toBeLessThanOrEqual(plan.paper.widthMm - margin + eps);
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

  it('packs as many codes as fit in rows and columns (A11)', () => {
    // The owner printed five 5 cm codes and got two per page - most of each
    // sheet empty. The page now holds a grid of as many as fit.
    const small = planPrintPdf(5, { sideM: 0.05 });
    expect(small.pages).toHaveLength(1);
    expect(small.pages[0]).toHaveLength(5);
    expect(small.columns).toBeGreaterThanOrEqual(3);
    expect(small.perPage).toBe(small.columns * small.rows);
    // 8 cm: two across, two down.
    expect(planPrintPdf(4, { sideM: 0.08 }).perPage).toBe(4);
    // A large code still gets its own page.
    expect(planPrintPdf(2, { sideM: 0.16 }).perPage).toBe(1);
  });

  it('fits an 18 cm code on A4 and on Letter, and names 18 cm as the A4 ceiling (P7)', () => {
    // The owner's default: as large as A4 allows. 18 cm plus its quiet zone
    // is 208.8 mm against a 210 mm sheet - it fits only because the quiet
    // zone may reach into the margin, which is blank paper.
    expect(() => planPrintPdf(1, { sideM: 0.18 })).not.toThrow();
    expect(() =>
      planPrintPdf(1, { sideM: 0.18, paper: 'letter' })
    ).not.toThrow();
    // The ceiling is the largest whole millimetre: 18.1 cm still fits
    // (209.96 mm with its quiet zone), 18.2 cm does not.
    expect(maxPrintablePdfSideM('a4')).toBeGreaterThanOrEqual(0.18);
    expect(maxPrintablePdfSideM('a4')).toBeLessThan(0.19);
  });

  it('refuses a size the paper cannot hold, and says which size would work', () => {
    // Why this matters: the alternative is a silently clipped code. The
    // message names the number the author should type, because the
    // arithmetic (page minus margins, over the quiet-zone footprint factor)
    // is not something to
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

  // Why (PR #586 review): a comment and the sidecar once called the grid
  // "top-anchored" while the code centred it; nothing pinned either. The
  // stack sits midway between the check bar's band and the highest a box
  // top may sit (the sheet's edge band, as the quiet zone is blank paper).
  it('centres a page of codes vertically above the check bar', () => {
    for (const [count, sideM] of [
      [1, 0.1],
      [3, 0.08],
      [5, 0.05],
    ] as const) {
      const plan = planPrintPdf(count, { sideM });
      const page = plan.pages[0] ?? [];
      const top = Math.max(...page.map((p) => p.yMm + plan.blockMm));
      const bottom = Math.min(...page.map((p) => p.yMm)) - 8; // the caption
      const quiet = (plan.blockMm - plan.sideMm) / 2;
      const ceiling = 297 - Math.max(0, 6 - quiet);
      const floor = plan.checkBar.yMm + plan.checkBar.bandMm;
      expect(ceiling - top, `${String(count)} at ${String(sideM)}`).toBeCloseTo(
        bottom - floor,
        6
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
    // dark modules + the quiet box and the check bar
    expect(fills).toBe(221 + baselineFills(0.1));
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
    expect((text.match(/ re f/g) ?? []).length).toBe(10 + baselineFills(0.1));
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
    const quietMm = (plan.blockMm - plan.sideMm) / 2;
    const bottomOfSymbolPt =
      ((plan.pages[0]?.[0]?.yMm ?? 0) + quietMm) * (72 / 25.4);
    // The code's rectangles: the check bar sits far below the symbol.
    const runs = [
      ...text.matchAll(/^([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f$/gm),
    ].filter(
      (m) => Number(m[2]) >= bottomOfSymbolPt - 1 - quietMm * (72 / 25.4)
    );
    expect(runs.length).toBe(2); // the white quiet box, then the one dark run
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
    // Bucket the rectangles by the module row they sit in. A linear scan
    // per sample is O(modules x rects), which at version 25 is a quarter of
    // a billion comparisons and times the property out; each rectangle
    // belongs to exactly one row, so three buckets are enough to cover a
    // sample and its neighbours.
    const byRow = new Map<number, typeof rects>();
    for (const r of rects) {
      const band = Math.round((r.y + r.h - originY) / step) - 1;
      const bucket = byRow.get(band) ?? [];
      bucket.push(r);
      byRow.set(band, bucket);
    }
    const covers = (x: number, y: number): boolean => {
      const band = Math.floor((y - originY) / step);
      for (const near of [band - 1, band, band + 1]) {
        for (const r of byRow.get(near) ?? []) {
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            return true;
          }
        }
      }
      return false;
    };
    const out = new Uint8Array(code.size * code.size);
    for (let row = 0; row < code.size; row += 1) {
      for (let col = 0; col < code.size; col += 1) {
        const cx = originX + (col + 0.5) * step;
        // The matrix's row 0 is the TOP one; PDF y grows upward.
        const cy = originY + (code.size - 1 - row + 0.5) * step;
        // FIVE points, not one. A centre-only sample is blind to any
        // extent error under half a module - the band that produces a code
        // which scans badly rather than not at all. Measured by mutating
        // the writer: with one point, a row overlap of 1.40 and runs drawn
        // 0.45 module too wide both SURVIVE; at 0.45 of a module from the
        // centre they do not, while the real 0.02 overlap still passes.
        const edge = 0.45 * step;
        const dark = [
          covers(cx, cy),
          covers(cx - edge, cy),
          covers(cx + edge, cy),
          covers(cx, cy - edge),
          covers(cx, cy + edge),
        ].filter(Boolean).length;
        // Disagreement means ink is spilling across a module boundary;
        // encode it as neither 0 nor 1 so the comparison fails loudly
        // instead of rounding to whatever was expected.
        out[row * code.size + col] = dark === 5 ? 1 : dark === 0 ? 0 : 2;
      }
    }
    return out;
  }

  it('reproduces a real QR matrix module for module (property over sizes)', () => {
    fc.assert(
      fc.property(
        // Up to 117 modules: version 25, which is what the run-merge
        // rationale and 'a step that drifts across 117 modules' both name.
        fc.integer({ min: 21, max: 117 }).map((n) => n - ((n - 21) % 4)),
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

describe('the parts nothing else watches', () => {
  it('fills a grid page and puts the rest on the next (byte path)', () => {
    // The multi-code packing at the BYTE level: every slot of a full page
    // is drawn, the odd one goes to its own page, and each page carries its
    // check bar's label.
    const codes = [1, 2, 3, 4, 5].map((n) =>
      checkerboard(21, `Code ${String(n)}`)
    );
    const text = new TextDecoder('latin1').decode(
      buildQrPrintPdf(codes, { sideM: 0.08 })
    );
    expect(text).toContain('/Count 2');
    const streams = [...text.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(
      (m) => m[1] ?? ''
    );
    expect(streams).toHaveLength(2);
    expect((streams[0]?.match(/\(Code \d\) Tj/g) ?? []).length).toBe(4);
    expect((streams[1]?.match(/\(Code \d\) Tj/g) ?? []).length).toBe(1);
    for (const stream of streams) expect(stream).toContain('10 cm');
  });

  it('draws a symbol exactly as tall as it is wide', () => {
    // The overlap that closes the seam between rows must not make the
    // symbol taller than the side it declares - this file's one hard
    // invariant is that a ruler across the dark modules reads the number
    // the author typed. It used to measure 160.15 mm for a declared 160,
    // and put 0.15 mm of ink into the quiet zone.
    const plan = planPrintPdf(1, { sideM: 0.16 });
    const text = new TextDecoder('latin1').decode(
      buildQrPrintPdf([checkerboard(21)], { sideM: 0.16 })
    );
    const rects = [
      ...text.matchAll(/^([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f$/gm),
    ]
      .map((m) => ({ y: Number(m[2]), h: Number(m[4]) }))
      .slice(1); // the first is the white quiet-zone box
    const ptPerMm = 72 / 25.4;
    const quietMm = (plan.blockMm - plan.sideMm) / 2;
    const bottom = ((plan.pages[0]?.[0]?.yMm ?? 0) + quietMm) * ptPerMm;
    // The check bar's rectangles sit far below the code; leave them out.
    const symbolRects = rects.filter((r) => r.y >= bottom - 1);
    const top = bottom + plan.sideMm * ptPerMm;
    expect(symbolRects.length).toBeGreaterThan(0);
    expect(Math.min(...symbolRects.map((r) => r.y))).toBeGreaterThanOrEqual(
      bottom - 0.02
    );
    expect(Math.max(...symbolRects.map((r) => r.y + r.h))).toBeLessThanOrEqual(
      top + 0.02
    );
  });

  it('treats a hole or a stringy module as LIGHT, not dark', () => {
    // `!== 0` read `undefined` and the string '0' as dark, so a holey array
    // of the right length rendered a solid black square - a code that
    // cannot be scanned and looks deliberate.
    const holey = {
      size: 4,
      modules: new Array<number>(16),
      caption: 'holes',
    };
    const text = new TextDecoder('latin1').decode(
      buildQrPrintPdf([holey], { sideM: 0.05 })
    );
    // Nothing but what an all-light matrix draws (the quiet box, the bar).
    const light = new TextDecoder('latin1').decode(
      buildQrPrintPdf(
        [{ size: 4, modules: new Uint8Array(16), caption: 'holes' }],
        { sideM: 0.05 }
      )
    );
    expect((text.match(/ re f/g) ?? []).length).toBe(
      (light.match(/ re f/g) ?? []).length
    );
  });

  it('names a PDF ceiling larger than the browser-print one, and prints at it', () => {
    // The print step judges sizes against THIS ceiling (it prints by PDF
    // only). The browser-print ceiling is about the browser's own dialog
    // and ~7 mm stricter; judged by it, a 17 cm code would be refused
    // although the PDF prints it correctly.
    const ceiling = maxPrintablePdfSideM('a4');
    // Compared against the imported ceiling, not a copied 0.164: the browser
    // number moves if the quiet zone ever does, and a literal here would
    // keep passing while the claim it encodes stopped being true.
    expect(ceiling).toBeGreaterThan(MAX_HOME_PRINTABLE_SIDE_M);
    expect(() => planPrintPdf(1, { sideM: ceiling })).not.toThrow();
    expect(() => planPrintPdf(1, { sideM: ceiling + 0.001 })).toThrow(
      RangeError
    );
  });
});

describe('the print-scale guards (polish round M0b, A10)', () => {
  // Why: the owner's 16 cm code measured 15.3-15.5 cm - a print scaled by
  // the dialog. A PDF cannot stop a printer from scaling, but it can ask
  // the viewer not to, and give the person a ruler check on every page.
  it('asks the viewer not to scale the print', () => {
    const text = new TextDecoder('latin1').decode(
      buildQrPrintPdf([checkerboard(21)], { sideM: 0.16 })
    );
    expect(text).toMatch(/\/ViewerPreferences << \/PrintScaling \/None >>/);
  });

  it('draws a 10 cm check bar, labelled, on every page', () => {
    const plan = planPrintPdf(2, { sideM: 0.16 });
    expect(plan.checkBar.lengthMm).toBe(100);
    const text = new TextDecoder('latin1').decode(
      buildQrPrintPdf([checkerboard(21), checkerboard(21)], { sideM: 0.16 })
    );
    const widthPt = (100 * 72) / 25.4;
    const bars = [
      ...text.matchAll(/^[\d.]+ [\d.]+ ([\d.]+) [\d.]+ re f$/gm),
    ].filter((m) => Math.abs(Number(m[1]) - widthPt) < 0.02);
    expect(bars).toHaveLength(2); // one per page
    expect((text.match(/10 cm/g) ?? []).length).toBe(2);
  });
});

describe('the authoring default size (polish round M0b, P7)', () => {
  // Why: the Tour Viewer prefills this size and prints it by PDF only. A
  // default the PDF refuses would greet every creator with an error.
  it('is a size the PDF prints on A4 and on Letter', () => {
    expect(AUTHOR_DEFAULT_SIZE_M).toBe(0.18);
    expect(AUTHOR_DEFAULT_SIZE_M).toBeLessThanOrEqual(
      maxPrintablePdfSideM('a4')
    );
    expect(AUTHOR_DEFAULT_SIZE_M).toBeLessThanOrEqual(
      maxPrintablePdfSideM('letter')
    );
  });
});
