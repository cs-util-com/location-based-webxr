/**
 * A printable PDF of QR codes, written by hand.
 *
 * WHY BY HAND. Production code here ships no third-party libraries, so a
 * PDF library is out. That constraint costs less than it sounds: a QR code
 * is a grid of black squares, so a page is a few hundred vector rectangles
 * - a content stream of `re f` operators - with no image encoding and no
 * compression. The result also prints at the printer's own resolution
 * instead of a bitmap's, which is the property that matters for something a
 * camera has to measure.
 *
 * WHY A PDF AT ALL, when the page can already print itself. The browser's
 * print dialog owns the paper size, the margins and a "fit to page" toggle
 * that silently rescales - and a rescaled code is one whose printed side no
 * longer matches the number the pose solve was given. A PDF declares its
 * own MediaBox and draws at absolute coordinates, so the only way to get
 * the size wrong is to ask the printer to scale it. It is also what makes
 * several numbered codes in one file possible, which is the actual request
 * (second testing session, §4).
 *
 * SIZE CONTRACT, unchanged from `qr-print-plan.ts`: the side length is the
 * SYMBOL - the dark module area WITHOUT the quiet zone. The quiet zone is
 * drawn around it as white space, so the printed symbol side equals the
 * number the author typed.
 */

import {
  pdfLiteral,
  textWidthEm,
  toWinAnsi,
  wrapText,
  type PdfFont,
} from './pdf-text.js';
import { QR_QUIET_ZONE_FRACTION } from './qr-quiet-zone.js';

/** PDF user space is points: 1 pt = 1/72 inch. */
const PT_PER_MM = 72 / 25.4;

/** The paper this can lay out, in mm. */
export const PAPER_SIZES_MM = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
} as const;
export type PaperSize = keyof typeof PAPER_SIZES_MM;

/**
 * Page margin for INK. Deliberately small but NOT zero: most consumer
 * printers have an unprintable border of about 3-5 mm, and content inside
 * it is silently clipped - which for a QR code means it does not decode at
 * all. The quiet zone is blank paper, so it may reach into this margin
 * (polish round M0b: an 18 cm code on A4 fits only that way).
 */
const DEFAULT_MARGIN_MM = 6;

/** The ruler check under the codes: a bar exactly this long. */
const CHECK_BAR_MM = 100;

/** The band the check bar and its label take above the bottom margin. */
const CHECK_BAR_BAND_MM = 9;

/**
 * The quiet zone, as a fraction of the symbol side on each edge. IMPORTED
 * rather than restated, because two printing paths that disagree about the
 * quiet zone would produce two different physical artefacts from one
 * declared size — and until r665 the only thing preventing that was that
 * nobody had edited one of the two copies. It comes from
 * `qr-quiet-zone.ts`, which imports nothing, so this writer stays the
 * self-contained leaf its own header claims to be.
 */
const DEFAULT_QUIET_FRACTION = QR_QUIET_ZONE_FRACTION;

/** Room under each code for its caption line. */
const DEFAULT_CAPTION_MM = 8;

/** Gap between two codes sharing a page. */
const DEFAULT_GAP_MM = 6;

/**
 * How far each row of modules bleeds into the one below, as a fraction of
 * a module.
 *
 * An exact seam between rows can render as a white hairline on some
 * rasterisers, and a hairline through a finder pattern is a scan failure.
 * It is deliberately far below half a module: anything larger starts to
 * thicken the symbol's own features rather than close a seam.
 */
const ROW_OVERLAP = 0.02;

/**
 * The poster's text (Tour Viewer polish round D-P7): the same for every
 * code of a run. An empty or missing part is left off.
 */
export interface PosterText {
  /** Above the code, bold: the tour's name. */
  title?: string;
  /** Under the title, e.g. "AR tour starts here". */
  explanation?: string;
  /** Below the code, e.g. "Scan with your phone camera". */
  callToAction?: string;
}

type PosterPart = keyof PosterText;

/**
 * Each part's size as a fraction of the SYMBOL side (D-P8: scaled to the
 * code), its face, colour and line budget. The proportions follow the
 * chosen S1 design's poster (title over the explanation over the code, the
 * call to action under it).
 */
