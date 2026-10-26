/**
 * A long text's body: a small Markdown subset, read into a tree; the plain
 * text `P` a narrator reads, with the range each paragraph or heading
 * covers in it; and the hash that tells a read-along timing whether it
 * still fits `P`.
 *
 * Accepted (CommonMark meaning): paragraphs with soft and hard breaks (a
 * backslash or two spaces at the line end), `#` to `###` headings, `-` and
 * `*` bullet lists and `1.` ordered lists nested two levels deep by
 * indentation, one level of `>` quotes, `*em*` / `_em_`, `**strong**` /
 * `__strong__`, `[text](https://...)` links, `![alt](asset:<id>)` pictures
 * on lines of their own, and backslash escapes of ASCII punctuation.
 *
 * Everything else is shown as the characters typed: raw HTML, code spans
 * and code blocks, setext headings, thematic breaks, tables, entity
 * references, autolinks, reference links, deeper headings, lists and
 * quotes, and pictures inside a paragraph or with any other target (their
 * alt text is kept, as a box). A link whose target fails
 * {@link checkTourLink} keeps its text and loses the link. Nothing is ever
 * a failure: any string reads, in time linear in its length.
 *
 * The parser follows the CommonMark reference implementation's block and
 * inline algorithms, restricted to the subset, so the two agree inside it
 * (a property test holds them to that). Pure: no DOM, no I/O; the hash is
 * the only asynchronous part.
 *
 * @see tour-markdown.ts.md
 */

import { sha256Hex } from '../utils/sha256-hex.js';
import { TOUR_ID_PATTERN } from './tour-archive.js';

// ---------------------------------------------------------------------------
// Public types

/** An inline piece of a paragraph or a heading. */
export type TourMdInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'emphasis'; readonly children: readonly TourMdInline[] }
  | { readonly kind: 'strong'; readonly children: readonly TourMdInline[] }
  | {
      readonly kind: 'link';
      /** The target as the URL parser reads it. */
      readonly href: string;
      /** The target's host in its ASCII form (`xn--...` for an
       *  internationalised one), to show beside the link text. */
      readonly host: string;
      readonly children: readonly TourMdInline[];
    }
  | { readonly kind: 'softBreak' }
  | { readonly kind: 'hardBreak' }
  /** A picture that cannot show where it stands: its alt text, in a box. */
  | { readonly kind: 'pictureAlt'; readonly alt: string };

export interface TourMdParagraph {
  readonly kind: 'paragraph';
  readonly inlines: readonly TourMdInline[];
}

export interface TourMdHeading {
  readonly kind: 'heading';
  readonly level: 1 | 2 | 3;
  readonly inlines: readonly TourMdInline[];
}

export interface TourMdList {
  readonly kind: 'list';
  readonly ordered: boolean;
  /** The first item's number; 1 for a bullet list. */
  readonly start: number;
  /** Each item's blocks (an empty item has none). */
  readonly items: readonly (readonly TourMdBlock[])[];
}

export interface TourMdQuote {
  readonly kind: 'quote';
  readonly blocks: readonly TourMdBlock[];
}

/** A picture on a line of its own, naming one of the tour's assets. */
export interface TourMdPicture {
  readonly kind: 'picture';
  readonly alt: string;
  readonly asset: string;
}

export type TourMdBlock =
  TourMdParagraph | TourMdHeading | TourMdList | TourMdQuote | TourMdPicture;

export interface TourMarkdown {
  readonly blocks: readonly TourMdBlock[];
}

/** A paragraph or heading of the tree and the range `[from, to)` of `P`,
 *  in UTF-16 code units, that its text covers. */
export interface TourMdLeaf {
  readonly block: TourMdParagraph | TourMdHeading;
  readonly from: number;
  readonly to: number;
}

export interface TourPlainText {
  /** `P`: the leaves' texts joined with a blank line. */
  readonly text: string;
  /** Every non-empty leaf, in document order. */
  readonly leaves: readonly TourMdLeaf[];
}

export type TourLinkCheck =
  | { readonly ok: true; readonly href: string; readonly host: string }
  | { readonly ok: false };

/** The most pictures a body shows; later ones show their alt text. */
export const TOUR_MARKDOWN_MAX_PICTURES = 20;

/** Emphasis nested deeper than this is read as its content: no one writes
 *  it, and it keeps every walk over the tree shallow. `P` is unaffected,
 *  since emphasis never changes `P`. */
const MAX_EMPHASIS_DEPTH = 16;

const PICTURE_TARGET_PREFIX = 'asset:';

/** Iterations of every loop that walks the parser's own stacks, lists and
 *  trees (rather than moving forward through the body), of the line scans
 *  the block parser may repeat on one line, plus one per inline parse
 *  step. A linear reading keeps it proportional to the body's length;
 *  {@link __tourMarkdownWalkStepsForTests} reads it. */
let walkSteps = 0;

// ---------------------------------------------------------------------------
// Characters

const C_TAB = 9;
const C_NEWLINE = 10;
const C_SPACE = 32;
const C_BANG = 33;
const C_HASH = 35;
const C_OPEN_PAREN = 40;
const C_CLOSE_PAREN = 41;
const C_ASTERISK = 42;
const C_DASH = 45;
const C_DOT = 46;
const C_GREATER = 62;
const C_LESS = 60;
const C_OPEN_BRACKET = 91;
const C_BACKSLASH = 92;
const C_CLOSE_BRACKET = 93;
const C_UNDERSCORE = 95;
const C_DELETE = 127;

const ASCII_PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const UNICODE_SPACE = /^\p{Zs}$/u;
const UNICODE_PUNCTUATION = /^[\p{P}\p{S}]$/u;

function isAsciiPunctuation(code: number): boolean {
  return code < 128 && ASCII_PUNCTUATION.includes(String.fromCharCode(code));
}

