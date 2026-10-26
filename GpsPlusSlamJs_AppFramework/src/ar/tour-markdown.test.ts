/**
 * Why these tests matter: a long text's body is Markdown a creator typed,
 * and three things hang on how it is read - what the visitor sees, what a
 * narrator's timing points at (the plain text `P` and its offsets) and the
 * hash that says whether a timing still fits. Each accepted construct is
 * pinned here to its tree and its `P`; each construct outside the subset is
 * pinned to "shown as the characters typed", so a creator sees what went
 * wrong and nothing typed disappears; and the link check is pinned to its
 * refusals, because a link is the one construct that can send a visitor
 * somewhere else.
 */

import { describe, expect, it } from 'vitest';

import {
  checkTourLink,
  escapeTourMarkdown,
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
  TOUR_MARKDOWN_MAX_PICTURES,
  type TourMdBlock,
  type TourMdInline,
} from './tour-markdown';

const t = (text: string): TourMdInline => ({ kind: 'text', text });
const soft: TourMdInline = { kind: 'softBreak' };
const hard: TourMdInline = { kind: 'hardBreak' };
const em = (...children: TourMdInline[]): TourMdInline => ({
  kind: 'emphasis',
  children,
});
const strong = (...children: TourMdInline[]): TourMdInline => ({
  kind: 'strong',
  children,
});
const link = (
  href: string,
  host: string,
  ...children: TourMdInline[]
): TourMdInline => ({ kind: 'link', href, host, children });
const alt = (text: string): TourMdInline => ({ kind: 'pictureAlt', alt: text });
const p = (...inlines: TourMdInline[]): TourMdBlock => ({
  kind: 'paragraph',
  inlines,
});
const h = (level: 1 | 2 | 3, ...inlines: TourMdInline[]): TourMdBlock => ({
  kind: 'heading',
  level,
  inlines,
});
const ul = (...items: TourMdBlock[][]): TourMdBlock => ({
  kind: 'list',
  ordered: false,
  start: 1,
  items,
});
const ol = (start: number, ...items: TourMdBlock[][]): TourMdBlock => ({
  kind: 'list',
  ordered: true,
  start,
  items,
});
const q = (...blocks: TourMdBlock[]): TourMdBlock => ({
  kind: 'quote',
  blocks,
});
const pic = (text: string, asset: string): TourMdBlock => ({
  kind: 'picture',
  alt: text,
  asset,
});

const blocksOf = (body: string) => parseTourMarkdown(body).blocks;
const plain = (body: string) => plainTextOf(parseTourMarkdown(body)).text;

describe('parseTourMarkdown - paragraphs and breaks', () => {
  it('splits paragraphs on blank lines and reads a single newline as a soft break', () => {
    expect(blocksOf('a\nb\n\nc')).toEqual([p(t('a'), soft, t('b')), p(t('c'))]);
    expect(plain('a\nb\n\nc')).toBe('a b\n\nc');
  });

  it('reads both hard break forms, and a one-space line end as a soft break', () => {
    // Why: the trailing-space form is accepted so the reference agrees; its
    // spaces are not part of P.
    expect(blocksOf('a\\\nb')).toEqual([p(t('a'), hard, t('b'))]);
    expect(blocksOf('a  \nb')).toEqual([p(t('a'), hard, t('b'))]);
    expect(blocksOf('a   \n   b')).toEqual([p(t('a'), hard, t('b'))]);
    expect(blocksOf('a \nb')).toEqual([p(t('a'), soft, t('b'))]);
    expect(plain('a\\\nb')).toBe('a\nb');
    expect(plain('a  \nb')).toBe('a\nb');
  });

  it('keeps a backslash or spaces at the very end of a paragraph as no break', () => {
    expect(blocksOf('a\\')).toEqual([p(t('a\\'))]);
    expect(blocksOf('a  ')).toEqual([p(t('a'))]);
  });

  it('reads Windows and old Mac line endings like newlines', () => {
    expect(blocksOf('a\r\nb\r\n\r\nc')).toEqual(blocksOf('a\nb\n\nc'));
    expect(blocksOf('a\rb')).toEqual([p(t('a'), soft, t('b'))]);
  });

  it('replaces a NUL character with U+FFFD, as CommonMark does', () => {
    expect(blocksOf('a\u0000b')).toEqual([p(t('a\uFFFDb'))]);
  });

  it('keeps runs of spaces inside a line and trims the ends of P', () => {
    expect(plain('  a  b  ')).toBe('a  b');
  });
});