const POSTER_STYLE: Record<
  PosterPart,
  {
    ratio: number;
    font: PdfFont;
    rgb: readonly [number, number, number];
    maxLines: number;
  }
> = {
  title: { ratio: 0.11, font: 'bold', rgb: [0.11, 0.137, 0.169], maxLines: 2 },
  explanation: {
    ratio: 0.075,
    font: 'bold',
    rgb: [0.059, 0.463, 0.431],
    maxLines: 2,
  },
  callToAction: {
    ratio: 0.075,
    font: 'regular',
    rgb: [0.357, 0.396, 0.439],
    maxLines: 2,
  },
};

/**
 * The smallest em (mm) a part is printed at: about 6 pt, readable at arm's
 * length. A title or explanation that would come out smaller is left off;
 * the call to action is held AT this size instead, so it is the last part
 * to go (D-P8) - only when two lines of it no longer fit the code.
 */
const MIN_TEXT_EM_MM = 2.2;

/** Line pitch, in em. */
const LINE_HEIGHT_EM = 1.2;

/** Space between the text and the quiet box, as a fraction of the side. */
const TEXT_GAP_RATIO = 0.03;

/** How far each shrink step takes the text when a sheet runs short. */
const TEXT_SHRINK_STEP = 0.05;

/** Never shrink the proportional sizes below this share. */
const TEXT_MIN_SCALE = 0.3;

/** The drop order (D-P8): each set is tried at every scale before the
 *  next, smaller one. */
const KEEP_SETS: readonly (readonly PosterPart[])[] = [
  ['title', 'explanation', 'callToAction'],
  ['title', 'callToAction'],
  // A title that cannot fit (one long word at a small size) keeps the
  // explanation (M0c review, finding 8a).
  ['explanation', 'callToAction'],
  ['callToAction'],
];

export interface PrintPdfOptions {
  paper?: PaperSize;
  /** The SYMBOL side in metres - the number the pose solve reads. */
  sideM: number;
  marginMm?: number;
  quietFraction?: number;
  captionMm?: number;
  gapMm?: number;
  /** Text around every code; none when absent. */
  poster?: PosterText;
}

/** One line of poster text, drawn centred on its code's quiet box. */
interface PosterLine {
  part: PosterPart;
  /** The line itself, whitespace collapsed. */
  text: string;
  font: PdfFont;
  rgb: readonly [number, number, number];
  /** The font size (em) in mm. */
  emMm: number;
  widthMm: number;
  /** The BASELINE, in mm above the quiet box's bottom edge (negative:
   *  below the box). */
  dyMm: number;
}

/** The poster text as laid out for this run - one layout for every code. */
interface PosterLayout {
  lines: PosterLine[];
  /** The code's caption baseline, relative to the box as `dyMm`. */
  captionDyMm: number;
}

/** Where one code's QUIET-ZONE box sits, in mm from the page's bottom-left
 *  (PDF's own origin, so the writer does no flipping). */
interface PdfPlacement {
  xMm: number;
  yMm: number;
}

export interface PrintPdfPlan {
  paper: { widthMm: number; heightMm: number };
  /** The symbol side in mm - what a ruler on the paper should read. */
  sideMm: number;
  /** The quiet-zone box's side in mm (symbol + two quiet margins). */
  blockMm: number;
  /** The grid a page holds: columns, rows, and their product. */
  columns: number;
  rows: number;
  perPage: number;
  /** One entry per page, each listing that page's placements in order. */
  pages: PdfPlacement[][];
  /** The 10 cm ruler check on every page: its left end, the bottom of its
   *  band, its length and the band's height, in mm. */
  checkBar: { xMm: number; yMm: number; lengthMm: number; bandMm: number };
  /** The text around each code (no lines without a poster). */
  poster: PosterLayout;
}

/**
 * Decide the page geometry, or throw a RangeError saying what would fit.
 *
 * Split from the writer because this is the part that can be WRONG in a way
 * a reader cannot see: the bytes either parse or do not, but a code laid
 * out 2 mm into the unprintable border prints as a code that will not scan,
 * and looks fine on screen.
 *
 * @param count how many codes to place, 1-based numbering.
 */
