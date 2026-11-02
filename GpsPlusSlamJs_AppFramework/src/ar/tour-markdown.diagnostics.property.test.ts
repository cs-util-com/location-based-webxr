/**
 * Why these properties matter: the editor draws an underline per
 * diagnostic and lists each by line number, so for ANY body the ranges
 * must lie inside it, come in order, never overlap and carry the line the
 * range starts on. Diagnosing must never change what the reader shows, and
 * plain words must never be reported.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  diagnoseTourMarkdown,
  parseTourMarkdown,
  type TourMdDiagnosticKind,
} from './tour-markdown';

/** What each kind's reported text looks like (leading spaces aside): a
 *  range that drifted onto the wrong characters fails its kind's shape.
 *  A code box's later parts (after a blank line inside it) are its plain
 *  lines, so `code` holds only for a part that is not one of those. */
const SHAPE: Record<TourMdDiagnosticKind, RegExp> = {
  heading: /^#{4,}/,
  quote: /^>/,
  list: /^(?:[-+*]|\d{1,9}[.)])/,
  rule: /^(?:[-*_=]\s*){3,}$|^=+$/,
  code: /^(?:`{3,}|~{3,})/,
  icode: /^`[\s\S]*`$/,
  table: /\|/,
  tabs: /\t/,
  html: /^</,
  entity: /^&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);$/,
  autolink: /^<[^<>\s]+>$/,
  strike: /^~~[\s\S]*~~$/,
  fnref: /^\[\^[^\]\s]+\]$/,
  fndef: /^\[\^[^\]\s]+\]:/,
  refdef: /^\[[^\]]*\]:/,
  webpic: /^!\[/,
  inlinepic: /^!\[/,
  manypic: /^!\[/,
  missingpic: /^!\[/,
  link: /^\[/,
};

/** Bodies rich in the marks the diagnostics look at. */
const markdownish = fc
  .array(
    fc.constantFrom(
      'a',
      'word',
      ' ',
      '  ',
      '\t',
      '\n',
      '\r\n',
      '\n\n',
      '#',
      '####',
      '>',
      '-',
      '---',
      '+',
      '1)',
      '1.',
      '*',
      '**',
      '`',
      '```',
      '~~',
      '|',
      '[',
      ']',
      '(',
      ')',
      '![',
      '](asset:p)',
      '](https://e.com)',
      '<b>',
      '</b>',
      '&amp;',
      '[^1]',
      ':',
      '=',
      '\\'
    ),
    { maxLength: 60 }
  )
  .map((parts) => parts.join(''));

/** The 1-based line `at` falls on, counting `\r\n`, `\r` and `\n`. */
function lineOf(body: string, at: number): number {
  return body
    .slice(0, at)
    .replace(/\r\n/g, '\n')
    .split(/[\r\n]/).length;
}

describe('diagnoseTourMarkdown properties', () => {
  it('reports in-bounds, ordered, non-overlapping ranges with their lines', () => {
    fc.assert(
      fc.property(
        fc.oneof(markdownish, fc.string({ maxLength: 80 })),
        (body) => {
          let end = 0;
          for (const d of diagnoseTourMarkdown(body)) {
            expect(d.from).toBeGreaterThanOrEqual(end);
            expect(d.to).toBeGreaterThan(d.from);
            expect(d.to).toBeLessThanOrEqual(body.length);
            expect(d.line).toBe(lineOf(body, d.from));
            end = d.to;
          }
        }
      ),
      { numRuns: 2000 }
    );
  });

  it('reports each kind over text of its own shape', () => {
    fc.assert(
      fc.property(markdownish, (body) => {
        let codeOpen = false;
        for (const d of diagnoseTourMarkdown(body, {
          assetExists: () => false,
        })) {
          const text = body.slice(d.from, d.to).trimStart();
          // A code box's continuation after a blank line inside it.
          if (d.kind === 'code' && codeOpen && !SHAPE.code.test(text)) {
            continue;
          }
          expect(text, `${d.kind} ${JSON.stringify(text)}`).toMatch(
            SHAPE[d.kind]
          );
          codeOpen = d.kind === 'code';
        }
      }),
      { numRuns: 2000 }
    );
  });

  it('never changes the parse', () => {
    fc.assert(
      fc.property(markdownish, (body) => {
        const before = parseTourMarkdown(body);
        diagnoseTourMarkdown(body, { assetExists: () => false });
        expect(parseTourMarkdown(body)).toEqual(before);
      }),
      { numRuns: 500 }
    );
  });

  it('reports nothing for plain words and paragraphs', () => {
    const plain = fc
      .array(fc.constantFrom('word', 'Words', ' ', '\n', '\n\n', 'x'), {
        maxLength: 40,
      })
      .map((parts) => parts.join(''));
    fc.assert(
      fc.property(plain, (body) => {
        expect(diagnoseTourMarkdown(body)).toEqual([]);
      })
    );
  });
});