describe('parseTourMarkdown - headings', () => {
  it('reads #, ## and ### headings and drops a closing # sequence', () => {
    expect(blocksOf('# A\n## B ##\n### C')).toEqual([
      h(1, t('A')),
      h(2, t('B')),
      h(3, t('C')),
    ]);
    expect(blocksOf('   ## B')).toEqual([h(2, t('B'))]);
    expect(blocksOf('# foo#')).toEqual([h(1, t('foo#'))]);
  });

  it('needs a space after the hashes', () => {
    expect(blocksOf('#A')).toEqual([p(t('#A'))]);
  });

  it('shows a heading deeper than 3 as typed', () => {
    expect(blocksOf('#### D')).toEqual([p(t('#### D'))]);
    expect(blocksOf('para\n#### D')).toEqual([p(t('para'), soft, t('#### D'))]);
    expect(blocksOf('####### E')).toEqual([p(t('####### E'))]);
  });

  it('gives an empty heading no leaf in P', () => {
    expect(blocksOf('#')).toEqual([h(1)]);
    expect(plain('# A\n#\n# B')).toBe('A\n\nB');
  });

  it('keeps emphasis in a heading out of P', () => {
    expect(plain('## A *b* c')).toBe('A b c');
  });
});

describe('parseTourMarkdown - lists', () => {
  it('reads - and * bullet lists, and a change of bullet starts a new list', () => {
    expect(blocksOf('- a\n- b')).toEqual([ul([p(t('a'))], [p(t('b'))])]);
    expect(blocksOf('* a')).toEqual([ul([p(t('a'))])]);
    expect(blocksOf('- a\n* b')).toEqual([ul([p(t('a'))]), ul([p(t('b'))])]);
  });

  it('reads an ordered list whose first number sets its start', () => {
    expect(blocksOf('3. a\n4. b')).toEqual([ol(3, [p(t('a'))], [p(t('b'))])]);
    expect(blocksOf('007. a')).toEqual([ol(7, [p(t('a'))])]);
  });

  it('shows the + bullet and the ) delimiter as typed', () => {
    expect(blocksOf('+ a')).toEqual([p(t('+ a'))]);
    expect(blocksOf('1) a')).toEqual([p(t('1) a'))]);
  });

  it('lets only an ordered item starting at 1 interrupt a paragraph, and never an empty one', () => {
    expect(blocksOf('a\n2. b')).toEqual([p(t('a'), soft, t('2. b'))]);
    expect(blocksOf('a\n1. b')).toEqual([p(t('a')), ol(1, [p(t('b'))])]);
    expect(blocksOf('a\n-')).toEqual([p(t('a'), soft, t('-'))]);
  });

  it('nests a list two levels deep by indentation', () => {
    expect(blocksOf('- a\n  - b')).toEqual([ul([p(t('a')), ul([p(t('b'))])])]);
    expect(blocksOf('1. a\n   - b')).toEqual([
      ol(1, [p(t('a')), ul([p(t('b'))])]),
    ]);
  });

  it('counts a list of another bullet after a nested list at the level it lands on', () => {
    // Why: found by the differential - the new list closes the nested one
    // and opens beside it, at level 2, so it is not a third level.
    expect(blocksOf('- - a\n\n  * b')).toEqual([
      ul([ul([p(t('a'))]), ul([p(t('b'))])]),
    ]);
  });

  it('shows a third list level as typed', () => {
    expect(blocksOf('- a\n  - b\n    - c')).toEqual([
      ul([p(t('a')), ul([p(t('b'), soft, t('- c'))])]),
    ]);
    expect(blocksOf('- a\n  - b\n\n    - c')).toEqual([
      ul([p(t('a')), ul([p(t('b')), p(t('- c'))])]),
    ]);
    expect(blocksOf('1. a\n   1. b\n      1. c')).toEqual([
      ol(1, [p(t('a')), ol(1, [p(t('b'), soft, t('1. c'))])]),
    ]);
  });

  it('gives a list item holding two paragraphs two leaves', () => {
    expect(blocksOf('- a\n\n  b')).toEqual([ul([p(t('a')), p(t('b'))])]);
    expect(plain('- a\n\n  b\n- c')).toBe('a\n\nb\n\nc');
  });

  it('continues an item lazily, as CommonMark does', () => {
    expect(blocksOf('- a\nb')).toEqual([ul([p(t('a'), soft, t('b'))])]);
  });

  it('shows a task list box as typed', () => {
    expect(blocksOf('- [ ] task')).toEqual([ul([p(t('[ ] task'))])]);
  });
});