export function planPrintPdf(
  count: number,
  options: PrintPdfOptions
): PrintPdfPlan {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(
      `the number of codes must be a whole number of 1 or more, got ${String(count)}`
    );
  }
  const { sideM } = options;
  if (!Number.isFinite(sideM) || sideM <= 0) {
    throw new RangeError(
      `the printed side length must be a positive number of metres, got ${String(sideM)}`
    );
  }
  const { paperName, paper, margin, quiet, caption, gap } =
    resolveLayout(options);

  const sideMm = sideM * 1000;
  const blockMm = sideMm * (1 + 2 * quiet);
  const layout = { paper, margin, quiet, caption, gap };
  const grid = gridFor(sideMm, layout);
  if (grid === null) {
    throw new RangeError(
      `${formatMm(sideMm)} plus its quiet zone does not fit ` +
        `${paperName.toUpperCase()}. ` +
        `Use ${formatMm(ceilingMm(layout))} or less, or a larger sheet.`
    );
  }
  const { columns } = grid;
  const gridWidth = columns * blockMm + (columns - 1) * gap;
  const left = (paper.width - gridWidth) / 2;
  // The text is ink: centred on a box, it may be no wider than twice the
  // distance from the OUTER boxes' centres to the margin - and no wider
  // than its own box, or it would reach under the next column's.
  const textWidthMm = Math.min(blockMm, 2 * left + blockMm - 2 * margin);
  const box = { sideMm, blockMm, widthMm: textWidthMm };
  const fitted = fitPoster(options.poster, box, (extra) =>
    gridFor(sideMm, layout, extra)
  );
  const { rows, blockTopMm } = fitted.grid;
  const perPage = columns * rows;
  const { aboveMm, belowMm } = fitted.extra;

  // The stack - from the first row's box top to the last row's caption -
  // is centred across the sheet and VERTICALLY CENTRED between the check
  // bar's band and the highest a box top may sit. PDF's origin is the
  // BOTTOM-left, so the first row gets the highest y.
  const rowMm = blockMm + belowMm + caption;
  const pitchMm = rowMm + gap + aboveMm;
  const floorMm = margin + CHECK_BAR_BAND_MM;
  const pages: PdfPlacement[][] = [];
  for (let placed = 0; placed < count; placed += perPage) {
    const onThisPage = Math.min(perPage, count - placed);
    const usedRows = Math.ceil(onThisPage / columns);
    const stackMm = usedRows * rowMm + (usedRows - 1) * (gap + aboveMm);
    const space = blockTopMm - floorMm;
    const topMm = floorMm + (space - stackMm) / 2 + stackMm;
    const placements: PdfPlacement[] = [];
    for (let i = 0; i < onThisPage; i += 1) {
      const row = Math.floor(i / columns);
      const col = i % columns;
      placements.push({
        xMm: left + col * (blockMm + gap),
        yMm: topMm - row * pitchMm - blockMm,
      });
    }
    pages.push(placements);
  }

  return {
    paper: { widthMm: paper.width, heightMm: paper.height },
    sideMm,
    blockMm,
    columns,
    rows,
    perPage,
    pages,
    checkBar: {
      xMm: (paper.width - CHECK_BAR_MM) / 2,
      yMm: margin,
      lengthMm: CHECK_BAR_MM,
      bandMm: CHECK_BAR_BAND_MM,
    },
    poster: {
      lines: fitted.lines,
      // Under the call to action, where the caption sat under the box.
      captionDyMm: -belowMm - caption + 2,
    },
  };
}

interface GridLayout {
  paper: { width: number; height: number };
  margin: number;
  quiet: number;
  caption: number;
  gap: number;
}

/** The poster text's height above and below each quiet box, in mm. */
interface TextExtent {
  aboveMm: number;
  belowMm: number;
}

const NO_TEXT: TextExtent = { aboveMm: 0, belowMm: 0 };

