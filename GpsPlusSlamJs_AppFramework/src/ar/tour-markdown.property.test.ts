/**
 * Why these properties matter:
 *
 * - The differential: the subset parser is written here rather than taken
 *   from a library, so its CommonMark edge cases are held to the reference
 *   implementation (`commonmark`, a devDependency only) on generated bodies
 *   INSIDE the subset. Outside it, "shown as typed" is the specified
 *   behaviour and nothing is compared.
 * - Totality: a body is whatever a creator or a hand-edited file holds, so
 *   the parser must read any string, up to a megabyte, without throwing.
 * - The plain text `P`: read-along offsets and the stale-check hash refer to
 *   it, so formatting (emphasis, a heading's level) must never move it, the
 *   escaper must round-trip plain text through it, and every offset must
 *   map to exactly one leaf position.
 */

import { Parser, type Node as CmNode } from 'commonmark';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  escapeTourMarkdown,
  parseTourMarkdown,
  plainTextOf,
  TOUR_MARKDOWN_MAX_PICTURES,
  type TourMarkdown,
  type TourMdBlock,
  type TourMdInline,
} from './tour-markdown';

// ---------------------------------------------------------------------------
// A normalised tree both parsers are compared in

interface Norm {
  readonly t: string;
  readonly v?: string | number;
  readonly c?: readonly Norm[];
}

function pushNormText(out: Norm[], text: string): void {
  if (text === '') return;
  const last = out[out.length - 1];
  if (last?.t === 'text')
    out[out.length - 1] = { t: 'text', v: `${String(last.v)}${text}` };
  else out.push({ t: 'text', v: text });
}

function normOurInlines(inlines: readonly TourMdInline[]): Norm[] {
  const out: Norm[] = [];
  for (const inline of inlines) {
    switch (inline.kind) {
      case 'text':
        pushNormText(out, inline.text);
        break;
      case 'softBreak':
        out.push({ t: 'soft' });
        break;
      case 'hardBreak':
        out.push({ t: 'hard' });
        break;
      case 'pictureAlt':
        out.push({ t: 'alt', v: inline.alt });
        break;
      case 'link':
        out.push({
          t: 'a',
          v: inline.href,
          c: normOurInlines(inline.children),
        });
        break;
      default:
        out.push({
          t: inline.kind === 'strong' ? 'strong' : 'em',
          c: normOurInlines(inline.children),
        });
    }
  }
  return out;
}

function normOurBlocks(blocks: readonly TourMdBlock[]): Norm[] {
  return blocks.map((block): Norm => {
    switch (block.kind) {
      case 'paragraph':
        return { t: 'p', c: normOurInlines(block.inlines) };
      case 'heading':
        return { t: 'h', v: block.level, c: normOurInlines(block.inlines) };
      case 'picture':
        return { t: 'pic', v: `${block.alt}|${block.asset}` };
      case 'quote':
        return { t: 'q', c: normOurBlocks(block.blocks) };
      default:
        return {
          t: block.ordered ? 'ol' : 'ul',
          v: block.ordered ? block.start : 1,
          c: block.items.map((item) => ({ t: 'li', c: normOurBlocks(item) })),
        };
    }
  });
}

function childrenOf(node: CmNode): CmNode[] {
  const out: CmNode[] = [];
  for (let c = node.firstChild; c !== null; c = c.next) out.push(c);
  return out;
}

function cmAltText(node: CmNode): string {
  let out = '';
  for (const child of childrenOf(node)) {
    if (child.type === 'text') out += child.literal ?? '';
    else if (child.type === 'softbreak' || child.type === 'linebreak')
      out += ' ';
    else out += cmAltText(child);
  }
  return out;
}

class OutsideSubset extends Error {}

const CM_BREAKS: Readonly<Record<string, string>> = {
  softbreak: 'soft',
  linebreak: 'hard',
};
const CM_SPANS: Readonly<Record<string, string>> = {
  emph: 'em',
  strong: 'strong',
};

function normCmInline(child: CmNode): Norm {
  const breakName = CM_BREAKS[child.type];
  if (breakName !== undefined) return { t: breakName };
  const spanName = CM_SPANS[child.type];
  if (spanName !== undefined) return { t: spanName, c: normCmInlines(child) };
  if (child.type === 'image') return { t: 'alt', v: cmAltText(child) };
  if (child.type !== 'link')
    throw new OutsideSubset(`the reference read a ${child.type}`);
  return {
    t: 'a',
    v: new URL(child.destination ?? '').href,
    c: normCmInlines(child),
  };
}

