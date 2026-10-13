/**
 * The print PDF, rendered by a real PDF renderer (pdf.js, a dev dependency
 * of this test only - production ships no third-party PDF code).
 *
 * Why these tests matter (polish round M0b, A12): the other tests read the
 * writer's own operators back, which proves the writer agrees with itself.
 * A PDF is only right if a VIEWER draws it right: the page at its declared
 * size, every module where the matrix says, the 10 cm check bar exactly
 * 10 cm. These render the file to pixels and measure.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getDocument,
  GlobalWorkerOptions,
} from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  buildQrPrintPdf,
  planPrintPdf,
  type PrintablePdfCode,
} from './qr-print-pdf.js';

const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
).href;

/** Pixels per millimetre the pages are rendered at. */
const PX_PER_MM = 4;

function checkerboard(size: number, caption: string): PrintablePdfCode {
  const modules = new Uint8Array(size * size);
  for (let i = 0; i < modules.length; i += 1) {
    modules[i] = (Math.floor(i / size) + (i % size)) % 2 === 0 ? 1 : 0;
  }
  return { size, modules, caption };
}

interface Rendered {
  pages: number;
  width: number;
  height: number;
  /** Is the pixel at (x, y) from the TOP-left dark? */
  dark(x: number, y: number): boolean;
}