interface Grid {
  columns: number;
  rows: number;
  /** The highest a quiet box's TOP may sit, in mm from the bottom. */
  blockTopMm: number;
}

/**
 * The grid a sheet holds for a symbol of `sideMm`, or null when not even
 * one fits. ONE fit test, used by the planner and by the ceiling, so a
 * size the refusal suggests is a size the planner accepts. The ceiling and
 * the refusal ask it WITHOUT text: the poster text never costs the code
 * its size (D-P8 - the text shrinks instead).
 *
 * The rule: the SYMBOL and all text stay `margin` inside the sheet (ink),
 * the quiet-zone box only has to be on it (blank paper), and each row's
 * call to action and caption sit under its box, above the check bar's
 * band.
 */
function gridFor(
  sideMm: number,
  layout: GridLayout,
  extra: TextExtent = NO_TEXT
): Grid | null {
  const { paper, margin, quiet, caption, gap } = layout;
  const quietMm = sideMm * quiet;
  const blockMm = sideMm + 2 * quietMm;
  // How close a box may come to the sheet's edge: the margin minus the
  // quiet zone it carries, never past the edge itself.
  const edge = Math.max(0, margin - quietMm);
  const columns = Math.floor((paper.width - 2 * edge + gap) / (blockMm + gap));
  // A box top may reach the sheet's edge band; text above it may not.
  // Only text above it brings the margin in: without, the box keeps the
  // whole edge band (the M0b rule that fits 18 cm on A4).
  const blockTopMm =
    extra.aboveMm > 0
      ? Math.min(paper.height - edge, paper.height - margin - extra.aboveMm)
      : paper.height - edge;
  const floorMm = margin + CHECK_BAR_BAND_MM;
  const rowMm = blockMm + extra.belowMm + caption;
  const rows = Math.floor(
    (blockTopMm - floorMm + gap + extra.aboveMm) / (rowMm + gap + extra.aboveMm)
  );
  if (columns < 1 || rows < 1) return null;
  return { columns, rows, blockTopMm };
}

/**
 * Size the poster text for this run and the grid it leaves (D-P8): each
 * part in proportion to the code, shrunk step by step until the sheet
 * holds as many rows as it would without text; only where no readable size
 * does that, one row fewer, and so on. A part that would come out
 * unreadably small is dropped, the explanation first, the title next, the
 * call to action last. Without a poster, or when even the call to action
 * alone does not fit, the run has no text and the grid is the bare one.
 */
function fitPoster(
  poster: PosterText | undefined,
  box: { sideMm: number; blockMm: number; widthMm: number },
  gridWith: (extra: TextExtent) => Grid | null
): { lines: PosterLine[]; extra: TextExtent; grid: Grid } {
  const bare = gridWith(NO_TEXT);
  // The caller has already refused a size with no grid at all.
  if (bare === null) throw new RangeError('no grid for this size');
  const texts = posterTexts(poster);
  // The order of what gives way: the text's SIZE first, then a row of
  // codes per page (A11: a sheet of small codes must not go half empty for
  // its text), then a part of the text.
  for (const set of KEEP_SETS) {
    const keep = set.filter((part) => texts.has(part));
    if (keep.length === 0) continue;
    for (let rows = bare.rows; rows >= 1; rows -= 1) {
      for (
        let scale = 1;
        scale >= TEXT_MIN_SCALE - 1e-9;
        scale -= TEXT_SHRINK_STEP
      ) {
        const stack = stackText(keep, texts, box, scale);
        if (stack === 'too-small') break; // smaller scales only get smaller
        if (stack === null) continue;
        const grid = gridWith(stack.extra);
        if (grid !== null && grid.rows >= rows) return { ...stack, grid };
      }
    }
  }
  return { lines: [], extra: NO_TEXT, grid: bare };
}

/** The parts with something printable in them. */
function posterTexts(poster: PosterText | undefined): Map<PosterPart, string> {
  const texts = new Map<PosterPart, string>();
  for (const part of ['title', 'explanation', 'callToAction'] as const) {
    const text = (poster?.[part] ?? '').replace(/\s+/g, ' ').trim();
    if (toWinAnsi(text).some((code) => code !== 0x20)) texts.set(part, text);
  }
  return texts;
}

