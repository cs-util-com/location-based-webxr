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

/** PDF user space is points: 1 pt = 1/72 inch. */
const PT_PER_MM = 72 / 25.4;

/** The paper this can lay out, in mm. */
export const PAPER_SIZES_MM = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
} as const;
export type PaperSize = keyof typeof PAPER_SIZES_MM;

/**
 * Page margin. Deliberately small but NOT zero: most consumer printers have
 * an unprintable border of about 3-5 mm, and content inside it is silently
 * clipped - which for a QR code means it does not decode at all.
 */
const DEFAULT_MARGIN_MM = 6;

/**
 * The quiet zone, as a fraction of the symbol side on each edge. The same
 * 8 % the on-page print stylesheet uses, kept identical on purpose: two
 * printing paths that disagree about the quiet zone would produce two
 * different physical artefacts from one declared size.
 */
const DEFAULT_QUIET_FRACTION = 0.08;

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

export interface PrintPdfOptions {
  paper?: PaperSize;
  /** The SYMBOL side in metres - the number the pose solve reads. */
  sideM: number;
  marginMm?: number;
  quietFraction?: number;
  captionMm?: number;
  gapMm?: number;
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
  /** How many codes share one page (1 or 2). */
  perPage: number;
  /** One entry per page, each listing that page's placements in order. */
  pages: PdfPlacement[][];
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
  const usableWidth = paper.width - 2 * margin;
  const usableHeight = paper.height - 2 * margin;

  refuseIfTooBig({
    sideMm,
    blockMm,
    usableWidth,
    usableHeight,
    caption,
    quiet,
    paperName,
  });

  // Two per page when two fit stacked, which is only ever true for small
  // codes - at 16 cm a single block is 18.6 cm and two would need 37.2.
  const perPage =
    2 * (blockMm + caption) + gap <= usableHeight && count > 1 ? 2 : 1;

  const pages: PdfPlacement[][] = [];
  const xMm = margin + (usableWidth - blockMm) / 2;
  for (let placed = 0; placed < count; placed += perPage) {
    const onThisPage = Math.min(perPage, count - placed);
    const stackMm = onThisPage * (blockMm + caption) + (onThisPage - 1) * gap;
    // Top-anchored within the centred stack, and PDF's origin is the
    // BOTTOM-left, so the first code gets the highest y.
    const topMm = margin + (usableHeight - stackMm) / 2 + stackMm;
    const placements: PdfPlacement[] = [];
    for (let i = 0; i < onThisPage; i += 1) {
      placements.push({
        xMm,
        yMm: topMm - (i + 1) * (blockMm + caption) - i * gap + caption,
      });
    }
    pages.push(placements);
  }

  return {
    paper: { widthMm: paper.width, heightMm: paper.height },
    sideMm,
    blockMm,
    perPage,
    pages,
  };
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
 * Throw when the block does not fit, naming the size that would.
 *
 * "Too big" on its own leaves the author guessing, and the answer is one
 * division (page minus margins, over 1.16) nobody should do standing at a
 * printer.
 */
function refuseIfTooBig(box: {
  sideMm: number;
  blockMm: number;
  usableWidth: number;
  usableHeight: number;
  caption: number;
  quiet: number;
  paperName: string;
}): void {
  const fitsWidth = box.blockMm <= box.usableWidth;
  const fitsHeight = box.blockMm + box.caption <= box.usableHeight;
  if (fitsWidth && fitsHeight) return;
  const widthCeiling = box.usableWidth / (1 + 2 * box.quiet);
  const heightCeiling = (box.usableHeight - box.caption) / (1 + 2 * box.quiet);
  // Floored to a WHOLE millimetre, then formatted. Flooring to a tenth and
  // formatting to a tenth of a centimetre rounds twice, and the second
  // rounding can go up - which produced a suggested size that was itself
  // refused, the one thing this message must never do.
  const ceilingMm = Math.floor(Math.min(widthCeiling, heightCeiling));
  throw new RangeError(
    `${formatMm(box.sideMm)} plus its quiet zone does not fit ` +
      `${box.paperName.toUpperCase()}. ` +
      `Use ${formatMm(ceilingMm)} or less, or a larger sheet.`
  );
}

/**
 * The largest symbol side, in metres, this writer can place on `paper`.
 *
 * Exported because the Tour Viewer's panel shows `homePrintWarning`, which
 * is about printing the PAGE from a browser dialog and is roughly 7 mm
 * stricter - the dialog's own margins are not ours. Without this the panel
 * tells an author their 17 cm code "will not scan" in the same breath as a
 * PDF that prints it correctly.
 */
export function maxPrintablePdfSideM(
  paper: PaperSize = 'a4',
  options: Pick<
    PrintPdfOptions,
    'marginMm' | 'quietFraction' | 'captionMm'
  > = {}
): number {
  const margin = options.marginMm ?? DEFAULT_MARGIN_MM;
  const quiet = options.quietFraction ?? DEFAULT_QUIET_FRACTION;
  const caption = options.captionMm ?? DEFAULT_CAPTION_MM;
  const size = PAPER_SIZES_MM[paper];
  const width = (size.width - 2 * margin) / (1 + 2 * quiet);
  const height = (size.height - 2 * margin - caption) / (1 + 2 * quiet);
  // Floored to a whole millimetre for the same reason the refusal message
  // is: a ceiling that is itself refused is worse than none.
  return Math.floor(Math.min(width, height)) / 1000;
}

/** A code to draw: its module matrix and the line printed under it. */
export interface PrintablePdfCode {
  /** Modules per side. */
  size: number;
  /** Row-major dark flags, `size * size` long; non-zero is dark. */
  modules: ArrayLike<number>;
  /** The caption under the code. ASCII only - see `pdfText`. */
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
      plan,
      options.captionMm ?? DEFAULT_CAPTION_MM
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
  plan: PrintPdfPlan,
  captionMm: number
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
    // The caption sits BELOW the quiet box, never inside it: ink inside the
    // quiet zone is exactly what the quiet zone exists to prevent.
    parts.push('BT /F1 9 Tf');
    parts.push(
      `${pt(placement.xMm)} ${pt(placement.yMm - captionMm + 2)} Td (${pdfText(code.caption)}) Tj`
    );
    parts.push('ET');
  }
  return parts.join('\n');
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

/**
 * A PDF literal string's contents.
 *
 * Escapes the three characters that would end or nest the string, and drops
 * anything outside printable ASCII: the base-14 fonts are single-byte
 * WinAnsi and a stray multi-byte character would render as mojibake rather
 * than fail, which is the worse outcome on a caption whose whole job is to
 * tell one poster from another.
 */
function pdfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (code >= 32 && code <= 126) out += ch;
  }
  return out;
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
  // Object numbering: 1 catalog, 2 pages, 3 font, then per page a page
  // object and its content stream.
  const pageObjectNumber = (i: number) => 4 + i * 2;
  const contentObjectNumber = (i: number) => 5 + i * 2;

  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Count ${String(pageCount)} /Kids [${contents
      .map((_, i) => `${String(pageObjectNumber(i))} 0 R`)
      .join(' ')}] >>`
  );
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  for (const [i, content] of contents.entries()) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> ` +
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