describe('parseTourMarkdown - quotes', () => {
  it('reads a one-level quote, lazy lines included', () => {
    expect(blocksOf('> a\n> b')).toEqual([q(p(t('a'), soft, t('b')))]);
    expect(blocksOf('> a\nb')).toEqual([q(p(t('a'), soft, t('b')))]);
    expect(blocksOf('> a\n\nb')).toEqual([q(p(t('a'))), p(t('b'))]);
  });

  it('shows a nested quote marker as typed', () => {
    expect(blocksOf('> > a')).toEqual([q(p(t('> a')))]);
    expect(blocksOf('> - > a')).toEqual([q(ul([p(t('> a'))]))]);
  });

  it('allows a quote inside a list item and a list inside a quote', () => {
    expect(blocksOf('- > a')).toEqual([ul([q(p(t('a')))])]);
    expect(blocksOf('> - a')).toEqual([q(ul([p(t('a'))]))]);
  });
});

describe('parseTourMarkdown - pictures', () => {
  it('reads a picture on a line of its own as a picture block with no leaf', () => {
    expect(blocksOf('![A tree](asset:tree_1)')).toEqual([
      pic('A tree', 'tree_1'),
    ]);
    expect(blocksOf('  ![a](asset:x)  ')).toEqual([pic('a', 'x')]);
    expect(plainTextOf(parseTourMarkdown('![A](asset:x)'))).toEqual({
      text: '',
      leaves: [],
    });
  });

  it('reads picture lines that follow each other as separate pictures', () => {
    expect(blocksOf('![a](asset:x)\n![b](asset:y)')).toEqual([
      pic('a', 'x'),
      pic('b', 'y'),
    ]);
  });

  it('shows a picture inside a paragraph as its alt text box, which adds nothing to P', () => {
    expect(blocksOf('see ![A](asset:x) here')).toEqual([
      p(t('see '), alt('A'), t(' here')),
    ]);
    expect(plain('see ![A](asset:x) here')).toBe('see  here');
  });

  it('shows a picture with any target but asset:<id> as its alt text box', () => {
    // Why: no remote picture, ever - fetching one tells a third party where
    // a visitor stands.
    for (const target of [
      'https://x.org/a.png',
      'http://x.org/a.png',
      'data:image/png;base64,AA',
      'blob:x',
      'a.png',
      'asset:a/b',
      'asset:',
    ]) {
      expect(blocksOf(`![A](${target})`)).toEqual([p(alt('A'))]);
    }
    expect(plain('![A](https://x.org/a.png)')).toBe('');
  });

  it('takes the alt text as plain text', () => {
    expect(blocksOf('![a *b*](https://x.org/y.png)')).toEqual([p(alt('a b'))]);
  });

  it(`keeps at most ${TOUR_MARKDOWN_MAX_PICTURES} pictures; the rest show their alt text`, () => {
    const body = Array.from(
      { length: TOUR_MARKDOWN_MAX_PICTURES + 1 },
      (_, i) => `![p${i}](asset:a${i})`
    ).join('\n\n');
    const blocks = blocksOf(body);
    expect(blocks.slice(0, TOUR_MARKDOWN_MAX_PICTURES)).toEqual(
      Array.from({ length: TOUR_MARKDOWN_MAX_PICTURES }, (_, i) =>
        pic(`p${i}`, `a${i}`)
      )
    );
    expect(blocks[TOUR_MARKDOWN_MAX_PICTURES]).toEqual(
      p(alt(`p${TOUR_MARKDOWN_MAX_PICTURES}`))
    );
  });
});