/**
 * The lines of `keep` at `scale`, stacked around the box: the title over
 * the explanation above it, the call to action below it. `'too-small'`
 * when a title or explanation would be under the readable size; null when
 * a part does not wrap into its line budget at this size.
 */
function stackText(
  keep: readonly PosterPart[],
  texts: ReadonlyMap<PosterPart, string>,
  box: { sideMm: number; blockMm: number; widthMm: number },
  scale: number
): { lines: PosterLine[]; extra: TextExtent } | 'too-small' | null {
  const { sideMm, blockMm, widthMm } = box;
  const gapMm = TEXT_GAP_RATIO * sideMm;
  const parts: { part: PosterPart; emMm: number; lines: string[] }[] = [];
  for (const part of keep) {
    const style = POSTER_STYLE[part];
    let emMm = style.ratio * sideMm * scale;
    if (emMm < MIN_TEXT_EM_MM) {
      if (part !== 'callToAction') return 'too-small';
      emMm = MIN_TEXT_EM_MM;
    }
    const wrapped = wrapText(
      texts.get(part) ?? '',
      style.font,
      emMm,
      widthMm,
      style.maxLines
    );
    if (wrapped === null) return null;
    parts.push({ part, emMm, lines: wrapped });
  }
  const line = (part: PosterPart, text: string, emMm: number, dyMm: number) => {
    const style = POSTER_STYLE[part];
    return {
      part,
      text,
      font: style.font,
      rgb: style.rgb,
      emMm,
      widthMm: textWidthEm(toWinAnsi(text), style.font) * emMm,
      dyMm,
    };
  };
  // A line's ink reaches about 0.8 em above its baseline and 0.25 em
  // below it (Helvetica's ascender and descender, rounded up); lines of
  // one part sit LINE_HEIGHT_EM apart, parts a little further.
  // 0.96 em: an accented capital (Å, Ü) rises above the plain ascender
  // (M0c review, finding 7); text at the top of the sheet must not reach
  // into the margin with it.
  const ascent = 0.96;
  const descent = 0.25;
  // Above the box, built upward from its top: the explanation's last line
  // first, the title's first line last.
  const above: PosterLine[] = [];
  let top = blockMm + gapMm; // the highest ink so far, from the box bottom
  for (const [i, { part, emMm, lines }] of parts
    .filter((p) => p.part !== 'callToAction')
    .reverse()
    .entries()) {
    let baseline = top + (i === 0 ? 0 : 0.2 * emMm) + descent * emMm;
    for (const text of [...lines].reverse()) {
      above.unshift(line(part, text, emMm, baseline));
      top = baseline + ascent * emMm;
      baseline += LINE_HEIGHT_EM * emMm;
    }
  }
  // Below the box, built downward from its bottom.
  const below: PosterLine[] = [];
  let bottom = -gapMm; // the lowest ink so far, from the box bottom
  for (const { part, emMm, lines } of parts.filter(
    (p) => p.part === 'callToAction'
  )) {
    let baseline = bottom - ascent * emMm;
    for (const text of lines) {
      below.push(line(part, text, emMm, baseline));
      bottom = baseline - descent * emMm;
      baseline -= LINE_HEIGHT_EM * emMm;
    }
  }
  return {
    lines: [...above, ...below],
    extra: {
      aboveMm: above.length === 0 ? 0 : top - blockMm,
      belowMm: below.length === 0 ? 0 : -bottom,
    },
  };
}

/** The largest WHOLE millimetre a sheet holds, by the same fit test. */
function ceilingMm(layout: GridLayout): number {
  for (let mm = Math.floor(layout.paper.width); mm > 0; mm -= 1) {
    if (gridFor(mm, layout) !== null) return mm;
  }
  return 0;
}

/** The options with their defaults filled in - split out so the geometry
 *  above reads as geometry rather than as six `??`s. */
