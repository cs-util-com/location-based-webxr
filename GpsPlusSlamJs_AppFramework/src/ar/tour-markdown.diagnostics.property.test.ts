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
  rule: /^(?:[-*_=]\s*){3,}$|^=+\s*$/,
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

/** A fence line inside a part (so after a line break in it): a fence
 *  after any indentation and quote or list marks; group 1 is its mark.
 *  Only the list marks the reader takes as items (`-`, `*`, `1.`): after
 *  a `+` or a `1)` the line stays a paragraph line, and its fence is
 *  text. Still counted here, though the reader shows them as typed: a
 *  fence after four columns of indentation or after a third list level,
 *  and one right under a box line after a number other than 1 (only an
 *  item numbered 1 interrupts a paragraph line). */
const FENCE_LINE_INSIDE =
  /[\r\n](?:[ \t]|>|[-*](?=[ \t])|\d{1,9}\.(?=[ \t]))*(`{3,}|~{3,})/g;

/** The mark of a code box still open after the fence lines inside `text`,
 *  starting from `open`: a fence opens a box when none is open, and closes
 *  it when it has the same sign and is at least as long, as the reader
 *  decides. */
function fenceStateAfter(text: string, open: string | null): string | null {
  let mark = open;
  for (const fence of text.matchAll(FENCE_LINE_INSIDE)) {
    const found = fence[1] ?? '';
    if (mark === null) mark = found;
    else if (found.startsWith(mark)) mark = null;
  }
  return mark;
}

/** What lies on a part's line before it: for a part inside a quote or a
 *  list item, that container's marks. */
function marksBefore(body: string, at: number): string {
  if (at === 0) return '';
  const lineStart =
    Math.max(body.lastIndexOf('\n', at - 1), body.lastIndexOf('\r', at - 1)) +
    1;
  return body.slice(lineStart, at);
}

/** Marks that put a part inside a quote or a list item. */
const CONTAINER_MARKS = /^(?:[ \t]|>|(?:[-*]|\d{1,9}\.)[ \t])*$/;

/** The column widths of `marks` split at each quote mark, tabs to the next
 *  multiple of four. */
function segmentWidths(marks: string): number[] {
  const widths: number[] = [];
  let col = 0;
  let start = 0;
  for (const ch of marks) {
    if (ch === '>') {
      widths.push(col - start);
      start = col + 1;
    }
    col = ch === '\t' ? col + 4 - (col % 4) : col + 1;
  }
  widths.push(col - start);
  return widths;
}

/** Whether a later part with `marks` before it is still inside the
 *  container a box opened in after `opener`: as many quote marks, and
 *  under each list mark of the opener only indentation at least as wide
 *  as that mark's (a new item, or a line indented less, ends it). */
function sameContainer(marks: string, opener: string): boolean {
  const segments = marks.split('>');
  const openerSegments = opener.split('>');
  if (segments.length !== openerSegments.length) return false;
  const widths = segmentWidths(marks);
  const openerWidths = segmentWidths(opener);
  return segments.every(
    (segment, i) =>
      /^[ \t]*$/.test(segment) &&
      (/^[ \t]*$/.test(openerSegments[i] ?? '') ||
        (widths[i] ?? 0) >= (openerWidths[i] ?? 0))
  );
}

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

/**
 * Asserts that each of `body`'s parts lies over text of its kind's shape.
 * It follows the mark of the code box still open after the parts so far,
 * by the fence lines they cover: a part that does not start with a fence
 * is code only as a later part of an open box (after a blank line inside
 * it). The box's fence line may lie under a part of another kind that
 * starts first (a link over two lines), which hides the fence's own part;
 * that part's fence lines count too. A box opened inside a quote or a list
 * item ends with it, as the reader decides: the marks before a later part
 * on its line show whether that part is still inside.
 */
function expectPartsOfTheirShape(body: string): void {
  let openMark: string | null = null;
  let opener: string | null = null;
  for (const d of diagnoseTourMarkdown(body, { assetExists: () => false })) {
    const marks = marksBefore(body, d.from);
    if (opener !== null && !sameContainer(marks, opener)) openMark = null;
    const wasOpen = openMark !== null;
    const own = body.slice(d.from, d.to);
    const text = own.trimStart();
    const continues =
      d.kind === 'code' && openMark !== null && !SHAPE.code.test(text);
    if (!continues) {
      expect(text, `${d.kind} ${JSON.stringify(text)}`).toMatch(SHAPE[d.kind]);
    }
    // A code part's first line is a fence line too.
    openMark = fenceStateAfter(d.kind === 'code' ? `\n${own}` : own, openMark);
    if (openMark === null) opener = null;
    else if (!wasOpen) opener = boxOpener(d.kind, marks);
  }
}

/** The container marks a box opened by a part of `kind` lies after, or
 *  null for a box outside any container (or opened under another part). */
function boxOpener(kind: TourMdDiagnosticKind, marks: string): string | null {
  return kind === 'code' && CONTAINER_MARKS.test(marks) && /\S/.test(marks)
    ? marks
    : null;
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
    // A failing run's body is kept as a fixed example below and in the
    // unit tests: "a code box open when its fence line lies under a link
    // part".
    expect.hasAssertions();
    fc.assert(fc.property(markdownish, expectPartsOfTheirShape), {
      numRuns: 2000,
    });
  });

  it('holds the shape check on code boxes the generator rarely builds', () => {
    expect.hasAssertions();
    // Why: two boxes at line starts, the second after the first closed,
    // are rare in the generated bodies (50 000 runs held none), yet a
    // second box's first part drifting off its fence must be caught; and
    // a box whose fence a link covers must not be; nor may a fence after a
    // `+` bullet, which the reader does not take as an item, close a box;
    // and a box opened inside a quote or a list item ends with it, while
    // it stays open over a blank line the container keeps. Each body pins
    // one.
    for (const body of [
      '```\n+ ```\n\na',
      '>```\n\n```\n\na',
      '- ```\n\n```\n\na',
      '> ```\n>\n> a',
      '- ```\n\n  a',
      '```\na\n```\n\n```\nb\n```',
      '```\na\n```\nx\n```\nb\n```',
      'x\n```\na\n```\n\ny\n```\nb',
      '```\n\na\n```\n\n```\nb',
      '[\r\n```](asset:p)\n\na',
    ]) {
      expectPartsOfTheirShape(body);
    }
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