function isSpaceOrTab(code: number): boolean {
  return code === C_SPACE || code === C_TAB;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** CommonMark's Unicode whitespace: Zs, tab, line feed, form feed, CR. */
function isUnicodeWhitespace(cp: number): boolean {
  if (cp === C_TAB || cp === C_NEWLINE || cp === 12 || cp === 13) return true;
  return UNICODE_SPACE.test(String.fromCodePoint(cp));
}

/** CommonMark's Unicode punctuation: ASCII punctuation, P and S. */
function isUnicodePunctuation(cp: number): boolean {
  if (cp < 128) return isAsciiPunctuation(cp);
  return UNICODE_PUNCTUATION.test(String.fromCodePoint(cp));
}

/** The code point starting at `at`, or a line end past the string. */
function codePointFrom(s: string, at: number): number {
  return at < s.length ? (s.codePointAt(at) ?? C_NEWLINE) : C_NEWLINE;
}

/** The code point ending just before `at` (a pair counts as one), or a
 *  line end at the start. */
function codePointBefore(s: string, at: number): number {
  if (at === 0) return C_NEWLINE;
  const low = s.charCodeAt(at - 1);
  if (at >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = s.charCodeAt(at - 2);
    if (high >= 0xd800 && high <= 0xdbff) return s.codePointAt(at - 2) ?? low;
  }
  return low;
}

/** `s` without spaces and tabs at either end. */
function trimSpacesAndTabs(s: string): string {
  let from = 0;
  let to = s.length;
  while (from < to && isSpaceOrTab(s.charCodeAt(from))) from++;
  while (to > from && isSpaceOrTab(s.charCodeAt(to - 1))) to--;
  return s.slice(from, to);
}

/** The lines of `body`, split at CRLF, LF and CR; a final line ending
 *  opens no further line. */
function splitLines(body: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    if (c !== C_NEWLINE && c !== 13) continue;
    lines.push(body.slice(start, i));
    if (c === 13 && body.charCodeAt(i + 1) === C_NEWLINE) i++;
    start = i + 1;
  }
  if (start < body.length || !body.endsWith('\n')) {
    lines.push(body.slice(start));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Block structure (CommonMark's line-by-line container algorithm)

type BlockType =
  'document' | 'quote' | 'list' | 'item' | 'paragraph' | 'heading';

interface ListMarker {
  readonly ordered: boolean;
  /** The bullet's character code; 0 for an ordered marker. */
  readonly bullet: number;
  readonly start: number;
  readonly width: number;
}

interface ListData extends ListMarker {
  readonly markerOffset: number;
  readonly padding: number;
}

interface BlockNode {
  readonly type: BlockType;
  readonly parent: BlockNode | null;
  readonly children: BlockNode[];
  open: boolean;
  /** A paragraph's lines, or a heading's one line of content. */
  readonly lines: string[];
  level: number;
  list: ListData | null;
}

interface BlockParser {
  readonly doc: BlockNode;
  tip: BlockNode | null;
  oldTip: BlockNode;
  lastMatched: BlockNode;
  allClosed: boolean;
  line: string;
  offset: number;
  column: number;
  nextNonspace: number;
  nextNonspaceColumn: number;
  indent: number;
  blank: boolean;
}

function newBlock(type: BlockType, parent: BlockNode | null): BlockNode {
  return {
    type,
    parent,
    children: [],
    open: true,
    lines: [],
    level: 0,
    list: null,
  };
}

function tipOf(bp: BlockParser): BlockNode {
  return bp.tip ?? bp.doc;
}

function peekAt(bp: BlockParser, at: number): number {
  return at < bp.line.length ? bp.line.charCodeAt(at) : -1;
}

function findNextNonspace(bp: BlockParser): void {
  let i = bp.offset;
  let cols = bp.column;
  while (i < bp.line.length) {
    walkSteps++;
    const c = bp.line.charCodeAt(i);
    if (c === C_SPACE) cols++;
    else if (c === C_TAB) cols += 4 - (cols % 4);
    else break;
    i++;
  }
  bp.blank = i >= bp.line.length;
  bp.nextNonspace = i;
  bp.nextNonspaceColumn = cols;
  bp.indent = cols - bp.column;
}

/** Advances by `count` characters, or by `count` columns when `columns`
 *  (a tab then counts to the next tab stop and may be consumed in part). */
function advanceOffset(bp: BlockParser, count: number, columns: boolean): void {
  let left = count;
  while (left > 0 && bp.offset < bp.line.length) {
    if (bp.line.charCodeAt(bp.offset) !== C_TAB) {
      bp.offset++;
      bp.column++;
      left--;
      continue;
    }
    const toTab = 4 - (bp.column % 4);
    if (!columns) {
      bp.column += toTab;
      bp.offset++;
      left--;
    } else {
      const step = Math.min(toTab, left);
      bp.column += step;
      if (step === toTab) bp.offset++;
      left -= step;
    }
  }
}

function advanceNextNonspace(bp: BlockParser): void {
  bp.offset = bp.nextNonspace;
  bp.column = bp.nextNonspaceColumn;
}

function canContain(parent: BlockType, child: BlockType): boolean {
  if (parent === 'list') return child === 'item';
  if (parent === 'paragraph' || parent === 'heading') return false;
  return child !== 'item';
}

function finalize(bp: BlockParser, node: BlockNode): void {
  node.open = false;
  bp.tip = node.parent;
}

function addChild(bp: BlockParser, type: BlockType): BlockNode {
  let tip = tipOf(bp);
  while (!canContain(tip.type, type)) {
    walkSteps++;
    finalize(bp, tip);
    tip = tipOf(bp);
  }
  const node = newBlock(type, tip);
  tip.children.push(node);
  bp.tip = node;
  return node;
}

function closeUnmatchedBlocks(bp: BlockParser): void {
  if (bp.allClosed) return;
  while (bp.oldTip !== bp.lastMatched) {
    walkSteps++;
    const parent = bp.oldTip.parent ?? bp.doc;
    finalize(bp, bp.oldTip);
    bp.oldTip = parent;
  }
  bp.allClosed = true;
}

function continuesQuote(bp: BlockParser): boolean {
  if (bp.indent >= 4 || peekAt(bp, bp.nextNonspace) !== C_GREATER) {
    return false;
  }
  advanceNextNonspace(bp);
  advanceOffset(bp, 1, false);
  if (isSpaceOrTab(peekAt(bp, bp.offset))) advanceOffset(bp, 1, true);
  return true;
}

function continuesItem(bp: BlockParser, item: BlockNode): boolean {
  const list = item.list;
  if (list === null) return false;
  if (bp.blank) {
    if (item.children.length === 0) return false;
    advanceNextNonspace(bp);
    return true;
  }
  const contentColumn = list.markerOffset + list.padding;
  if (bp.indent < contentColumn) return false;
  advanceOffset(bp, contentColumn, true);
  return true;
}

/** Whether `node`, open from an earlier line, continues on this one
 *  (consuming its marker or indentation when it does). */
function continues(bp: BlockParser, node: BlockNode): boolean {
  switch (node.type) {
    case 'quote':
      return continuesQuote(bp);
    case 'item':
      return continuesItem(bp, node);
    case 'paragraph':
      return !bp.blank;
    case 'heading':
      return false;
    default:
      return true;
  }
}

function countAncestors(node: BlockNode, type: BlockType): number {
  let count = 0;
  for (let n: BlockNode | null = node; n !== null; n = n.parent) {
    walkSteps++;
    if (n.type === type) count++;
  }
  return count;
}

function startQuote(bp: BlockParser, container: BlockNode): boolean {
  // One level of quotes: a further `>` is shown as typed.
  if (countAncestors(container, 'quote') >= 1) return false;
  advanceNextNonspace(bp);
  advanceOffset(bp, 1, false);
  if (isSpaceOrTab(peekAt(bp, bp.offset))) advanceOffset(bp, 1, true);
  closeUnmatchedBlocks(bp);
  addChild(bp, 'quote');
  return true;
}

/** A heading's content without a closing `#` sequence (one preceded by a
 *  space or tab, or making up the whole content). */
function withoutClosingHashes(content: string): string {
  let end = content.length;
  while (end > 0 && isSpaceOrTab(content.charCodeAt(end - 1))) end--;
  let hashes = end;
  while (hashes > 0 && content.charCodeAt(hashes - 1) === C_HASH) hashes--;
  if (hashes === end) return content;
  let before = hashes;
  while (before > 0 && isSpaceOrTab(content.charCodeAt(before - 1))) before--;
  if (before === 0) return '';
  return before < hashes ? content.slice(0, before) : content;
}

function startHeading(bp: BlockParser): boolean {
  let at = bp.nextNonspace;
  while (at < bp.line.length && bp.line.charCodeAt(at) === C_HASH) at++;
  const level = at - bp.nextNonspace;
  const next = peekAt(bp, at);
  // Levels 4 to 6 are shown as typed, as is a `#` run with no space after.
  if (level > 3 || (next !== -1 && !isSpaceOrTab(next))) return false;
  while (isSpaceOrTab(peekAt(bp, at))) at++;
  advanceNextNonspace(bp);
  advanceOffset(bp, at - bp.nextNonspace, false);
  closeUnmatchedBlocks(bp);
  const heading = addChild(bp, 'heading');
  heading.level = level;
  heading.lines.push(withoutClosingHashes(bp.line.slice(bp.offset)));
  bp.offset = bp.line.length;
  return true;
}

/** A thematic break line (three or more `-` or `*` with only spaces and
 *  tabs between): shown as typed, and never a list item. */
function isThematicBreak(bp: BlockParser): boolean {
  const marker = bp.line.charCodeAt(bp.nextNonspace);
  let count = 0;
  for (let i = bp.nextNonspace; i < bp.line.length; i++) {
    walkSteps++;
    const c = bp.line.charCodeAt(i);
    if (c === marker) count++;
    else if (!isSpaceOrTab(c)) return false;
  }
  return count >= 3;
}

function orderedMarker(
  bp: BlockParser,
  container: BlockNode
): ListMarker | null {
  let at = bp.nextNonspace;
  while (at < bp.line.length && isDigit(bp.line.charCodeAt(at))) {
    walkSteps++;
    at++;
  }
  const digits = at - bp.nextNonspace;
  if (digits > 9 || bp.line.charCodeAt(at) !== C_DOT) return null;
  const start = Number(bp.line.slice(bp.nextNonspace, at));
  // Only an item numbered 1 may interrupt a paragraph.
  if (container.type === 'paragraph' && start !== 1) return null;
  return { ordered: true, bullet: 0, start, width: digits + 1 };
}

function listMarker(bp: BlockParser, container: BlockNode): ListMarker | null {
  const c = bp.line.charCodeAt(bp.nextNonspace);
  const marker =
    c === C_DASH || c === C_ASTERISK
      ? { ordered: false, bullet: c, start: 1, width: 1 }
      : isDigit(c)
        ? orderedMarker(bp, container)
        : null;
  if (marker === null) return null;
  const after = bp.nextNonspace + marker.width;
  const next = peekAt(bp, after);
  if (next !== -1 && !isSpaceOrTab(next)) return null;
  // An empty item may not interrupt a paragraph.
  if (container.type === 'paragraph' && isBlankFrom(bp.line, after)) {
    return null;
  }
  return marker;
}

function isBlankFrom(line: string, at: number): boolean {
  for (let i = at; i < line.length; i++) {
    walkSteps++;
    if (!isSpaceOrTab(line.charCodeAt(i))) return false;
  }
  return true;
}

function sameList(list: ListData | null, marker: ListMarker): boolean {
  return (
    list !== null &&
    list.ordered === marker.ordered &&
    list.bullet === marker.bullet
  );
}

/** Consumes the marker and the spaces after it; the item's padding (its
 *  content column relative to the marker). */
function consumeListMarker(bp: BlockParser, marker: ListMarker): number {
  advanceNextNonspace(bp);
  advanceOffset(bp, marker.width, true);
  const spacesStartColumn = bp.column;
  const spacesStartOffset = bp.offset;
  do {
    advanceOffset(bp, 1, true);
  } while (
    bp.column - spacesStartColumn < 5 &&
    isSpaceOrTab(peekAt(bp, bp.offset))
  );
  const blankItem = peekAt(bp, bp.offset) === -1;
  const spaces = bp.column - spacesStartColumn;
  if (spaces >= 1 && spaces < 5 && !blankItem) return marker.width + spaces;
  bp.column = spacesStartColumn;
  bp.offset = spacesStartOffset;
  if (isSpaceOrTab(peekAt(bp, bp.offset))) advanceOffset(bp, 1, true);
  return marker.width + 1;
}

/** The block a new list opened at `container` lands in: the first that can
 *  hold one (a list of another kind, a paragraph or a heading is closed
 *  first). */
function listParentOf(container: BlockNode): BlockNode {
  let parent = container;
  while (!canContain(parent.type, 'list') && parent.parent !== null) {
    walkSteps++;
    parent = parent.parent;
  }
  return parent;
}

function startListItem(bp: BlockParser, container: BlockNode): boolean {
  const marker = listMarker(bp, container);
  if (marker === null) return false;
  const joins = container.type === 'list' && sameList(container.list, marker);
  const depth = joins
    ? countAncestors(container, 'list')
    : countAncestors(listParentOf(container), 'list') + 1;
  // Two list levels: a deeper marker is shown as typed.
  if (depth > 2) return false;
  const markerOffset = bp.indent;
  const padding = consumeListMarker(bp, marker);
  const data: ListData = { ...marker, markerOffset, padding };
  closeUnmatchedBlocks(bp);
  if (!joins) addChild(bp, 'list').list = data;
  addChild(bp, 'item').list = data;
  return true;
}

type BlockStart = 'none' | 'container' | 'leaf';

/** Tries to open a block at the line's next non-space character. */
function tryBlockStart(bp: BlockParser, container: BlockNode): BlockStart {
  // Four columns of indentation start nothing (CommonMark's indented code,
  // shown here as a paragraph).
  if (bp.indent >= 4) return 'none';
  const c = bp.line.charCodeAt(bp.nextNonspace);
  if (c === C_GREATER) return startQuote(bp, container) ? 'container' : 'none';
  if (c === C_HASH) return startHeading(bp) ? 'leaf' : 'none';
  if ((c === C_DASH || c === C_ASTERISK) && isThematicBreak(bp)) return 'none';
  return startListItem(bp, container) ? 'container' : 'none';
}

function lastOpenChild(node: BlockNode): BlockNode | null {
  const last = node.children[node.children.length - 1];
  return last !== undefined && last.open ? last : null;
}

function matchContainers(bp: BlockParser): BlockNode {
  let container = bp.doc;
  for (;;) {
    walkSteps++;
    const child = lastOpenChild(container);
    if (child === null) return container;
    findNextNonspace(bp);
    if (!continues(bp, child)) return container;
    container = child;
  }
}

function openNewBlocks(bp: BlockParser, matched: BlockNode): BlockNode {
  let container = matched;
  for (;;) {
    walkSteps++;
    findNextNonspace(bp);
    const start = bp.blank ? 'none' : tryBlockStart(bp, container);
    if (start === 'none') {
      advanceNextNonspace(bp);
      return container;
    }
    container = tipOf(bp);
    if (start === 'leaf') return container;
  }
}

function addLine(bp: BlockParser): void {
  tipOf(bp).lines.push(bp.line.slice(bp.offset));
}

function addLineText(bp: BlockParser, container: BlockNode): void {
  if (!bp.allClosed && !bp.blank && tipOf(bp).type === 'paragraph') {
    addLine(bp); // a lazy continuation line
    return;
  }
  closeUnmatchedBlocks(bp);
  if (container.type === 'paragraph') {
    addLine(bp);
  } else if (bp.offset < bp.line.length && !bp.blank) {
    addChild(bp, 'paragraph');
    advanceNextNonspace(bp);
    addLine(bp);
  }
}

function incorporateLine(bp: BlockParser, raw: string): void {
  bp.line = raw.includes('\u0000') ? raw.replaceAll('\u0000', '\uFFFD') : raw;
  bp.offset = 0;
  bp.column = 0;
  bp.blank = false;
  bp.oldTip = tipOf(bp);
  const matched = matchContainers(bp);
  bp.allClosed = matched === bp.oldTip;
  bp.lastMatched = matched;
  addLineText(bp, openNewBlocks(bp, matched));
}

function parseBlocks(body: string): BlockNode {
  const doc = newBlock('document', null);
  const bp: BlockParser = {
    doc,
    tip: doc,
    oldTip: doc,
    lastMatched: doc,
    allClosed: true,
    line: '',
    offset: 0,
    column: 0,
    nextNonspace: 0,
    nextNonspaceColumn: 0,
    indent: 0,
    blank: false,
  };
  for (const line of splitLines(body)) incorporateLine(bp, line);
  for (let n: BlockNode | null = bp.tip; n !== null; n = n.parent) {
    n.open = false;
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Inline structure (CommonMark's delimiter-stack algorithm)

type InlineType =
  'root' | 'text' | 'soft' | 'hard' | 'emph' | 'strong' | 'link' | 'image';

interface InlineNode {
  readonly type: InlineType;
  text: string;
  dest: string;
  parent: InlineNode | null;
  first: InlineNode | null;
  last: InlineNode | null;
  prev: InlineNode | null;
  next: InlineNode | null;
}

interface Delimiter {
  readonly cc: number;
  count: number;
  readonly original: number;
  readonly node: InlineNode;
  previous: Delimiter | null;
  next: Delimiter | null;
  readonly canOpen: boolean;
  readonly canClose: boolean;
}

interface Bracket {
  readonly node: InlineNode;
  readonly previous: Bracket | null;
  readonly previousDelimiter: Delimiter | null;
  readonly image: boolean;
  /** Position in the bracket stack, for the deactivation floor. */
  readonly index: number;
}

/** Where a link destination starting at any position ends, answered in
 *  constant time: CommonMark scans a destination until whitespace or an
 *  unbalanced `)`, and rescanning it for every `](` would be quadratic on
 *  a long run without spaces. */
interface DestinationIndex {
  /** Parenthesis balance before each position (escapes skipped). */
  readonly balance: Int32Array;
  /** The first position after `i` whose balance is below `i`'s. */
  readonly nextLower: Int32Array;
  /** The first whitespace or control character at or after `i`, or the
   *  subject's length. */
  readonly nextSpace: Int32Array;
}

interface InlineParser {
  readonly s: string;
  pos: number;
  readonly root: InlineNode;
  delimiters: Delimiter | null;
  brackets: Bracket | null;
  bracketCount: number;
  /** Link openers below this index are inactive (no links in links). */
  bracketFloor: number;
  destinations: DestinationIndex | null;
  /** The last literal text node, which later literal text may extend. */
  lastLiteral: InlineNode | null;
}

function inlineNode(type: InlineType, text = ''): InlineNode {
  return {
    type,
    text,
    dest: '',
    parent: null,
    first: null,
    last: null,
    prev: null,
    next: null,
  };
}

function appendChild(parent: InlineNode, child: InlineNode): void {
  child.parent = parent;
  child.prev = parent.last;
  child.next = null;
  if (parent.last !== null) parent.last.next = child;
  else parent.first = child;
  parent.last = child;
}

function unlink(node: InlineNode): void {
  const parent = node.parent;
  if (node.prev !== null) node.prev.next = node.next;
  else if (parent !== null) parent.first = node.next;
  if (node.next !== null) node.next.prev = node.prev;
  else if (parent !== null) parent.last = node.prev;
  node.parent = null;
  node.prev = null;
  node.next = null;
}

function insertAfter(node: InlineNode, sibling: InlineNode): void {
  const parent = node.parent;
  sibling.parent = parent;
  sibling.prev = node;
  sibling.next = node.next;
  if (node.next !== null) node.next.prev = sibling;
  else if (parent !== null) parent.last = sibling;
  node.next = sibling;
}

/** Moves every sibling after `from` (up to, not including, `until`) into
 *  `into`. */
function moveSiblingsAfter(
  from: InlineNode,
  until: InlineNode | null,
  into: InlineNode
): void {
  let node = from.next;
  while (node !== null && node !== until) {
    walkSteps++;
    const next = node.next;
    unlink(node);
    appendChild(into, node);
    node = next;
  }
}

function peekInline(ip: InlineParser): number {
  return ip.pos < ip.s.length ? ip.s.charCodeAt(ip.pos) : -1;
}

function appendText(ip: InlineParser, text: string): InlineNode {
  const node = inlineNode('text', text);
  appendChild(ip.root, node);
  return node;
}

/** Text no delimiter or bracket refers to: added to the previous such
 *  text while it is still the last node, so a long run of literal
 *  characters is one node, not one per character. */
function appendLiteral(ip: InlineParser, text: string): void {
  const last = ip.lastLiteral;
  if (last !== null && ip.root.last === last) {
    last.text += text;
    return;
  }
  ip.lastLiteral = appendText(ip, text);
}

function isSpecial(code: number): boolean {
  return (
    code === C_NEWLINE ||
    code === C_BACKSLASH ||
    code === C_ASTERISK ||
    code === C_UNDERSCORE ||
    code === C_OPEN_BRACKET ||
    code === C_CLOSE_BRACKET ||
    code === C_BANG
  );
}

function parseTextRun(ip: InlineParser): void {
  const start = ip.pos;
  ip.pos++;
  while (ip.pos < ip.s.length && !isSpecial(ip.s.charCodeAt(ip.pos))) ip.pos++;
  appendLiteral(ip, ip.s.slice(start, ip.pos));
}

function parseNewline(ip: InlineParser): void {
  ip.pos++;
  const last = ip.root.last;
  let hard = false;
  if (last !== null && last.type === 'text' && last.text.endsWith(' ')) {
    hard = last.text.endsWith('  ');
    let end = last.text.length;
    while (end > 0 && last.text.charCodeAt(end - 1) === C_SPACE) end--;
    last.text = last.text.slice(0, end);
  }
  appendChild(ip.root, inlineNode(hard ? 'hard' : 'soft'));
  while (peekInline(ip) === C_SPACE) ip.pos++;
}

function parseBackslash(ip: InlineParser): void {
  ip.pos++;
  const next = peekInline(ip);
  if (next === C_NEWLINE) {
    ip.pos++;
    appendChild(ip.root, inlineNode('hard'));
  } else if (next !== -1 && isAsciiPunctuation(next)) {
    appendLiteral(ip, String.fromCharCode(next));
    ip.pos++;
  } else {
    appendLiteral(ip, '\\');
  }
}

interface DelimiterRun {
  readonly count: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
}

interface Flanking {
  readonly left: boolean;
  readonly right: boolean;
  readonly beforePunct: boolean;
  readonly afterPunct: boolean;
}

/** Left- and right-flanking of a delimiter run between the code points
 *  `before` and `after` (a line end counts as whitespace). */
function flankingOf(before: number, after: number): Flanking {
  const afterSpace = isUnicodeWhitespace(after);
  const afterPunct = isUnicodePunctuation(after);
  const beforeSpace = isUnicodeWhitespace(before);
  const beforePunct = isUnicodePunctuation(before);
  return {
    left: !afterSpace && (!afterPunct || beforeSpace || beforePunct),
    right: !beforeSpace && (!beforePunct || afterSpace || afterPunct),
    beforePunct,
    afterPunct,
  };
}

function scanDelimiters(ip: InlineParser, cc: number): DelimiterRun {
  const start = ip.pos;
  let end = start;
  while (end < ip.s.length && ip.s.charCodeAt(end) === cc) end++;
  const f = flankingOf(codePointBefore(ip.s, start), codePointFrom(ip.s, end));
  if (cc === C_UNDERSCORE) {
    return {
      count: end - start,
      canOpen: f.left && (!f.right || f.beforePunct),
      canClose: f.right && (!f.left || f.afterPunct),
    };
  }
  return { count: end - start, canOpen: f.left, canClose: f.right };
}

function parseDelimiterRun(ip: InlineParser, cc: number): void {
  const run = scanDelimiters(ip, cc);
  const node = appendText(ip, ip.s.slice(ip.pos, ip.pos + run.count));
  ip.pos += run.count;
  if (!run.canOpen && !run.canClose) return;
  const delimiter: Delimiter = {
    cc,
    count: run.count,
    original: run.count,
    node,
    previous: ip.delimiters,
    next: null,
    canOpen: run.canOpen,
    canClose: run.canClose,
  };
  if (ip.delimiters !== null) ip.delimiters.next = delimiter;
  ip.delimiters = delimiter;
}

function removeDelimiter(ip: InlineParser, d: Delimiter): void {
  if (d.previous !== null) d.previous.next = d.next;
  if (d.next === null) ip.delimiters = d.previous;
  else d.next.previous = d.previous;
}

function openersBottomIndex(closer: Delimiter): number {
  const base = closer.cc === C_UNDERSCORE ? 0 : 6;
  return base + (closer.canOpen ? 3 : 0) + (closer.original % 3);
}

function findOpener(
  closer: Delimiter,
  bottom: Delimiter | null,
  stackBottom: Delimiter | null
): Delimiter | null {
  for (
    let opener = closer.previous;
    opener !== null && opener !== stackBottom && opener !== bottom;
    opener = opener.previous
  ) {
    walkSteps++;
    // The "rule of three": a run that can both open and close matches
    // only when the two lengths' sum is not a multiple of three.
    const oddMatch =
      (closer.canOpen || opener.canClose) &&
      closer.original % 3 !== 0 &&
      (opener.original + closer.original) % 3 === 0;
    if (opener.cc === closer.cc && opener.canOpen && !oddMatch) return opener;
  }
  return null;
}

/** Wraps what lies between `opener` and `closer` in emphasis; the closer
 *  to look at next. */
function applyEmphasis(
  ip: InlineParser,
  opener: Delimiter,
  closer: Delimiter
): Delimiter | null {
  const used = closer.count >= 2 && opener.count >= 2 ? 2 : 1;
  opener.count -= used;
  closer.count -= used;
  opener.node.text = opener.node.text.slice(0, opener.node.text.length - used);
  closer.node.text = closer.node.text.slice(0, closer.node.text.length - used);
  const emphasis = inlineNode(used === 1 ? 'emph' : 'strong');
  moveSiblingsAfter(opener.node, closer.node, emphasis);
  insertAfter(opener.node, emphasis);
  if (opener.next !== closer) {
    opener.next = closer;
    closer.previous = opener;
  }
  if (opener.count === 0) {
    unlink(opener.node);
    removeDelimiter(ip, opener);
  }
  if (closer.count > 0) return closer;
  unlink(closer.node);
  const next = closer.next;
  removeDelimiter(ip, closer);
  return next;
}

/** The first delimiter above `stackBottom`, or null. */
function firstAbove(
  ip: InlineParser,
  stackBottom: Delimiter | null
): Delimiter | null {
  // None when the bottom is the top: walking down from it would visit the
  // whole stack for nothing, which is quadratic over a paragraph of links.
  let first = ip.delimiters === stackBottom ? null : ip.delimiters;
  while (first !== null && first.previous !== stackBottom) {
    walkSteps++;
    first = first.previous;
  }
  return first;
}

function processEmphasis(
  ip: InlineParser,
  stackBottom: Delimiter | null
): void {
  const openersBottom: (Delimiter | null)[] = new Array<Delimiter | null>(
    12
  ).fill(stackBottom);
  let closer = firstAbove(ip, stackBottom);
  while (closer !== null) {
    walkSteps++;
    if (!closer.canClose) {
      closer = closer.next;
      continue;
    }
    const index = openersBottomIndex(closer);
    const opener = findOpener(
      closer,
      openersBottom[index] ?? null,
      stackBottom
    );
    if (opener !== null) {
      closer = applyEmphasis(ip, opener, closer);
      continue;
    }
    const old = closer;
    closer = closer.next;
    openersBottom[index] = old.previous;
    if (!old.canOpen) removeDelimiter(ip, old);
  }
  while (ip.delimiters !== null && ip.delimiters !== stackBottom) {
    walkSteps++;
    removeDelimiter(ip, ip.delimiters);
  }
}

function pushBracket(ip: InlineParser, node: InlineNode, image: boolean): void {
  ip.brackets = {
    node,
    previous: ip.brackets,
    previousDelimiter: ip.delimiters,
    image,
    index: ip.bracketCount,
  };
  ip.bracketCount++;
}

function popBracket(ip: InlineParser): void {
  if (ip.brackets === null) return;
  ip.brackets = ip.brackets.previous;
  ip.bracketCount--;
  ip.bracketFloor = Math.min(ip.bracketFloor, ip.bracketCount);
}

function parseOpenBracket(ip: InlineParser): void {
  ip.pos++;
  pushBracket(ip, appendText(ip, '['), false);
}

function parseBang(ip: InlineParser): void {
  ip.pos++;
  if (peekInline(ip) !== C_OPEN_BRACKET) {
    appendLiteral(ip, '!');
    return;
  }
  ip.pos++;
  pushBracket(ip, appendText(ip, '!['), true);
}

/** Whitespace or an ASCII control character (U+0000 to U+001F, U+007F):
 *  a destination holds neither. */
function endsDestination(code: number): boolean {
  return code <= C_SPACE || code === C_DELETE;
}

function buildBalance(s: string): Int32Array {
  const balance = new Int32Array(s.length + 1);
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === C_BACKSLASH && isAsciiPunctuation(s.charCodeAt(i + 1))) {
      balance[i + 1] = balance[i] ?? 0;
      balance[i + 2] = balance[i] ?? 0;
      i += 2;
      continue;
    }
    const step = c === C_OPEN_PAREN ? 1 : c === C_CLOSE_PAREN ? -1 : 0;
    balance[i + 1] = (balance[i] ?? 0) + step;
    i++;
  }
  return balance;
}

function buildNextLower(balance: Int32Array): Int32Array {
  const n = balance.length;
  const nextLower = new Int32Array(n).fill(n);
  const stack = new Int32Array(n);
  let top = 0;
  for (let i = n - 1; i >= 0; i--) {
    const value = balance[i] ?? 0;
    while (top > 0 && (balance[stack[top - 1] ?? 0] ?? 0) >= value) top--;
    if (top > 0) nextLower[i] = stack[top - 1] ?? n;
    stack[top++] = i;
  }
  return nextLower;
}

function buildNextSpace(s: string): Int32Array {
  const nextSpace = new Int32Array(s.length + 1);
  nextSpace[s.length] = s.length;
  for (let i = s.length - 1; i >= 0; i--) {
    nextSpace[i] = endsDestination(s.charCodeAt(i))
      ? i
      : (nextSpace[i + 1] ?? s.length);
  }
  return nextSpace;
}

function destinationIndex(ip: InlineParser): DestinationIndex {
  if (ip.destinations === null) {
    const balance = buildBalance(ip.s);
    ip.destinations = {
      balance,
      nextLower: buildNextLower(balance),
      nextSpace: buildNextSpace(ip.s),
    };
  }
  return ip.destinations;
}

/** Where a destination starting at `from` ends, or -1 for none. */
function destinationEnd(ip: InlineParser, from: number): number {
  const index = destinationIndex(ip);
  const n = ip.s.length;
  const lower = index.nextLower[from] ?? n + 1;
  const space = index.nextSpace[from] ?? n;
  // An unbalanced `)` before any whitespace ends it (possibly empty).
  if (lower <= n && lower - 1 < space) return lower - 1;
  const balanced = (index.balance[space] ?? 0) === (index.balance[from] ?? 0);
  return balanced && space > from ? space : -1;
}

function unescapeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === C_BACKSLASH && isAsciiPunctuation(text.charCodeAt(i + 1))) {
      i++;
    }
    out += text.charAt(i);
  }
  return out;
}

/** Spaces and tabs, with at most one newline among them. */
function skipSpacesAndOneNewline(ip: InlineParser): void {
  while (isSpaceOrTab(peekInline(ip))) ip.pos++;
  if (peekInline(ip) !== C_NEWLINE) return;
  ip.pos++;
  while (isSpaceOrTab(peekInline(ip))) ip.pos++;
}

/** `(destination)` after a `]`: its unescaped destination, or null with
 *  the position unchanged. Titles and `<...>` destinations are not part of
 *  the subset. */
function parseInlineLinkTail(ip: InlineParser): string | null {
  const saved = ip.pos;
  if (peekInline(ip) !== C_OPEN_PAREN) return null;
  ip.pos++;
  skipSpacesAndOneNewline(ip);
  const from = ip.pos;
  const end = peekInline(ip) === C_LESS ? -1 : destinationEnd(ip, from);
  // A destination never ends before it starts; checking that keeps the
  // parse moving forward whatever the index answers.
  if (end >= from) {
    ip.pos = end;
    skipSpacesAndOneNewline(ip);
  }
  if (end < from || peekInline(ip) !== C_CLOSE_PAREN) {
    ip.pos = saved;
    return null;
  }
  ip.pos++;
  return unescapeText(ip.s.slice(from, end));
}

function parseCloseBracket(ip: InlineParser): void {
  ip.pos++;
  const opener = ip.brackets;
  if (opener === null) {
    appendLiteral(ip, ']');
    return;
  }
  const active = opener.image || opener.index >= ip.bracketFloor;
  const dest = active ? parseInlineLinkTail(ip) : null;
  if (dest === null) {
    popBracket(ip);
    appendLiteral(ip, ']');
    return;
  }
  const node = inlineNode(opener.image ? 'image' : 'link');
  node.dest = dest;
  moveSiblingsAfter(opener.node, null, node);
  appendChild(ip.root, node);
  processEmphasis(ip, opener.previousDelimiter);
  popBracket(ip);
  unlink(opener.node);
  if (!opener.image) ip.bracketFloor = ip.bracketCount;
}

function parseInline(ip: InlineParser): void {
  const c = ip.s.charCodeAt(ip.pos);
  switch (c) {
    case C_NEWLINE:
      return parseNewline(ip);
    case C_BACKSLASH:
      return parseBackslash(ip);
    case C_ASTERISK:
    case C_UNDERSCORE:
      return parseDelimiterRun(ip, c);
    case C_OPEN_BRACKET:
      return parseOpenBracket(ip);
    case C_BANG:
      return parseBang(ip);
    case C_CLOSE_BRACKET:
      return parseCloseBracket(ip);
    default:
      return parseTextRun(ip);
  }
}

function parseInlines(content: string): InlineNode {
  const ip: InlineParser = {
    s: trimSpacesAndTabs(content),
    pos: 0,
    root: inlineNode('root'),
    delimiters: null,
    brackets: null,
    bracketCount: 0,
    bracketFloor: 0,
    destinations: null,
    lastLiteral: null,
  };
  while (ip.pos < ip.s.length) {
    walkSteps++;
    parseInline(ip);
  }
  processEmphasis(ip, null);
  return ip.root;
}

// ---------------------------------------------------------------------------
// From the parser's nodes to the public tree

type MutableInline = TourMdInline & { text?: string };

interface InlineFrame {
  node: InlineNode | null;
  readonly out: MutableInline[];
  readonly depth: number;
}

/** The plain text of an inline subtree, breaks as spaces: a picture's alt
 *  text. Iterative, so no nesting depth can exhaust the stack. */
function altTextOf(node: InlineNode): string {
  let out = '';
  const stack: (InlineNode | null)[] = [node.first];
  while (stack.length > 0) {
    walkSteps++;
    const current = stack.pop() ?? null;
    if (current === null) continue;
    stack.push(current.next);
    if (current.type === 'text') out += current.text;
    else if (current.type === 'soft' || current.type === 'hard') out += ' ';
    else stack.push(current.first);
  }
  return out;
}

function pushText(out: MutableInline[], text: string): void {
  if (text === '') return;
  const last = out[out.length - 1];
  if (last !== undefined && last.kind === 'text') {
    last.text += text;
  } else {
    out.push({ kind: 'text', text });
  }
}

/** Converts one node; a container returns the frame for its children. */
function convertInline(
  node: InlineNode,
  out: MutableInline[],
  depth: number
): InlineFrame | null {
  switch (node.type) {
    case 'text':
      pushText(out, node.text);
      return null;
    case 'soft':
      out.push({ kind: 'softBreak' });
      return null;
    case 'hard':
      out.push({ kind: 'hardBreak' });
      return null;
    case 'image':
      out.push({ kind: 'pictureAlt', alt: altTextOf(node) });
      return null;
    case 'link':
      return convertLink(node, out, depth);
    default:
      return convertEmphasis(node, out, depth);
  }
}

function convertLink(
  node: InlineNode,
  out: MutableInline[],
  depth: number
): InlineFrame {
  const check = checkTourLink(node.dest);
  if (!check.ok) return { node: node.first, out, depth };
  const children: MutableInline[] = [];
  out.push({ kind: 'link', href: check.href, host: check.host, children });
  return { node: node.first, out: children, depth };
}

function convertEmphasis(
  node: InlineNode,
  out: MutableInline[],
  depth: number
): InlineFrame {
  if (depth >= MAX_EMPHASIS_DEPTH) return { node: node.first, out, depth };
  const children: MutableInline[] = [];
  out.push({
    kind: node.type === 'strong' ? 'strong' : 'emphasis',
    children,
  });
  return { node: node.first, out: children, depth: depth + 1 };
}

function convertInlines(root: InlineNode): TourMdInline[] {
  const result: MutableInline[] = [];
  const stack: InlineFrame[] = [{ node: root.first, out: result, depth: 0 }];
  while (stack.length > 0) {
    walkSteps++;
    const frame = stack[stack.length - 1];
    if (frame === undefined || frame.node === null) {
      stack.pop();
      continue;
    }
    const node = frame.node;
    frame.node = node.next;
    const child = convertInline(node, frame.out, frame.depth);
    if (child !== null) stack.push(child);
  }
  return result;
}

function pictureAsset(node: InlineNode): string | null {
  if (node.type !== 'image' || !node.dest.startsWith(PICTURE_TARGET_PREFIX)) {
    return null;
  }
  const id = node.dest.slice(PICTURE_TARGET_PREFIX.length);
  return TOUR_ID_PATTERN.test(id) ? id : null;
}

function isBlankText(node: InlineNode): boolean {
  return node.type === 'text' && trimSpacesAndTabs(node.text) === '';
}

/** The pictures of a paragraph whose every line holds one `asset:`
 *  picture and nothing else but spaces and tabs, or null. */
function pictureLines(root: InlineNode): InlineNode[] | null {
  const pictures: InlineNode[] = [];
  let lineHasPicture = false;
  for (let node = root.first; node !== null; node = node.next) {
    walkSteps++;
    if (node.type === 'soft' || node.type === 'hard') {
      if (!lineHasPicture) return null;
      lineHasPicture = false;
    } else if (pictureAsset(node) !== null && !lineHasPicture) {
      pictures.push(node);
      lineHasPicture = true;
    } else if (!isBlankText(node)) {
      return null;
    }
  }
  return lineHasPicture ? pictures : null;
}

interface ConvertContext {
  picturesLeft: number;
}

function convertParagraph(
  node: BlockNode,
  context: ConvertContext
): TourMdBlock[] {
  const root = parseInlines(node.lines.join('\n'));
  const pictures = pictureLines(root);
  if (pictures === null) {
    return [{ kind: 'paragraph', inlines: convertInlines(root) }];
  }
  return pictures.map((picture): TourMdBlock => {
    const alt = altTextOf(picture);
    if (context.picturesLeft <= 0) {
      return { kind: 'paragraph', inlines: [{ kind: 'pictureAlt', alt }] };
    }
    context.picturesLeft--;
    return { kind: 'picture', alt, asset: pictureAsset(picture) ?? '' };
  });
}

function convertChildren(
  node: BlockNode,
  context: ConvertContext
): TourMdBlock[] {
  return node.children.flatMap((child) => convertBlock(child, context));
}

function convertBlock(node: BlockNode, context: ConvertContext): TourMdBlock[] {
  switch (node.type) {
    case 'paragraph':
      return convertParagraph(node, context);
    case 'heading':
      return [
        {
          kind: 'heading',
          level: node.level as 1 | 2 | 3,
          inlines: convertInlines(parseInlines(node.lines[0] ?? '')),
        },
      ];
    case 'list':
      return [
        {
          kind: 'list',
          ordered: node.list?.ordered ?? false,
          start: node.list?.start ?? 1,
          items: node.children.map((item) => convertChildren(item, context)),
        },
      ];
    default:
      return [{ kind: 'quote', blocks: convertChildren(node, context) }];
  }
}

// ---------------------------------------------------------------------------
// Public API

/**
 * Reads a long text's body. Never throws: anything outside the subset is
 * kept as the characters typed, and a value that is not a string reads as
 * an empty body. Linear in the body's length.
 */
export function parseTourMarkdown(body: string): TourMarkdown {
  if (typeof body !== 'string') return { blocks: [] };
  const context: ConvertContext = { picturesLeft: TOUR_MARKDOWN_MAX_PICTURES };
  return { blocks: convertChildren(parseBlocks(body), context) };
}

/**
 * The walk steps (see `walkSteps`) that reading `body` and its `P` takes:
 * a deterministic measure of the parser's work for the linearity test,
 * where timings on a loaded machine are too noisy. Not part of reading.
 *
 * @internal testing seam
 */
export function __tourMarkdownWalkStepsForTests(body: string): number {
  walkSteps = 0;
  plainTextOf(parseTourMarkdown(body));
  return walkSteps;
}

function isLeafSpace(code: number): boolean {
  return code === C_SPACE || code === C_TAB || code === C_NEWLINE;
}

/** A leaf's text: soft breaks as spaces, hard breaks as newlines, links by
 *  their text, pictures as nothing; spaces, tabs and newlines at either
 *  end removed. */
function leafText(inlines: readonly TourMdInline[]): string {
  let out = '';
  const stack: (readonly TourMdInline[])[] = [inlines];
  const positions: number[] = [0];
  while (stack.length > 0) {
    walkSteps++;
    const list = stack[stack.length - 1] ?? [];
    const at = positions[positions.length - 1] ?? 0;
    const inline = list[at];
    if (inline === undefined) {
      stack.pop();
      positions.pop();
      continue;
    }
    positions[positions.length - 1] = at + 1;
    const own = ownTextOf(inline);
    if (typeof own === 'string') out += own;
    else {
      stack.push(own);
      positions.push(0);
    }
  }
  return trimLeafSpace(out);
}

/** What an inline adds to `P` itself, or the children that add it. */
function ownTextOf(inline: TourMdInline): string | readonly TourMdInline[] {
  switch (inline.kind) {
    case 'text':
      return inline.text;
    case 'softBreak':
      return ' ';
    case 'hardBreak':
      return '\n';
    case 'pictureAlt':
      return '';
    default:
      return inline.children;
  }
}

function trimLeafSpace(text: string): string {
  let from = 0;
  let to = text.length;
  while (from < to && isLeafSpace(text.charCodeAt(from))) from++;
  while (to > from && isLeafSpace(text.charCodeAt(to - 1))) to--;
  return text.slice(from, to);
}

function collectLeaves(
  blocks: readonly TourMdBlock[],
  into: { block: TourMdParagraph | TourMdHeading; text: string }[]
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph' || block.kind === 'heading') {
      const text = leafText(block.inlines);
      if (text !== '') into.push({ block, text });
    } else if (block.kind === 'list') {
      for (const item of block.items) collectLeaves(item, into);
    } else if (block.kind === 'quote') {
      collectLeaves(block.blocks, into);
    }
  }
}