describe('parseTourMarkdown - emphasis and escapes', () => {
  it('reads *em*, _em_, **strong** and __strong__', () => {
    expect(blocksOf('*a* _b_ **c** __d__')).toEqual([
      p(
        em(t('a')),
        t(' '),
        em(t('b')),
        t(' '),
        strong(t('c')),
        t(' '),
        strong(t('d'))
      ),
    ]);
    expect(plain('*a* _b_ **c** __d__')).toBe('a b c d');
  });

  it('follows CommonMark for nesting and intraword delimiters', () => {
    expect(blocksOf('***a***')).toEqual([p(em(strong(t('a'))))]);
    expect(blocksOf('snake_case_word')).toEqual([p(t('snake_case_word'))]);
    expect(blocksOf('2*3*4')).toEqual([p(t('2'), em(t('3')), t('4'))]);
    expect(blocksOf('*a\nb*')).toEqual([p(em(t('a'), soft, t('b')))]);
  });

  it('resolves backslash escapes of ASCII punctuation only', () => {
    expect(blocksOf('\\*not em\\*')).toEqual([p(t('*not em*'))]);
    expect(blocksOf('\\a')).toEqual([p(t('\\a'))]);
    expect(blocksOf('\\\\')).toEqual([p(t('\\'))]);
    expect(blocksOf('\\# not heading')).toEqual([p(t('# not heading'))]);
    expect(blocksOf('\\- not list')).toEqual([p(t('- not list'))]);
  });

  // Why: the CommonMark spec classifies the character beside a delimiter
  // run by code point, so an emoji (a symbol outside the BMP) counts as
  // punctuation exactly as a symbol inside it does. commonmark.js 0.31.2
  // looks at one UTF-16 unit there and reads half a surrogate pair as
  // neither, which turns `a*😀*a` into emphasis. The differential test
  // leaves this one case out; this test pins the spec's reading instead.
  it('treats an emoji beside a delimiter as punctuation, by code point', () => {
    expect(blocksOf('a*\u{1F600}*a')).toEqual([p(t('a*\u{1F600}*a'))]);
    expect(blocksOf('a*©*a')).toEqual([p(t('a*©*a'))]);
    expect(blocksOf('a_\u{1F600}_a')).toEqual([p(t('a_\u{1F600}_a'))]);
    expect(blocksOf('\u{1F600}*a*')).toEqual([p(t('\u{1F600}'), em(t('a')))]);
    expect(blocksOf('*\u{1F600}*')).toEqual([p(em(t('\u{1F600}')))]);
  });

  it('survives emphasis nested far deeper than anyone writes', () => {
    const body = `${'*'.repeat(400)}a${'*'.repeat(400)}`;
    expect(plain(body)).toBe('a');
  });
});

