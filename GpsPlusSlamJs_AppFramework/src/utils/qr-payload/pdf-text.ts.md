# pdf-text.ts

## Purpose

Text for the hand-written print PDF (`qr-print-pdf.ts`): maps a string to
the single-byte WinAnsi encoding of the base-14 fonts, writes it as a PDF
literal, measures it with Helvetica's and Helvetica-Bold's metrics, and
wraps it to a width. Used for the poster text (Tour Viewer polish round
D-P7) and each code's caption.

## Public API

- `toWinAnsi(text): number[]` - the WinAnsi bytes. Printable ASCII and
  Latin-1 map to themselves, a no-break space to a space, the typographic
  characters WinAnsi keeps in 0x80-0x9F (euro, curly quotes, dashes,
  ellipsis, ...) to their slots. Everything else is DROPPED.
- `winAnsiText(text): string` - the text the PDF prints for `text`: what
  `toWinAnsi` keeps, read back. The Tour Viewer previews the poster with
  it, so a preview never shows a letter the PDF leaves off (M0c review).
- `pdfLiteral(codes): string` - the contents of a `( ... )` string: `(`,
  `)` and `\` escaped, bytes above 0x7E as three-digit octal escapes.
  Always printable ASCII.
- `textWidthEm(codes, font): number` - the advance width in em.
- `wrapText(text, font, emMm, maxWidthMm, maxLines): string[] | null` -
  greedy line breaking at spaces (whitespace runs collapse). `[]` for
  nothing printable; null when more lines are needed or one word alone is
  wider than the width (a word is never broken - the caller shrinks).
- `type PdfFont = 'regular' | 'bold'` - `/F1` and `/F2` in the PDF.

## Invariants & assumptions

- **No font is embedded**: Helvetica and Helvetica-Bold are among the 14
  fonts every PDF viewer and printer carries.
- **The width tables are Adobe's AFM values as pdf.js carries them**
  (`pdf.worker.mjs`, the Helvetica and Helvetica-Bold lookup tables) for
  WinAnsi 32..255. Cross-checked on 2026-10-12 against the system's Arial
  (metric-compatible) through a canvas `measureText`: within 0.01 % on
  four poster strings.
- **A missing character beats a wrong one**: what the font cannot show
  is dropped, never replaced by a look-alike or "?".
- **The content stream stays ASCII**, so its byte offsets are its string
  offsets (the PDF's xref still measures bytes, independently).

## Examples

```ts
const codes = toWinAnsi('Hafenführung'); // [0x48, ..., 0xfc, ...]
pdfLiteral(codes); // 'Hafenf\374hrung'
wrapText('Scan with your phone camera', 'regular', 10, 80, 2);
// ['Scan with your', 'phone camera']
```

## Tests

`pdf-text.test.ts`: Latin-1 and the 0x80-0x9F slots, dropped characters,
literal escaping (and a property that the literal is always printable
ASCII), the metric values for a few glyphs in both faces, greedy wrapping,
the no-fit cases, whitespace, and a property that no returned line is
wider than the width asked for.
