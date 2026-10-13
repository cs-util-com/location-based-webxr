/**
 * Text for the hand-written print PDF (`qr-print-pdf.ts`): the poster's
 * title, explanation and call to action (Tour Viewer polish round D-P7),
 * and each code's caption.
 *
 * The PDF uses the base-14 fonts Helvetica and Helvetica-Bold, which every
 * viewer and printer carries, so nothing is embedded. Those fonts read ONE
 * byte per character in WinAnsiEncoding (Windows-1252): Latin-1 letters
 * such as the umlauts of a German tour name are in it, emoji and CJK are
 * not. This module maps text to those bytes, measures it with the fonts'
 * published metrics (copied from pdf.js, which renders the PDF in the
 * tests), and wraps it to a width.
 *
 * @see pdf-text.ts.md
 */

/** The two faces the PDF declares (`/F1` regular, `/F2` bold). */
export type PdfFont = 'regular' | 'bold';

/**
 * Glyph widths in 1/1000 em for WinAnsi codes 32..255, from pdf.js's
 * Helvetica and Helvetica-Bold metrics (`pdf.worker.mjs`, getMetrics),
 * which are Adobe's AFM values.
 */
const REGULAR_WIDTHS: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584, 350, 556, 350, 222, 556, 333, 1000, 556, 556, 333,
  1000, 667, 333, 1000, 350, 611, 350, 350, 222, 222, 333, 333, 350, 556, 1000,
  333, 1000, 500, 333, 944, 350, 500, 667, 278, 333, 556, 556, 556, 556, 260,
  556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556,
  537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667,
  667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778,
  778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556,
  556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556,
  556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

const BOLD_WIDTHS: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
  556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584, 350, 556, 350, 278, 556, 500, 1000, 556, 556, 333,
  1000, 667, 333, 1000, 350, 611, 350, 350, 278, 278, 500, 500, 350, 556, 1000,
  333, 1000, 556, 333, 944, 350, 500, 667, 278, 333, 556, 556, 556, 556, 280,
  556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611,
  556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722,
  722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778,
  778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556,
  556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611,
  611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

const FIRST_CODE = 32;
const LAST_CODE = 255;

/** Unicode characters WinAnsi keeps in 0x80-0x9F (where Latin-1 has
 *  control characters). */
const WIN_ANSI_HIGH: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

/**
 * The WinAnsi bytes of `text`. Printable ASCII and Latin-1 map to
 * themselves, a no-break space to a space; the typographic characters
 * WinAnsi holds (euro, curly quotes, dashes, ellipsis) to their slots.
 * Everything else - control characters, the soft hyphen, emoji, scripts
 * the font has no glyphs for - is DROPPED: a missing character is better
 * than a wrong one on a poster.
 */
export function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) out.push(code);
    else if (code === 0xa0) out.push(0x20);
    else if (code > 0xa0 && code <= 0xff && code !== 0xad) out.push(code);
    else {
      const high = WIN_ANSI_HIGH.get(code);
      if (high !== undefined) out.push(high);
    }
  }
  return out;
}

/** WinAnsi's 0x80-0x9F slots back to their Unicode characters. */
const WIN_ANSI_HIGH_CHARS: ReadonlyMap<number, string> = new Map(
  [...WIN_ANSI_HIGH].map(([unicode, byte]) => [
    byte,
    String.fromCodePoint(unicode),
  ])
);

/**
 * The text the PDF prints for `text`: what `toWinAnsi` keeps, read back
 * (a no-break space as a space). The print step previews the posters with
 * it, so a preview never shows a letter the PDF leaves off (M0c review).
 */
export function winAnsiText(text: string): string {
  let out = '';
  for (const code of toWinAnsi(text)) {
    out += WIN_ANSI_HIGH_CHARS.get(code) ?? String.fromCharCode(code);
  }
  return out;
}

/**
 * The contents of a PDF literal string `( ... )` for WinAnsi bytes: the
 * three delimiters escaped, bytes above 0x7E as octal escapes. The result
 * is printable ASCII, so the content stream stays ASCII and its byte
 * offsets are its string offsets.
 */
export function pdfLiteral(codes: readonly number[]): string {
  let out = '';
  for (const code of codes) {
    if (code === 0x28 || code === 0x29 || code === 0x5c) {
      out += `\\${String.fromCharCode(code)}`;
    } else if (code >= 0x20 && code <= 0x7e) {
      out += String.fromCharCode(code);
    } else {
      out += `\\${code.toString(8).padStart(3, '0')}`;
    }
  }
  return out;
}

/** The advance width of WinAnsi bytes in em. */
export function textWidthEm(codes: readonly number[], font: PdfFont): number {
  const table = font === 'bold' ? BOLD_WIDTHS : REGULAR_WIDTHS;
  let sum = 0;
  for (const code of codes) {
    if (code >= FIRST_CODE && code <= LAST_CODE) {
      sum += table[code - FIRST_CODE] ?? 0;
    }
  }
  return sum / 1000;
}

/**
 * Break `text` into at most `maxLines` lines no wider than `maxWidthMm` at
 * an em of `emMm`, greedily at spaces. Whitespace runs collapse to one
 * space. Returns `[]` for a text with nothing printable, and null when it
 * does not fit: more lines needed, or one word wider than the width (a
 * word is never broken - the caller shrinks the text instead).
 */
export function wrapText(
  text: string,
  font: PdfFont,
  emMm: number,
  maxWidthMm: number,
  maxLines: number
): string[] | null {
  const words = text.split(/\s+/).filter((word) => toWinAnsi(word).length > 0);
  if (words.length === 0) return [];
  const widthOf = (line: string): number =>
    textWidthEm(toWinAnsi(line), font) * emMm;
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (widthOf(word) > maxWidthMm) return null;
    const joined = current === '' ? word : `${current} ${word}`;
    if (widthOf(joined) <= maxWidthMm) {
      current = joined;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines.length <= maxLines ? lines : null;
}