describe('parseTourMarkdown - links', () => {
  it('reads an https link with its text, href and ASCII host', () => {
    expect(blocksOf('[Town archive](https://archive.example/x)')).toEqual([
      p(
        link('https://archive.example/x', 'archive.example', t('Town archive'))
      ),
    ]);
    expect(blocksOf('[*a* b](https://x.org)')).toEqual([
      p(link('https://x.org/', 'x.org', em(t('a')), t(' b'))),
    ]);
  });

  it('balances parentheses in the target', () => {
    expect(blocksOf('[W](https://en.wikipedia.org/wiki/A_(b))')).toEqual([
      p(
        link('https://en.wikipedia.org/wiki/A_(b)', 'en.wikipedia.org', t('W'))
      ),
    ]);
  });

  it('shows an internationalised host in its ASCII form', () => {
    expect(blocksOf('[a](https://bücher.example)')).toEqual([
      p(
        link('https://xn--bcher-kva.example/', 'xn--bcher-kva.example', t('a'))
      ),
    ]);
  });

  it('keeps the text and drops the link when the target fails the check', () => {
    expect(blocksOf('[a](javascript:alert(1))')).toEqual([p(t('a'))]);
    expect(blocksOf('[a](http://x.org)')).toEqual([p(t('a'))]);
    expect(blocksOf('[a](https://u:p@x.org)')).toEqual([p(t('a'))]);
    expect(blocksOf('[*a*](http://x.org)')).toEqual([p(em(t('a')))]);
    expect(plain('see [a](http://x.org) here')).toBe('see a here');
  });

  it('adds only the link text to P, never the host or the URL', () => {
    expect(plain('[Town archive](https://archive.example/x)')).toBe(
      'Town archive'
    );
  });
});

describe('parseTourMarkdown - shown as the characters typed', () => {
  // Why: everything outside the subset stays visible exactly as typed, so a
  // creator sees what went wrong and nothing written disappears.
  const asTyped: [string, TourMdBlock[]][] = [
    ['<b>x</b>', [p(t('<b>x</b>'))]],
    ['`code`', [p(t('`code`'))]],
    ['a &amp; b', [p(t('a &amp; b'))]],
    ['&#42;', [p(t('&#42;'))]],
    ['```\ncode\n```', [p(t('```'), soft, t('code'), soft, t('```'))]],
    ['    indented', [p(t('indented'))]],
    ['    # A', [p(t('# A'))]],
    ['a\n---', [p(t('a'), soft, t('---'))]],
    ['A\n===', [p(t('A'), soft, t('==='))]],
    ['***', [p(t('***'))]],
    ['* * *', [p(t('* * *'))]],
    ['- - -', [p(t('- - -'))]],
    ['<https://x.org>', [p(t('<https://x.org>'))]],
    ['see https://x.org', [p(t('see https://x.org'))]],
    [
      '[a][ref]\n\n[ref]: https://x.org',
      [p(t('[a][ref]')), p(t('[ref]: https://x.org'))],
    ],
    ['~~s~~', [p(t('~~s~~'))]],
    ['| a | b |\n|---|---|', [p(t('| a | b |'), soft, t('|---|---|'))]],
    ['a[^1]', [p(t('a[^1]'))]],
    ['[a](https://x.org "title")', [p(t('[a](https://x.org "title")'))]],
    ['[a](<https://x.org>)', [p(t('[a](<https://x.org>)'))]],
  ];
  for (const [body, blocks] of asTyped) {
    it(`shows ${JSON.stringify(body)} as typed`, () => {
      expect(blocksOf(body)).toEqual(blocks);
    });
  }

  it('counts raw HTML in P exactly as shown', () => {
    expect(plain('<b>')).toBe('<b>');
  });
});

describe('parseTourMarkdown - defensive input', () => {
  it('reads anything that is not a string as an empty body', () => {
    const values: unknown[] = [undefined, null, 42, {}, ['# a']];
    for (const value of values) {
      expect(parseTourMarkdown(value as string)).toEqual({
        blocks: [],
      });
    }
  });

  it('reads an empty or blank body as no blocks', () => {
    expect(blocksOf('')).toEqual([]);
    expect(blocksOf('\n \n\t\n')).toEqual([]);
  });
});