function resolveLayout(options: PrintPdfOptions) {
  const paperName = options.paper ?? 'a4';
  return {
    paperName,
    paper: PAPER_SIZES_MM[paperName],
    margin: options.marginMm ?? DEFAULT_MARGIN_MM,
    quiet: options.quietFraction ?? DEFAULT_QUIET_FRACTION,
    caption: options.captionMm ?? DEFAULT_CAPTION_MM,
    gap: options.gapMm ?? DEFAULT_GAP_MM,
  };
}

/**
 * The largest symbol side, in metres, this writer can place on `paper`.
 *
 * Exported because the Tour Viewer's print step says "too large for A4:
 * up to ... fits" against THIS ceiling: since polish round M0b it prints by
 * PDF only, and the browser-print ceiling (`homePrintWarning`, roughly
 * 7 mm stricter because the dialog's own margins are not ours) would refuse
 * sizes this writer prints correctly.
 */
export function maxPrintablePdfSideM(
  paper: PaperSize = 'a4',
  options: Pick<
    PrintPdfOptions,
    'marginMm' | 'quietFraction' | 'captionMm'
  > = {}
): number {
  // The planner's own fit test, so this ceiling is one the planner accepts
  // (a ceiling that is itself refused is worse than none).
  return (
    ceilingMm({
      paper: PAPER_SIZES_MM[paper],
      margin: options.marginMm ?? DEFAULT_MARGIN_MM,
      quiet: options.quietFraction ?? DEFAULT_QUIET_FRACTION,
      caption: options.captionMm ?? DEFAULT_CAPTION_MM,
      gap: DEFAULT_GAP_MM,
    }) / 1000
  );
}

/** A code to draw: its module matrix and the line printed under it. */
export interface PrintablePdfCode {
  /** Modules per side. */
  size: number;
  /** Row-major dark flags, `size * size` long; non-zero is dark. */
  modules: ArrayLike<number>;
  /** The caption under the code. WinAnsi: Latin-1 letters print, what
   *  the font has no glyph for is dropped (`pdf-text.ts`). */
  caption: string;
}

/**
 * The PDF bytes for `codes`, laid out by {@link planPrintPdf}.
 *
 * @throws RangeError when the codes do not fit the paper, or when a matrix
 *   is not `size * size` long.
 */
export function buildQrPrintPdf(
  codes: readonly PrintablePdfCode[],
  options: PrintPdfOptions
): Uint8Array<ArrayBuffer> {
  const plan = planPrintPdf(codes.length, options);
  for (const code of codes) {
    if (!Number.isInteger(code.size) || code.size < 1) {
      throw new RangeError(
        `a code matrix must have a whole positive size, got ${String(code.size)}`
      );
    }
    if (code.modules.length !== code.size * code.size) {
      throw new RangeError(
        `a ${String(code.size)}x${String(code.size)} matrix needs ` +
          `${String(code.size * code.size)} modules, got ${String(code.modules.length)}`
      );
    }
  }

  const contents = plan.pages.map((placements, pageIndex) =>
    pageContent(
      placements.map((placement, slot) => ({
        placement,
        code: codes[pageIndex * plan.perPage + slot],
      })),
      plan
    )
  );
  return assemblePdf(contents, plan);
}

// --- the drawing -------------------------------------------------------

