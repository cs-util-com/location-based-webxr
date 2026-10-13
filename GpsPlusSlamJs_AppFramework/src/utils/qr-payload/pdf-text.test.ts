import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  pdfLiteral,
  textWidthEm,
  toWinAnsi,
  winAnsiText,
  wrapText,
} from './pdf-text';

describe('toWinAnsi', () => {
  // Why: a poster title is typed by the creator, often in German. The PDF's
  // built-in fonts read single WinAnsi bytes, so "Führung" must become the
  // byte 0xFC, not two UTF-8 bytes that print as "FÃ¼hrung".
  it('maps Latin-1 letters to their single WinAnsi byte', () => {
    expect(toWinAnsi('Füße')).toEqual([0x46, 0xfc, 0xdf, 0x65]);
    expect(toWinAnsi('Café')).toEqual([0x43, 0x61, 0x66, 0xe9]);
  });

  it('maps the typographic characters WinAnsi keeps in 0x80-0x9F', () => {
    expect(toWinAnsi('€ – — … “”‘’')).toEqual([
      0x80, 0x20, 0x96, 0x20, 0x97, 0x20, 0x85, 0x20, 0x93, 0x94, 0x91, 0x92,
    ]);
  });

  // Why: an emoji or a CJK character has no glyph in the font; it must
  // vanish rather than print as some other letter.
  it('drops what the font cannot show, and control characters', () => {
    expect(toWinAnsi('Tour 🎉\u0007ok')).toEqual(toWinAnsi('Tour ok'));
    expect(toWinAnsi('東京')).toEqual([]);
  });
});

describe('winAnsiText (M0c review, finding 8b)', () => {
  // Why: the print step's preview tiles must show what the PDF prints - a
  // title the font cannot show in full ("Łódź") previewed whole and
  // printed "ód".
  it('is the text the PDF prints', () => {
    expect(winAnsiText('Łódź')).toBe('ód');
    expect(winAnsiText('Hafenführung – €5')).toBe('Hafenführung – €5');
    expect(winAnsiText('東京')).toBe('');
  });

  it('round-trips every printable WinAnsi character (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 30 }), (s) => {
        const once = winAnsiText(s);
        expect(winAnsiText(once)).toBe(once);
        expect(toWinAnsi(once)).toEqual(toWinAnsi(s));
      })
    );
  });
});

describe('pdfLiteral', () => {
  // Why: the content stream is written as text; a byte above 0x7E written
  // raw would be re-encoded as UTF-8 on the way out. Octal escapes keep the
  // stream ASCII and the byte exact.
  it('escapes delimiters and writes high bytes as octal', () => {
    expect(pdfLiteral(toWinAnsi('a(b)c\\'))).toBe('a\\(b\\)c\\\\');
    expect(pdfLiteral(toWinAnsi('ü€'))).toBe('\\374\\200');
  });

  it('always yields printable ASCII', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (s) => {
        expect(pdfLiteral(toWinAnsi(s))).toMatch(/^[\x20-\x7e]*$/);
      })
    );
  });
});

describe('textWidthEm', () => {
  // Why: centring and wrapping use these numbers; they are Helvetica's
  // published metrics (pdf.js's copy), in em.
  it('uses the Helvetica and Helvetica-Bold metrics', () => {
    expect(textWidthEm(toWinAnsi(' '), 'regular')).toBeCloseTo(0.278, 6);
    expect(textWidthEm(toWinAnsi('A'), 'regular')).toBeCloseTo(0.667, 6);
    expect(textWidthEm(toWinAnsi('A'), 'bold')).toBeCloseTo(0.722, 6);
    expect(textWidthEm(toWinAnsi('ü'), 'regular')).toBeCloseTo(0.556, 6);
    expect(textWidthEm(toWinAnsi('AA'), 'bold')).toBeCloseTo(1.444, 6);
  });
});

describe('wrapText', () => {
  it('keeps a line that fits as one line', () => {
    expect(wrapText('Harbour Lights', 'bold', 10, 200, 2)).toEqual([
      'Harbour Lights',
    ]);
  });

  // Why: a long tour name on a small poster wraps at a space rather than
  // running off the paper.
  it('breaks at spaces, filling each line greedily', () => {
    // At 10 mm per em, "Scan with your" is about 66 mm wide.
    expect(
      wrapText('Scan with your phone camera', 'regular', 10, 80, 2)
    ).toEqual(['Scan with your', 'phone camera']);
  });

  it('says it does not fit when more lines are needed, or a word is too wide', () => {
    expect(wrapText('one two three four', 'regular', 10, 30, 2)).toBeNull();
    expect(wrapText('Unbreakablewordhere', 'regular', 10, 50, 2)).toBeNull();
  });

  it('normalises whitespace and gives nothing for an empty text', () => {
    expect(wrapText('  a \n  b  ', 'regular', 10, 200, 2)).toEqual(['a b']);
    expect(wrapText('   ', 'regular', 10, 200, 2)).toEqual([]);
  });

  // Why: the one property the poster layout relies on - every line it is
  // handed fits the width it asked for.
  it('never returns a line wider than the width', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[A-Za-zäöü]{1,9}$/), { maxLength: 12 }),
        fc.double({ min: 2, max: 20, noNaN: true }),
        fc.double({ min: 20, max: 200, noNaN: true }),
        (words, em, width) => {
          const lines = wrapText(words.join(' '), 'bold', em, width, 3);
          for (const line of lines ?? []) {
            expect(
              textWidthEm(toWinAnsi(line), 'bold') * em
            ).toBeLessThanOrEqual(width + 1e-9);
          }
        }
      )
    );
  });
});