describe('plainTextOf', () => {
  it('joins leaves with a blank line and records the range of each', () => {
    const doc = parseTourMarkdown('# T\n\npara *x*\n\n- i1\n- i2');
    const { text, leaves } = plainTextOf(doc);
    expect(text).toBe('T\n\npara x\n\ni1\n\ni2');
    const list = doc.blocks[2];
    if (list?.kind !== 'list') throw new Error('expected a list');
    expect(leaves).toEqual([
      { block: doc.blocks[0], from: 0, to: 1 },
      { block: doc.blocks[1], from: 3, to: 9 },
      { block: list.items[0]?.[0], from: 11, to: 13 },
      { block: list.items[1]?.[0], from: 15, to: 17 },
    ]);
    for (const leaf of leaves) {
      expect(leaf.block).toBeDefined();
    }
  });

  it('trims a leaf that starts or ends with a picture box', () => {
    expect(plain('![x](https://a.org/b.png) b')).toBe('b');
    expect(plain('![x](https://a.org/b.png)\\\nb')).toBe('b');
  });

  it('adds nothing for a picture and no separator for it', () => {
    expect(plain('a\n\n![x](asset:x)\n\nb')).toBe('a\n\nb');
  });
});

describe('checkTourLink', () => {
  it('accepts an https URL and gives its parsed href and ASCII host', () => {
    expect(checkTourLink('https://x.org')).toEqual({
      ok: true,
      href: 'https://x.org/',
      host: 'x.org',
    });
    expect(checkTourLink('HTTPS://X.ORG/a?b#c')).toEqual({
      ok: true,
      href: 'https://x.org/a?b#c',
      host: 'x.org',
    });
    expect(checkTourLink('https://bücher.example/')).toEqual({
      ok: true,
      href: 'https://xn--bcher-kva.example/',
      host: 'xn--bcher-kva.example',
    });
  });

  it('refuses every other scheme, user info and what does not parse', () => {
    for (const target of [
      'javascript:alert(1)',
      'http://x.org',
      'data:text/html,x',
      'mailto:a@b.org',
      'ftp://x.org',
      'https://u@x.org',
      'https://:p@x.org',
      'https://u:p@x.org',
      'https://',
      '/relative',
      '',
    ]) {
      expect(checkTourLink(target)).toEqual({ ok: false });
    }
    expect(checkTourLink(42 as unknown as string)).toEqual({ ok: false });
  });
});

describe('escapeTourMarkdown', () => {
  it('escapes every ASCII punctuation character and keeps line structure', () => {
    expect(escapeTourMarkdown('*x*')).toBe('\\*x\\*');
    expect(escapeTourMarkdown('a.b')).toBe('a\\.b');
    expect(escapeTourMarkdown('a\nb')).toBe('a\\\nb');
    expect(escapeTourMarkdown('a\n\n\nb')).toBe('a\n\nb');
  });

  it('gives a body whose P is the text', () => {
    for (const text of [
      '# not a heading',
      '- not a list',
      '1. not a list',
      '> not a quote',
      '[not](https://a.link)',
      '![not](asset:a)',
      '<b>not html</b>',
      'a\\b',
      'line one\nline two\n\nnext paragraph',
    ]) {
      expect(plain(escapeTourMarkdown(text))).toBe(text);
    }
  });

  it('trims each line and drops empty paragraphs, which P cannot hold', () => {
    expect(plain(escapeTourMarkdown('  a  \n\n \n  b'))).toBe('a\n\nb');
    expect(escapeTourMarkdown('')).toBe('');
    expect(escapeTourMarkdown(42 as unknown as string)).toBe('');
  });
});

describe('textHashOf', () => {
  it('is sha256: plus the SHA-256 of the UTF-8 bytes of P in lowercase hex', async () => {
    // Values from Node's own crypto, so the test does not trust the code it
    // checks.
    await expect(textHashOf('')).resolves.toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    await expect(textHashOf('abc')).resolves.toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    await expect(textHashOf('é')).resolves.toBe(
      'sha256:4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c'
    );
    await expect(textHashOf('a b\n\nc')).resolves.toBe(
      'sha256:6fd15da2b2c1db77735710a989b9c9310603496a6cc0bcf14031319265390e3a'
    );
  });
});
