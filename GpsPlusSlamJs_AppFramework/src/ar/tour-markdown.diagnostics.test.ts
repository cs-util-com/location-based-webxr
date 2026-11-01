/**
 * Why these tests matter: the tour editor underlines and counts the parts
 * of a long text that visitors see as typed. They must come from the
 * reader's own decisions, or the editor would warn about text the reader
 * formats (or stay silent about text it shows raw). Each case pins one
 * decision point of the parser to the exact range it reports.
 */

import { describe, expect, it } from 'vitest';

import {
  diagnoseTourMarkdown,
  parseTourMarkdown,
  type TourMdDiagnostic,
} from './tour-markdown';

/** The kinds and the reported text of `body`'s diagnostics. */
function parts(
  body: string,
  options?: { assetExists?: (id: string) => boolean }
): [string, string][] {
  return diagnoseTourMarkdown(body, options).map((d: TourMdDiagnostic) => [
    d.kind,
    body.slice(d.from, d.to),
  ]);
}

describe('diagnoseTourMarkdown', () => {
  it('reports nothing for a body inside the subset', () => {
    const body =
      '# Title\n\nSome *italic* and **bold** words.\n\n- one\n  - two\n1. first\n\n> a quote\n\n[a link](https://example.com)\n\n![A view](asset:pic-1)';
    expect(parts(body, { assetExists: () => true })).toEqual([]);
  });

  it('reports block constructs shown as typed, from their first character', () => {
    expect(parts('#### Deep')).toEqual([['heading', '#### Deep']]);
    expect(parts('> > inner')).toEqual([['quote', '> inner']]);
    expect(parts('---')).toEqual([['rule', '---']]);
    expect(parts('+ plus item')).toEqual([['list', '+ plus item']]);
    expect(parts('1) paren item')).toEqual([['list', '1) paren item']]);
    expect(parts('- a\n  - b\n    - c')).toEqual([['list', '- c']]);
  });

  it('does not report a # run without a space, which is ordinary text', () => {
    expect(parts('#hashtag')).toEqual([]);
  });

  it('reports a fenced code box as one part over all its lines', () => {
    const body = 'Before\n```\ncode line\n```\nAfter';
    expect(parts(body)).toEqual([['code', '```\ncode line\n```']]);
  });

  it('follows a code box over a blank line inside it, and stops at its closing fence', () => {
    // Why: a blank line splits the box into two paragraphs. Read paragraph
    // by paragraph, the closing fence looked like a new box and marked the
    // plain text after it as code, while the box's own second half went
    // unmarked. The fence state follows the whole body, as the writer's
    // mirror does (mirror-marks.ts in the Tour Viewer).
    const body = 'Before\n```\nfirst\n\nsecond\n```\nAfter the box';
    expect(parts(body)).toEqual([
      ['code', '```\nfirst'],
      ['code', 'second\n```'],
    ]);
  });

  it('runs a code box that is never closed to the end of the body', () => {
    const body = '```\na\n\nb\n\nc';
    expect(parts(body)).toEqual([
      ['code', '```\na'],
      ['code', 'b'],
      ['code', 'c'],
    ]);
  });

  it('closes a code box only with its own mark, at least as long', () => {
    const body = '~~~~\nx\n\n```\n~~~\n\n~~~~\nplain';
    expect(parts(body)).toEqual([
      ['code', '~~~~\nx'],
      ['code', '```\n~~~'],
      ['code', '~~~~'],
    ]);
  });

  it('reports a table and tab columns as one part each', () => {
    expect(parts('| a | b |\n|---|---|\n| 1 | 2 |')).toEqual([
      ['table', '| a | b |\n|---|---|\n| 1 | 2 |'],
    ]);
    expect(parts('Name\tAge\nAnna\t31')).toEqual([
      ['tabs', 'Name\tAge\nAnna\t31'],
    ]);
  });

  it('reports a setext underline, footnote and reference definitions', () => {
    expect(parts('Title\n=====')).toEqual([['rule', '=====']]);
    expect(parts('Text\n[^1]: The note.')).toEqual([
      ['fndef', '[^1]: The note.'],
    ]);
    expect(parts('Text\n[home]: https://example.com')).toEqual([
      ['refdef', '[home]: https://example.com'],
    ]);
  });

  it('reports inline parts with their exact ranges', () => {
    expect(parts('Use `code` here')).toEqual([['icode', '`code`']]);
    expect(parts('A <b>bold</b> word')).toEqual([['html', '<b>bold</b>']]);
    expect(parts('Fish &amp; chips')).toEqual([['entity', '&amp;']]);
    expect(parts('See <https://example.com>')).toEqual([
      ['autolink', '<https://example.com>'],
    ]);
    expect(parts('Was ~~old~~ new')).toEqual([['strike', '~~old~~']]);
    expect(parts('A claim[^1] here')).toEqual([['fnref', '[^1]']]);
  });

  it('ignores an escaped mark and a link destination', () => {
    expect(parts('Not \\`code\\` here')).toEqual([]);
    expect(parts('[x](https://example.com/a&amp;b)')).toEqual([]);
  });

  it('reports pictures the reader shows as their alt text, by why', () => {
    expect(parts('![Web](https://example.com/a.jpg)')).toEqual([
      ['webpic', '![Web](https://example.com/a.jpg)'],
    ]);
    expect(parts('Text ![In line](asset:pic-1) more')).toEqual([
      ['inlinepic', '![In line](asset:pic-1)'],
    ]);
    expect(
      parts('![Gone](asset:pic-9)', { assetExists: (id) => id !== 'pic-9' })
    ).toEqual([['missingpic', '![Gone](asset:pic-9)']]);
    // Without assetExists, a well-formed asset target is not reported.
    expect(parts('![Gone](asset:pic-9)')).toEqual([]);
  });

  it('reports pictures past the cap', () => {
    const body = Array.from(
      { length: 21 },
      (_, i) => `![P${i}](asset:p-${i})`
    ).join('\n\n');
    expect(parts(body, { assetExists: () => true })).toEqual([
      ['manypic', '![P20](asset:p-20)'],
    ]);
  });

  it('reports a link whose target the reader refuses', () => {
    expect(parts('[x](javascript:alert(1))')).toEqual([
      ['link', '[x](javascript:alert(1))'],
    ]);
  });

  it('maps ranges through indentation, list markers and later lines', () => {
    const body = 'First line\n\n- item with `code`\n  more ~~gone~~';
    expect(parts(body)).toEqual([
      ['icode', '`code`'],
      ['strike', '~~gone~~'],
    ]);
    expect(diagnoseTourMarkdown(body).map((d) => d.line)).toEqual([3, 4]);
  });

  it('counts a CRLF as one line break', () => {
    expect(diagnoseTourMarkdown('a\r\nb\r\n#### c')).toEqual([
      { kind: 'heading', from: 6, to: 12, line: 3 },
    ]);
  });

  it('leaves the parse itself unchanged', () => {
    const body = '#### Deep\n\nA `code` <b>x</b> ![w](https://e.com/a.png)';
    const before = parseTourMarkdown(body);
    diagnoseTourMarkdown(body);
    expect(parseTourMarkdown(body)).toEqual(before);
  });

  it('returns no parts for a value that is not a string', () => {
    expect(diagnoseTourMarkdown(42 as unknown as string)).toEqual([]);
  });
});