function normCmInlines(node: CmNode): Norm[] {
  const out: Norm[] = [];
  for (const child of childrenOf(node)) {
    if (child.type === 'text') pushNormText(out, child.literal ?? '');
    else out.push(normCmInline(child));
  }
  return out;
}

const ASSET_TARGET = /^asset:([A-Za-z0-9_-]{1,64})$/;

/** The reference's paragraph of pictures on their own lines, as picture
 *  blocks (the subset's reading), or null. */
function cmPictureLines(node: CmNode): CmNode[] | null {
  const pictures: CmNode[] = [];
  for (const child of childrenOf(node)) {
    if (child.type === 'image' && ASSET_TARGET.test(child.destination ?? '')) {
      pictures.push(child);
    } else if (!isBetweenPictureLines(child)) {
      return null;
    }
  }
  return pictures.length > 0 ? pictures : null;
}

/** A line break, or spaces and tabs, between picture lines. */
function isBetweenPictureLines(child: CmNode): boolean {
  if (child.type === 'softbreak' || child.type === 'linebreak') return true;
  return child.type === 'text' && /^[ \t]*$/.test(child.literal ?? '');
}

/** A reference paragraph as the subset reads it: picture blocks while the
 *  picture budget lasts when it is made of picture lines, else a paragraph. */
function normCmParagraph(child: CmNode, budget: { left: number }): Norm[] {
  const pictures = cmPictureLines(child);
  if (pictures === null) return [{ t: 'p', c: normCmInlines(child) }];
  return pictures.map((picture): Norm => {
    const asset = ASSET_TARGET.exec(picture.destination ?? '')?.[1] ?? '';
    return budget.left-- > 0
      ? { t: 'pic', v: `${cmAltText(picture)}|${asset}` }
      : { t: 'p', c: [{ t: 'alt', v: cmAltText(picture) }] };
  });
}

function normCmBlocks(node: CmNode, budget: { left: number }): Norm[] {
  const out: Norm[] = [];
  for (const child of childrenOf(node)) {
    switch (child.type) {
      case 'paragraph':
        out.push(...normCmParagraph(child, budget));
        break;
      case 'heading':
        out.push({ t: 'h', v: child.level, c: normCmInlines(child) });
        break;
      case 'block_quote':
        out.push({ t: 'q', c: normCmBlocks(child, budget) });
        break;
      case 'list':
        out.push(normCmList(child, budget));
        break;
      default:
        throw new OutsideSubset(`the reference read a ${child.type}`);
    }
  }
  return out;
}

function normCmList(list: CmNode, budget: { left: number }): Norm {
  const ordered = list.listType === 'ordered';
  return {
    t: ordered ? 'ol' : 'ul',
    v: ordered ? list.listStart : 1,
    c: childrenOf(list).map((item) => ({
      t: 'li',
      c: normCmBlocks(item, budget),
    })),
  };
}

const reference = new Parser();
const referenceTree = (body: string): Norm[] =>
  normCmBlocks(reference.parse(body), { left: TOUR_MARKDOWN_MAX_PICTURES });
const ourTree = (body: string): Norm[] =>
  normOurBlocks(parseTourMarkdown(body).blocks);

type Nesting = 'quote' | 'list' | 'emphasis';

/** The node types whose nesting the subset limits, by limit. */
const NESTING_OF: Readonly<Partial<Record<string, Nesting>>> = {
  block_quote: 'quote',
  list: 'list',
  emph: 'emphasis',
  strong: 'emphasis',
};

/** Whether the reference read `body` with nothing outside the subset:
 *  no node kind the subset lacks, no heading deeper than 3 or written as a
 *  setext heading (two source lines), no nested quote, no third list
 *  level, no `)` list, no link title, no reference definition, no link the
 *  link check refuses, and emphasis nested at most 16 deep. */