/** One page's content stream. */
function pageContent(
  slots: readonly {
    placement: PdfPlacement;
    code: PrintablePdfCode | undefined;
  }[],
  plan: PrintPdfPlan
): string {
  const parts: string[] = [];
  for (const { placement, code } of slots) {
    if (code === undefined) continue;
    const quietMm = (plan.blockMm - plan.sideMm) / 2;
    // The quiet zone is drawn as white so the code survives a coloured
    // sheet and a printer's own background handling.
    parts.push('1 1 1 rg');
    parts.push(rect(placement.xMm, placement.yMm, plan.blockMm, plan.blockMm));
    parts.push('0 0 0 rg');
    parts.push(
      ...darkRuns(
        code,
        placement.xMm + quietMm,
        placement.yMm + quietMm,
        plan.sideMm
      )
    );
    // The poster text, centred on the box and never inside it (the plan
    // keeps it clear of every quiet zone and inside the margin).
    for (const line of plan.poster.lines) {
      const x = placement.xMm + plan.blockMm / 2 - line.widthMm / 2;
      parts.push(`${line.rgb.map((c) => String(c)).join(' ')} rg`);
      parts.push(
        `BT /${line.font === 'bold' ? 'F2' : 'F1'} ${pt(line.emMm)} Tf`
      );
      parts.push(
        `${pt(x)} ${pt(placement.yMm + line.dyMm)} Td (${pdfLiteral(toWinAnsi(line.text))}) Tj`
      );
      parts.push('ET');
    }
    // The caption sits BELOW the quiet box (and below the call to action),
    // never inside it: ink inside the quiet zone is exactly what the quiet
    // zone exists to prevent. At the SYMBOL's left edge, not the box's: the
    // box may reach into the margin, the caption is ink and may not.
    // An empty caption draws nothing (the Tour Viewer prints none since the
    // owner's verdict on r821; it passes captionMm 0 to free the band).
    const caption = toWinAnsi(code.caption);
    if (caption.length === 0) continue;
    parts.push('0 0 0 rg');
    parts.push(`BT /F1 ${pt(captionEmMm(code.caption, plan))} Tf`);
    parts.push(
      `${pt(placement.xMm + quietMm)} ${pt(placement.yMm + plan.poster.captionDyMm)} Td (${pdfLiteral(caption)}) Tj`
    );
    parts.push('ET');
  }
  parts.push(...checkBar(plan.checkBar));
  return parts.join('\n');
}

/** The caption's full size: 9 pt. */
const CAPTION_EM_MM = (9 * 25.4) / 72;

/**
 * The caption's font size (em, mm): 9 pt, or smaller so the caption is no
 * wider than its code's symbol. It starts at the symbol's left edge, which
 * is inside the margin, so it then stays inside the margin and inside its
 * own column; at 9 pt a "Code 12 - 3 cm - print at 100%" ran over its
 * neighbours and off the sheet (M0c review, finding 4).
 */
export function captionEmMm(
  caption: string,
  plan: Pick<PrintPdfPlan, 'sideMm'>
): number {
  const widthEm = textWidthEm(toWinAnsi(caption), 'regular');
  return widthEm === 0
    ? CAPTION_EM_MM
    : Math.min(CAPTION_EM_MM, plan.sideMm / widthEm);
}

/**
 * The ruler check (polish round M0b, A10): a black bar exactly 10 cm long
 * with a tick at each centimetre, and a line saying what to do with it. A
 * print that measures anything else was scaled on the way to the paper.
 */
function checkBar(bar: PrintPdfPlan['checkBar']): string[] {
  const out = ['0 0 0 rg', rect(bar.xMm, bar.yMm, bar.lengthMm, 1.2)];
  for (let cm = 0; cm <= bar.lengthMm / 10; cm += 1) {
    out.push(rect(bar.xMm + cm * 10 - 0.15, bar.yMm, 0.3, 2.6));
  }
  out.push('BT /F1 7 Tf');
  out.push(
    `${pt(bar.xMm)} ${pt(bar.yMm + 4)} Td (${pdfLiteral(
      toWinAnsi(
        'This bar is 10 cm. If it measures anything else, print again at 100 % (actual size).'
      )
    )}) Tj`
  );
  out.push('ET');
  return out;
}

/**
 * The dark modules as filled rectangles, merged into horizontal RUNS.
 *
 * A version-25 symbol is 117x117, i.e. up to 13 689 separate rectangles per
 * code. Merging each row's consecutive dark modules into one rectangle is
 * two lines of code and typically cuts that by three to five times, which
 * is the difference between a file a phone can hand to a printer and one it
 * struggles with.
 */