/**
 * `P`: what a narrator reads and what read-along offsets count in. Each
 * paragraph and heading (at any depth, in document order) is a leaf; leaves
 * are joined with `"\n\n"`; pictures, list and quote markers add nothing.
 * Offsets are UTF-16 code units of `P`.
 */
export function plainTextOf(doc: TourMarkdown): TourPlainText {
  const found: { block: TourMdParagraph | TourMdHeading; text: string }[] = [];
  collectLeaves(Array.isArray(doc?.blocks) ? doc.blocks : [], found);
  const leaves: TourMdLeaf[] = [];
  let text = '';
  for (const leaf of found) {
    if (text !== '') text += '\n\n';
    leaves.push({
      block: leaf.block,
      from: text.length,
      to: text.length + leaf.text.length,
    });
    text += leaf.text;
  }
  return { text, leaves };
}

function escapeLine(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (isAsciiPunctuation(c)) out += '\\';
    out += line.charAt(i);
  }
  return out;
}

/**
 * Plain text as a body whose `P` is that text, normalised: every ASCII
 * punctuation character is escaped, each line is trimmed of spaces and
 * tabs, a line break becomes a hard break, one or more empty lines become
 * one paragraph break, and empty paragraphs go.
 */
export function escapeTourMarkdown(text: string): string {
  if (typeof text !== 'string') return '';
  const paragraphs: string[][] = [[]];
  for (const raw of splitLines(text)) {
    const line = trimSpacesAndTabs(raw);
    const current = paragraphs[paragraphs.length - 1] ?? [];
    if (line !== '') current.push(escapeLine(line));
    else if (current.length > 0) paragraphs.push([]);
  }
  return paragraphs
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join('\\\n'))
    .join('\n\n');
}

/**
 * A link target as a long text accepts it: it parses as a URL, its scheme
 * is `https:`, and it carries no user name or password (which would read
 * as one host and open another). The href and the ASCII host are the URL
 * parser's.
 */
export function checkTourLink(target: string): TourLinkCheck {
  if (typeof target !== 'string') return { ok: false };
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { ok: false };
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hostname === ''
  ) {
    return { ok: false };
  }
  return { ok: true, href: url.href, host: url.hostname };
}

/**
 * `"sha256:"` and the SHA-256 of `P`'s UTF-8 bytes in lowercase hex: what a
 * read-along timing records to know it still fits its text.
 *
 * @throws (rejects) when WebCrypto is unavailable, as {@link sha256Hex}.
 */
export async function textHashOf(plain: string): Promise<string> {
  if (typeof plain !== 'string') {
    throw new TypeError('textHashOf: the plain text must be a string');
  }
  return `sha256:${await sha256Hex(new TextEncoder().encode(plain))}`;
}