function referenceStaysInSubset(body: string): boolean {
  const parser = new Parser();
  const doc = parser.parse(body);
  const refmap = (parser as unknown as { refmap: Record<string, unknown> })
    .refmap;
  if (Object.keys(refmap).length > 0) return false;
  const walker = doc.walker();
  const depth: Record<Nesting, number> = { quote: 0, list: 0, emphasis: 0 };
  for (let event = walker.next(); event !== null; event = walker.next()) {
    const { node, entering } = event;
    const nesting = NESTING_OF[node.type];
    if (nesting !== undefined) depth[nesting] += entering ? 1 : -1;
    if (entering && !nodeInSubset(node)) return false;
    if (depth.quote > 1 || depth.list > 2 || depth.emphasis > 16) return false;
  }
  return true;
}

const SUBSET_NODES = new Set([
  'document',
  'paragraph',
  'heading',
  'block_quote',
  'list',
  'item',
  'text',
  'softbreak',
  'linebreak',
  'emph',
  'strong',
  'link',
  'image',
]);

function nodeInSubset(node: CmNode): boolean {
  if (!SUBSET_NODES.has(node.type)) return false;
  const pos = node.sourcepos;
  if (node.type === 'heading')
    return node.level <= 3 && pos[0][0] === pos[1][0];
  if (node.type === 'list') return node.listDelimiter !== ')';
  if (node.type === 'image') return node.title === '';
  return node.type !== 'link' || linkInSubset(node);
}