function darkRuns(
  code: PrintablePdfCode,
  originXMm: number,
  originYMm: number,
  sideMm: number
): string[] {
  const out: string[] = [];
  const step = sideMm / code.size;
  const overlap = step * ROW_OVERLAP;
  for (let row = 0; row < code.size; row += 1) {
    // PDF's y grows UPWARD and the matrix's first row is the TOP one.
    const yMm = originYMm + (code.size - 1 - row) * step;
    // The hair of overlap goes DOWNWARD, and never below the symbol's own
    // bottom edge. Extending upward instead made the drawn symbol taller
    // than the side it declares - 160.15 mm for a declared 160 - which
    // contradicts this file's one hard invariant, put ink into the quiet
    // zone, and was free to fix.
    const bottomMm = Math.max(originYMm, yMm - overlap);
    let runStart = -1;
    for (let col = 0; col <= code.size; col += 1) {
      // `> 0` rather than `!== 0`: the parameter type is the permissive
      // ArrayLike<number>, and `!== 0` reads a hole (undefined) and the
      // string '0' as DARK - a holey array of the right length renders a
      // solid black square, which is a code that cannot be scanned and
      // looks deliberate.
      const dark =
        col < code.size && Number(code.modules[row * code.size + col]) > 0;
      if (dark && runStart < 0) runStart = col;
      if (!dark && runStart >= 0) {
        out.push(
          rect(
            originXMm + runStart * step,
            bottomMm,
            (col - runStart) * step,
            yMm + step - bottomMm
          )
        );
        runStart = -1;
      }
    }
  }
  return out;
}

function rect(xMm: number, yMm: number, wMm: number, hMm: number): string {
  return `${pt(xMm)} ${pt(yMm)} ${pt(wMm)} ${pt(hMm)} re f`;
}

/** mm as a PDF number, at 0.01 pt - finer than any printer resolves. */
function pt(mm: number): string {
  return (Math.round(mm * PT_PER_MM * 100) / 100).toString();
}

/** A length in mm for a human, without trailing zeroes. */
function formatMm(mm: number): string {
  const cm = Math.round(mm) / 10;
  return `${String(cm)} cm`;
}

// --- the file ----------------------------------------------------------

/**
 * Wrap the content streams in the smallest complete PDF that renders:
 * catalog, page tree, one page and one stream each, one base-14 font.
 *
 * The xref table's byte offsets are what make a PDF openable at all, so
 * they are measured from the encoded bytes rather than from string lengths
 * - the two agree only while every byte is ASCII, and relying on that
 * silently is how a file breaks the first time a caption is not.
 */
function assemblePdf(
  contents: readonly string[],
  plan: PrintPdfPlan
): Uint8Array<ArrayBuffer> {
  const widthPt = pt(plan.paper.widthMm);
  const heightPt = pt(plan.paper.heightMm);
  const pageCount = contents.length;
  // Object numbering: 1 catalog, 2 pages, 3 and 4 the regular and the
  // bold font, then per page a page object and its content stream.
  const pageObjectNumber = (i: number) => 5 + i * 2;
  const contentObjectNumber = (i: number) => 6 + i * 2;

  const objects: string[] = [];
  // PrintScaling None asks the viewer's print dialog to start at 100 %
  // instead of "fit to page" (polish round M0b, A10). A request, not a
  // guarantee - which is why every page also carries the check bar.
  objects.push(
    '<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>'
  );
  objects.push(
    `<< /Type /Pages /Count ${String(pageCount)} /Kids [${contents
      .map((_, i) => `${String(pageObjectNumber(i))} 0 R`)
      .join(' ')}] >>`
  );
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  );
  for (const [i, content] of contents.entries()) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> ` +
        `/Contents ${String(contentObjectNumber(i))} 0 R >>`
    );
    objects.push(
      `<< /Length ${String(byteLength(content))} >>\nstream\n${content}\nendstream`
    );
  }

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (text: string): void => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    offset += bytes.length;
  };

  push('%PDF-1.4\n');
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(offset);
    push(`${String(i + 1)} 0 obj\n${body}\nendobj\n`);
  }
  const xrefOffset = offset;
  const entries = [
    '0000000000 65535 f \n',
    ...offsets.map((o) => `${o.toString().padStart(10, '0')} 00000 n \n`),
  ];
  push(`xref\n0 ${String(objects.length + 1)}\n${entries.join('')}`);
  push(
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n` +
      `startxref\n${String(xrefOffset)}\n%%EOF\n`
  );

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