/** Render page `pageNumber` of `bytes` at PX_PER_MM. */
async function render(bytes: Uint8Array, pageNumber = 1): Promise<Rendered> {
  const task = getDocument({
    data: bytes.slice(),
    verbosity: 0,
  });
  const doc = await task.promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: (PX_PER_MM * 25.4) / 72 });
  const width = Math.round(viewport.width);
  const height = Math.round(viewport.height);
  const factory = (
    doc as unknown as {
      canvasFactory: {
        create(
          w: number,
          h: number
        ): {
          canvas: unknown;
          context: {
            getImageData(
              x: number,
              y: number,
              w: number,
              h: number
            ): { data: Uint8ClampedArray };
          };
        };
      };
    }
  ).canvasFactory;
  const { canvas, context } = factory.create(width, height);
  await page.render({
    canvas: canvas as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  const { data } = context.getImageData(0, 0, width, height);
  const pages = doc.numPages;
  await task.destroy();
  return {
    pages,
    width,
    height,
    dark: (x, y) => {
      const i = (Math.round(y) * width + Math.round(x)) * 4;
      return (data[i] ?? 255) < 96;
    },
  };
}

describe('the print PDF in a real renderer (polish round M0b)', () => {
  it('draws an 18 cm code on A4 with every module where the matrix says', async () => {
    const code = checkerboard(21, 'Code 1');
    const plan = planPrintPdf(1, { sideM: 0.18 });
    const shot = await render(buildQrPrintPdf([code], { sideM: 0.18 }));
    // The page is A4 at its declared size.
    expect(shot.width).toBe(210 * PX_PER_MM);
    expect(shot.height).toBe(297 * PX_PER_MM);
    // Every module's centre, sampled where the plan puts the symbol.
    const place = plan.pages[0]?.[0];
    if (place === undefined) throw new Error('no placement');
    const quiet = (plan.blockMm - plan.sideMm) / 2;
    const leftMm = place.xMm + quiet;
    const topMm = 297 - (place.yMm + quiet + plan.sideMm);
    const step = plan.sideMm / code.size;
    let wrong = 0;
    for (let row = 0; row < code.size; row += 1) {
      for (let col = 0; col < code.size; col += 1) {
        const expected = (code.modules[row * code.size + col] ?? 0) > 0;
        const x = (leftMm + (col + 0.5) * step) * PX_PER_MM;
        const y = (topMm + (row + 0.5) * step) * PX_PER_MM;
        if (shot.dark(x, y) !== expected) wrong += 1;
      }
    }
    expect(wrong).toBe(0);
    // Nothing of the symbol is cut: its corner modules sit on the page,
    // inside the 6 mm ink margin.
    expect(leftMm).toBeGreaterThanOrEqual(6);
    expect(leftMm + plan.sideMm).toBeLessThanOrEqual(210 - 6);
  });

  it('draws the check bar exactly 10 cm long', async () => {
    const plan = planPrintPdf(1, { sideM: 0.16 });
    const shot = await render(
      buildQrPrintPdf([checkerboard(21, 'Code 1')], { sideM: 0.16 })
    );
    // A row through the bar itself (0.6 mm above its bottom edge).
    const y = (297 - (plan.checkBar.yMm + 0.6)) * PX_PER_MM;
    let first = -1;
    let last = -1;
    for (let x = 0; x < shot.width; x += 1) {
      if (shot.dark(x, y)) {
        if (first < 0) first = x;
        last = x;
      }
    }
    const lengthMm = (last - first + 1) / PX_PER_MM;
    // One pixel each end: 0.25 mm at this resolution.
    expect(lengthMm).toBeGreaterThan(100 - 0.6);
    expect(lengthMm).toBeLessThan(100 + 0.6);
  });

  it('puts a grid run on as many pages as the plan says', async () => {
    const codes = [1, 2, 3, 4, 5].map((n) =>
      checkerboard(21, `Code ${String(n)}`)
    );
    const plan = planPrintPdf(5, { sideM: 0.08 });
    const shot = await render(buildQrPrintPdf(codes, { sideM: 0.08 }), 2);
    expect(shot.pages).toBe(plan.pages.length);
    expect(shot.pages).toBe(2);
    // ...and the overflow page carries its codes, not a blank sheet: the
    // first module of each placement there is dark (PR #586 review).
    const quiet = (plan.blockMm - plan.sideMm) / 2;
    const step = plan.sideMm / 21;
    const second = plan.pages[1] ?? [];
    expect(second.length).toBeGreaterThan(0);
    for (const place of second) {
      const x = (place.xMm + quiet + 0.5 * step) * PX_PER_MM;
      const y =
        (297 - (place.yMm + quiet + plan.sideMm - 0.5 * step)) * PX_PER_MM;
      expect(shot.dark(x, y)).toBe(true);
    }
  });

  // Why (polish round D-P7): the poster text is only right if a viewer
  // draws it where the plan says - above and below the code, centred on
  // it, and never inside the quiet zone the scanner needs blank.
  it('draws the poster text above and below the code, centred, and leaves the quiet zone blank', async () => {
    const poster = {
      title: 'Harbour Lights',
      explanation: 'AR tour starts here',
      callToAction: 'Scan with your phone camera',
    };
    const plan = planPrintPdf(1, { sideM: 0.18, poster });
    const shot = await render(
      buildQrPrintPdf([checkerboard(21, 'Code 1')], { sideM: 0.18, poster })
    );
    const place = plan.pages[0]?.[0];
    if (place === undefined) throw new Error('no placement');
    /** Columns (px) with ink in the band of rows [fromMm, toMm) from the
     *  page top. */
    const inkColumns = (fromMm: number, toMm: number): number[] => {
      const columns: number[] = [];
      for (let x = 0; x < shot.width; x += 1) {
        for (let y = fromMm * PX_PER_MM; y < toMm * PX_PER_MM; y += 1) {
          if (shot.dark(x, y)) {
            columns.push(x);
            break;
          }
        }
      }
      return columns;
    };
    const boxTopMm = 297 - (place.yMm + plan.blockMm);
    const boxBottomMm = 297 - place.yMm;
    const centreMm = place.xMm + plan.blockMm / 2;
    // Above the box (the title and the explanation) and below it (the call
    // to action, above the caption).
    const cta = plan.poster.lines.find((l) => l.part === 'callToAction');
    if (cta === undefined) throw new Error('no call to action');
    for (const [from, to] of [
      [6, boxTopMm],
      [boxBottomMm, 297 - (place.yMm + cta.dyMm) + 0.25 * cta.emMm],
    ] as const) {
      const ink = inkColumns(from, to);
      expect(ink.length).toBeGreaterThan(0);
      const left = (ink[0] ?? 0) / PX_PER_MM;
      const right = (ink[ink.length - 1] ?? 0) / PX_PER_MM;
      // Centred on the code to within 2 mm (glyph side bearings).
      expect(Math.abs((left + right) / 2 - centreMm)).toBeLessThan(2);
      expect(left).toBeGreaterThanOrEqual(6);
      expect(right).toBeLessThanOrEqual(210 - 6);
    }
    // The quiet zone: a ring between the box edge and the symbol, blank.
    const quiet = (plan.blockMm - plan.sideMm) / 2;
    const inner = 0.5;
    expect(
      inkColumns(boxTopMm + inner, boxTopMm + quiet - inner).filter(
        (x) =>
          x / PX_PER_MM > place.xMm && x / PX_PER_MM < place.xMm + plan.blockMm
      )
    ).toEqual([]);
    expect(
      inkColumns(boxBottomMm - quiet + inner, boxBottomMm - inner).filter(
        (x) =>
          x / PX_PER_MM > place.xMm && x / PX_PER_MM < place.xMm + plan.blockMm
      )
    ).toEqual([]);
  });
});