function linkInSubset(node: CmNode): boolean {
  try {
    const url = new URL(node.destination ?? '');
    return (
      node.title === '' &&
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

/** The one place the reference departs from the spec inside the subset:
 *  commonmark.js 0.31.2 classifies the character beside a `*` or `_` run
 *  by one UTF-16 unit, so a punctuation or symbol character outside the
 *  BMP (an emoji) is neither punctuation nor whitespace to it, where the
 *  spec reads code points. A unit test pins the spec's reading; the
 *  differential skips every body with a character outside the BMP right
 *  beside a `*` or `_`. */
const ASTRAL_BESIDE_DELIMITER =
  /[*_][\u{10000}-\u{10FFFF}]|[\u{10000}-\u{10FFFF}][*_]/u;

/** Arbitrary strings over pieces the subset reads (and a few it rejects,
 *  which the filter above then drops). */
function wildBodyOf(maxLength: number): fc.Arbitrary<string> {
  return fc
    .array(
      fc.constantFrom(
        'a',
        'b',
        'xy',
        ' ',
        ' ',
        '  ',
        '\t',
        '\n',
        '\n',
        '\n\n',
        '*',
        '**',
        '_',
        '__',
        '- ',
        '* ',
        '1. ',
        '3. ',
        '# ',
        '## ',
        '### ',
        '#### ',
        '> ',
        '>',
        '[',
        ']',
        '(',
        ')',
        '](https://x.org/a)',
        '](http://x.org)',
        '![',
        '](asset:x)',
        '\\',
        '\\\n',
        '  \n',
        '.',
        ',',
        '!',
        '#',
        '-',
        '    ',
        '😀',
        'é',
        '中'
      ),
      { maxLength }
    )
    .map((pieces) => pieces.join(''));
}
const wildBody = wildBodyOf(60);

// ---------------------------------------------------------------------------
// Bodies inside the subset, generated as a model and rendered to Markdown

type Token = string;

const letters = fc.constantFrom(
  'a',
  'b',
  'k',
  'q',
  'z',
  'A',
  'M',
  'x1',
  'é',
  'ß',
  'ü',
  'ø',
  'ñ',
  'e\u0301', // a combining mark
  '😀',
  '𝒜', // surrogate pairs
  '中',
  'я',
  'a\u00A0b' // CJK, Cyrillic, a no-break space inside a word
);
const word: fc.Arbitrary<Token> = fc
  .tuple(
    fc.array(letters, { minLength: 1, maxLength: 4 }),
    fc.constantFrom('', '', '', ',', '.', ';', ':', '?', '!', ')', "'")
  )
  .map(([parts, end]) => parts.join('') + end);
const escape: fc.Arbitrary<Token> = fc.constantFrom(
  '\\*',
  '\\_',
  '\\[',
  '\\]',
  '\\#',
  '\\\\',
  '\\!',
  '\\(',
  '\\)',
  '\\>',
  '\\-'
);
const host = fc.constantFrom(
  'example.org',
  'archive.example',
  'bücher.example',
  'a-b.example'
);
const path = fc.constantFrom(
  '',
  '/',
  '/a',
  '/a_b/c-d',
  '/wiki/A_(b)',
  '/x?y=1',
  '/p#f'
);
const url = fc.tuple(host, path).map(([h, p]) => `https://${h}${p}`);
const assetId = fc.constantFrom('tree_1', 'a', 'mill-2', 'X9');

function joinTokens(tokens: readonly Token[]): string {
  return tokens.join(' ');
}

/** Emphasis whose content starts and ends with a word, so a nested span
 *  never touches its parent's delimiters (`****` would be one run, which
 *  is no longer the emphasis the model meant). */
const emphasisTokens: fc.Arbitrary<Token> = fc.letrec<{ span: Token }>(
  (tie) => ({
    span: fc
      .tuple(
        fc.constantFrom('*', '_', '**', '__'),
        word,
        fc.array(
          fc.oneof(
            { weight: 3, arbitrary: word },
            { weight: 1, arbitrary: tie('span') }
          ),
          { maxLength: 2 }
        ),
        word
      )
      .map(([d, first, middle, last]) =>
        middle.length === 0
          ? `${d}${first}${d}`
          : `${d}${joinTokens([first, ...middle, last])}${d}`
      ),
  })
).span;

const linkToken: fc.Arbitrary<Token> = fc
  .tuple(
    fc.array(fc.oneof({ weight: 3, arbitrary: word }, emphasisTokens), {
      minLength: 1,
      maxLength: 3,
    }),
    url
  )
  .map(([text, target]) => `[${joinTokens(text)}](${target})`);

const inlinePicture: fc.Arbitrary<Token> = fc
  .tuple(
    fc.array(word, { minLength: 1, maxLength: 2 }),
    fc.oneof(
      assetId.map((id) => `asset:${id}`),
      fc.constant('https://example.org/p.png')
    )
  )
  .map(([alt, target]) => `![${joinTokens(alt)}](${target})`);

const token: fc.Arbitrary<Token> = fc.oneof(
  { weight: 8, arbitrary: word },
  { weight: 2, arbitrary: escape },
  { weight: 3, arbitrary: emphasisTokens },
  { weight: 2, arbitrary: linkToken },
  { weight: 1, arbitrary: inlinePicture }
);

/** A line of inline content; never starts with something a block reads. */
const line = fc
  .tuple(word, fc.array(token, { minLength: 0, maxLength: 5 }))
  .map(([first, rest]) => joinTokens([first, ...rest]));
const lineEnd = fc.constantFrom('\n', '\n', '\n', '\\\n', '  \n');

interface ModelHeading {
  readonly kind: 'heading';
  readonly level: number;
  readonly text: string;
  readonly closing: boolean;
}
type ModelBlock =
  | {
      readonly kind: 'paragraph';
      readonly lines: readonly string[];
      readonly ends: readonly string[];
    }
  | ModelHeading
  | { readonly kind: 'pictures'; readonly lines: readonly string[] }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly bullet: string;
      readonly start: number;
      readonly loose: boolean;
      readonly items: readonly (readonly ModelBlock[])[];
    }
  | { readonly kind: 'quote'; readonly blocks: readonly ModelBlock[] };

const paragraph: fc.Arbitrary<ModelBlock> = fc
  .tuple(
    fc.array(line, { minLength: 1, maxLength: 3 }),
    fc.array(lineEnd, { minLength: 2, maxLength: 2 })
  )
  .map(([lines, ends]) => ({ kind: 'paragraph', lines, ends }));
const heading: fc.Arbitrary<ModelBlock> = fc
  .tuple(fc.integer({ min: 1, max: 3 }), line, fc.boolean())
  .map(([level, text, closing]) => ({ kind: 'heading', level, text, closing }));
const pictures: fc.Arbitrary<ModelBlock> = fc
  .array(
    fc
      .tuple(fc.array(word, { minLength: 1, maxLength: 2 }), assetId)
      .map(([alt, id]) => `![${joinTokens(alt)}](asset:${id})`),
    { minLength: 1, maxLength: 2 }
  )
  .map((lines) => ({ kind: 'pictures', lines }));

function blocksAt(
  listDepth: number,
  inQuote: boolean
): fc.Arbitrary<ModelBlock[]> {
  const leaf = fc.oneof({ weight: 5, arbitrary: paragraph }, heading, pictures);
  const options: fc.Arbitrary<ModelBlock>[] = [leaf];
  if (listDepth < 2) options.push(listAt(listDepth + 1, inQuote));
  if (!inQuote) {
    options.push(
      fc
        .constant(null)
        .chain(() => blocksAt(listDepth, true))
        .map((blocks) => ({ kind: 'quote', blocks }))
    );
  }
  return fc.array(fc.oneof({ weight: 4, arbitrary: leaf }, ...options), {
    minLength: 1,
    maxLength: listDepth === 0 && !inQuote ? 4 : 2,
  });
}

function listAt(depth: number, inQuote: boolean): fc.Arbitrary<ModelBlock> {
  return fc
    .tuple(
      fc.boolean(),
      fc.constantFrom('-', '*'),
      fc.integer({ min: 0, max: 120 }),
      fc.boolean(),
      fc.array(
        fc.constant(null).chain(() => blocksAt(depth, inQuote)),
        { minLength: 1, maxLength: 3 }
      )
    )
    .map(([ordered, bullet, start, loose, items]) => ({
      kind: 'list',
      ordered,
      bullet,
      start,
      loose,
      items,
    }));
}

function renderBlock(block: ModelBlock): string[] {
  switch (block.kind) {
    case 'paragraph': {
      const out: string[] = [];
      block.lines.forEach((text, i) => {
        const end = i < block.lines.length - 1 ? (block.ends[i] ?? '\n') : '';
        out.push(text + end.slice(0, -1));
      });
      return out;
    }
    case 'heading':
      return [
        `${'#'.repeat(block.level)} ${block.text}${block.closing ? ' ##' : ''}`,
      ];
    case 'pictures':
      return [...block.lines];
    case 'quote':
      return renderBlocks(block.blocks).map((l) => (l === '' ? '>' : `> ${l}`));
    default: {
      const out: string[] = [];
      block.items.forEach((item, i) => {
        if (i > 0 && block.loose) out.push('');
        const marker = block.ordered ? `${block.start + i}.` : block.bullet;
        const pad = ' '.repeat(marker.length + 1);
        renderBlocks(item).forEach((l, j) => {
          if (j === 0) out.push(`${marker} ${l}`);
          else out.push(l === '' ? '' : `${pad}${l}`);
        });
      });
      return out;
    }
  }
}

function renderBlocks(blocks: readonly ModelBlock[]): string[] {
  const out: string[] = [];
  blocks.forEach((block, i) => {
    if (i > 0) out.push('');
    out.push(...renderBlock(block));
  });
  return out;
}

const subsetBody = blocksAt(0, false).map((blocks) => ({
  blocks,
  body: renderBlocks(blocks).join('\n'),
}));

// ---------------------------------------------------------------------------

describe('tour markdown (properties)', () => {
  it('reads every generated body inside the subset as the CommonMark reference does', () => {
    fc.assert(
      fc.property(subsetBody, ({ body }) => {
        expect(ourTree(body)).toEqual(referenceTree(body));
      }),
      { numRuns: 3000 }
    );
  });

  it('reads arbitrary strings the reference keeps inside the subset as the reference does', () => {
    fc.assert(
      fc.property(wildBody, (body) => {
        fc.pre(referenceStaysInSubset(body));
        fc.pre(!ASTRAL_BESIDE_DELIMITER.test(body));
        expect(ourTree(body)).toEqual(referenceTree(body));
      }),
      { numRuns: 3000, maxSkipsPerRun: 1000 }
    );
  });

  it('never throws on arbitrary strings, and P keeps its invariants', () => {
    // The invariant helper asserts; the parse itself must not throw.
    expect.hasAssertions();
    const markdownish = fc.string({
      unit: fc.constantFrom(
        ...'#*_-+>[]()!\\`<&.:1 \t\n\raz'.split(''),
        '\u0000',
        '😀',
        'e\u0301',
        '\u00A0'
      ),
      maxLength: 400,
    });
    fc.assert(
      fc.property(
        fc.oneof(markdownish, fc.string({ unit: 'binary', maxLength: 400 })),
        (body) => {
          assertPlainTextInvariants(parseTourMarkdown(body));
        }
      ),
      { numRuns: 3000 }
    );
  });

  it('reads bodies up to a megabyte built from repeated arbitrary chunks', () => {
    // The invariant helper asserts; the parse itself must not throw.
    expect.hasAssertions();
    fc.assert(
      fc.property(
        fc.string({
          unit: fc.constantFrom(...'#*_-+>[]()!\\ \n.1az'.split('')),
          minLength: 1,
          maxLength: 24,
        }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (chunk, size) => {
          const body = chunk.repeat(Math.ceil(size / chunk.length));
          assertPlainTextInvariants(parseTourMarkdown(body));
        }
      ),
      { numRuns: 12 }
    );
  });

  it('keeps P when emphasis is removed and heading levels change', () => {
    fc.assert(
      fc.property(subsetBody, ({ blocks }) => {
        const plain = (b: readonly ModelBlock[]) =>
          plainTextOf(parseTourMarkdown(renderBlocks(b).join('\n'))).text;
        expect(plain(withoutFormatting(blocks))).toBe(plain(blocks));
      }),
      { numRuns: 1500 }
    );
  });

  it('gives escapeTourMarkdown(t) a P equal to the normalised t', () => {
    const text = fc.oneof(
      fc.string({
        unit: fc.constantFrom(
          ...'#*_-+>[]()!\\`<&.:1 \t\n\raz'.split(''),
          '😀',
          '\u00A0'
        ),
        maxLength: 200,
      }),
      fc.string({ unit: 'grapheme', maxLength: 200 })
    );
    fc.assert(
      fc.property(text, (t) => {
        expect(plainTextOf(parseTourMarkdown(escapeTourMarkdown(t))).text).toBe(
          normalisedPlainText(t)
        );
      }),
      { numRuns: 3000 }
    );
  });
});

/** Drops every emphasis marker and moves each heading to another level. */
function withoutFormatting(blocks: readonly ModelBlock[]): ModelBlock[] {
  const strip = (text: string) => text.replace(/(?<!\\)(\*\*|__|\*|_)/g, '');
  return blocks.map((block): ModelBlock => {
    switch (block.kind) {
      case 'paragraph':
        return { ...block, lines: block.lines.map(strip) };
      case 'heading':
        return {
          ...block,
          level: (block.level % 3) + 1,
          text: strip(block.text),
        };
      case 'quote':
        return { ...block, blocks: withoutFormatting(block.blocks) };
      case 'list':
        return { ...block, items: block.items.map(withoutFormatting) };
      default:
        return block;
    }
  });
}

/** What P makes of plain text: NUL as U+FFFD, lines split at any line
 *  ending and trimmed of spaces and tabs, a line break kept, runs of empty
 *  lines as one paragraph break, nothing before the first or after the
 *  last line. Written apart from the escaper it checks. */
function normalisedPlainText(t: string): string {
  const lines = t
    .split(String.fromCharCode(0))
    .join('\uFFFD')
    .split(/\r\n|\n|\r/)
    .map((l) => l.replace(/^[ \t]+|[ \t]+$/g, ''));
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const l of lines) {
    if (l !== '') current.push(l);
    else if (current.length > 0) {
      paragraphs.push(current.join('\n'));
      current = [];
    }
  }
  if (current.length > 0) paragraphs.push(current.join('\n'));
  return paragraphs.join('\n\n');
}

function assertPlainTextInvariants(doc: TourMarkdown): void {
  const { text, leaves } = plainTextOf(doc);
  expect(text).not.toMatch(/^[ \t\n]|[ \t\n]$/);
  let expectedFrom = 0;
  leaves.forEach((leaf, i) => {
    // Leaves tile P: each starts where the previous one's separator ends.
    expect(leaf.from).toBe(expectedFrom);
    expect(leaf.to).toBeGreaterThan(leaf.from);
    const own = text.slice(leaf.from, leaf.to);
    expect(own).not.toMatch(/^[ \t\n]|[ \t\n]$/);
    if (i < leaves.length - 1)
      expect(text.slice(leaf.to, leaf.to + 2)).toBe('\n\n');
    expectedFrom = leaf.to + 2;
  });
  // The last leaf ends P; no leaf, no P.
  expect(text.length).toBe(leaves[leaves.length - 1]?.to ?? 0);
}
