/**
 * What a station holds in `tour.json` version 5: ONE ordered list of
 * CHILDREN, each a free block (standing in the world) or a STORY, which
 * holds its own ordered list of blocks, choices and quizzes. A block lives
 * in exactly one place, so being inside a story is what shows it. Ids of
 * blocks, stories, choices and quizzes are one namespace across the tour; a
 * choice's `goto` names a child of its own story. The order of the file is
 * kept as written: nothing assumes free blocks first.
 *
 * - a story block: any view of its kind, and an `advance`: how it moves on,
 *   a tap (also when absent), by itself after some seconds, or by itself
 *   when its line ends: its voice or sound has played, or, with none, its
 *   words have had their time to be read (the viewer's rule).
 * - `choice`: a prompt and at least two options; an option's `goto` names a
 *   child of this story, or is absent - then the scene continues at the
 *   next child. A `goto` naming nothing fails the file.
 * - `quiz`: question, points and answer. There is no `route` (the walk is
 *   not branched by answers); a `route` field is an unknown field and
 *   ignored.
 * - a story's title is required, and a story may be empty: an editor needs
 *   one while it is filled, and a visitor is offered only stories with
 *   something to play.
 *
 * LENIENT for a NEWER MINOR (as `tour-blocks.ts`): a child of an unknown
 * kind, a quiz of an unknown answer type and a block the reader skipped are
 * left out and reported; a choice then keeps only the options whose child
 * is still there (an option with no `goto` always is), and a choice left
 * with fewer than two goes too - repeated, since that can strand another.
 * An unknown advance mode is a tap.
 *
 * @see tour-story.ts.md
 */

import { isFiniteNumber, isRecord } from '../utils/json-guards.js';
import {
  checkTourBlockText,
  placeTourBlocks,
  TOUR_BLOCK_VIEWS,
  tourBlockReader,
  type TourBlock,
  type TourBlockDrop,
  type TourBlockRead,
  type TourBlocksReadOptions,
  type TourTextRule,
} from './tour-blocks.js';
import {
  assertUniqueTourIds,
  requireTourArray,
  requireTourId,
  requireTourText,
  tourTextOf,
  type TourFail,
} from './tour-fields.js';

export type TourStepAdvance =
  | { readonly mode: 'tap' }
  | { readonly mode: 'auto'; readonly afterS: number }
  | { readonly mode: 'lineEnd' };

/** One way on from a choice. */
export interface TourChoiceOption {
  readonly id: string;
  readonly label: string;
  /** A child of the same story. Absent: the next one. */
  readonly goto?: string;
}

export interface TourQuizOption {
  readonly id: string;
  readonly label: string;
}

/** Text and code answers are salted SHA-256 hex digests of the accepted
 *  answers after normalisation (a deterrent only); choice and number
 *  answers are in clear, since points stay on the phone. */
export type TourQuizAnswer =
  | {
      readonly type: 'single';
      readonly options: readonly TourQuizOption[];
      readonly correct: string;
    }
  | {
      readonly type: 'multiple';
      readonly options: readonly TourQuizOption[];
      readonly correct: readonly string[];
    }
  | {
      readonly type: 'text' | 'code';
      readonly salt: string;
      readonly sha256: readonly string[];
    }
  | {
      readonly type: 'number';
      readonly value: number;
      readonly tolerance: number;
      readonly unit?: string;
    };

/** A quiz: the question, its points and the accepted answer. */
export interface TourQuiz {
  readonly question: string;
  readonly points: number;
  readonly answer: TourQuizAnswer;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

// --- quizzes ----------------------------------------------------------

function parseQuizOptions(
  value: unknown,
  at: string,
  fail: TourFail
): TourQuizOption[] {
  const options = requireTourArray(value, at, fail).map((o, i) => {
    const oat = `${at}[${String(i)}]`;
    if (!isRecord(o)) return fail(`"${oat}" must be an object`);
    return {
      id: requireTourId(o.id, `${oat}.id`, fail),
      label: requireTourText(o.label, `${oat}.label`, fail),
    };
  });
  if (options.length < 2) fail(`"${at}" must list at least 2 options`);
  assertUniqueTourIds(
    options.map((o) => o.id),
    'option',
    fail,
    `${at}: `
  );
  return options;
}

function parseChoiceAnswer(
  type: 'single' | 'multiple',
  v: Record<string, unknown>,
  at: string,
  fail: TourFail
): TourQuizAnswer {
  const options = parseQuizOptions(v.options, `${at}.options`, fail);
  const ids = new Set(options.map((o) => o.id));
  if (type === 'single') {
    if (typeof v.correct !== 'string' || !ids.has(v.correct)) {
      return fail(`"${at}.correct" must name one of its options`);
    }
    return { type, options, correct: v.correct };
  }
  const correct = Array.isArray(v.correct) ? (v.correct as unknown[]) : [];
  if (
    correct.length === 0 ||
    new Set(correct).size !== correct.length ||
    !correct.every((c) => typeof c === 'string' && ids.has(c))
  ) {
    fail(`"${at}.correct" must list at least one of its options, each once`);
  }
  return { type, options, correct: correct as string[] };
}

function parseHashedAnswer(
  type: 'text' | 'code',
  v: Record<string, unknown>,
  at: string,
  fail: TourFail
): TourQuizAnswer {
  const salt = requireTourText(v.salt, `${at}.salt`, fail);
  const hashes = requireTourArray(v.sha256, `${at}.sha256`, fail);
  if (hashes.length === 0) fail(`"${at}.sha256" must list at least one hash`);
  hashes.forEach((h, i) => {
    if (typeof h !== 'string' || !SHA256_HEX.test(h)) {
      fail(`"${at}.sha256[${String(i)}]" must be lowercase SHA-256 hex`);
    }
  });
  return { type, salt, sha256: hashes as string[] };
}

function parseNumberAnswer(
  v: Record<string, unknown>,
  at: string,
  fail: TourFail
): TourQuizAnswer {
  if (!isFiniteNumber(v.value)) {
    return fail(`"${at}.value" must be a finite number`);
  }
  if (!isFiniteNumber(v.tolerance) || v.tolerance < 0) {
    return fail(`"${at}.tolerance" must be a number >= 0`);
  }
  const unit = tourTextOf(v.unit);
  return {
    type: 'number',
    value: v.value,
    tolerance: v.tolerance,
    ...(unit === undefined ? {} : { unit }),
  };
}

/** A quiz's answer, or null when a lenient reader does not know its type
 *  (a newer minor's). */
function parseAnswer(
  value: unknown,
  at: string,
  fail: TourFail,
  lenient: boolean
): TourQuizAnswer | null {
  if (!isRecord(value)) return fail(`"${at}" must be an object`);
  switch (value.type) {
    case 'single':
    case 'multiple':
      return parseChoiceAnswer(value.type, value, at, fail);
    case 'text':
    case 'code':
      return parseHashedAnswer(value.type, value, at, fail);
    case 'number':
      return parseNumberAnswer(value, at, fail);
    default:
      if (lenient) return null;
      return fail(
        `"${at}.type" must be single, multiple, text, number or code`
      );
  }
}

/**
 * A quiz's question, points and answer. Null when a lenient reader does
 * not know the answer's type (a newer minor's): the child cannot be shown.
 */
function parseQuiz(
  v: Record<string, unknown>,
  at: string,
  options: { readonly fail: TourFail; readonly lenient: boolean }
): TourQuiz | null {
  const { fail } = options;
  const { points } = v;
  if (!isFiniteNumber(points) || !Number.isInteger(points) || points < 0) {
    return fail(`"${at}.points" must be an integer >= 0`);
  }
  const answer = parseAnswer(v.answer, `${at}.answer`, fail, options.lenient);
  if (answer === null) return null;
  return {
    question: requireTourText(v.question, `${at}.question`, fail),
    points,
    answer,
  };
}

// --- advances and choices ---------------------------------------------

/** How a story block moves on: tap when absent; a newer minor's mode reads
 *  as tap for a lenient reader. */
function parseAdvance(
  value: unknown,
  at: string,
  options: { readonly fail: TourFail; readonly lenient: boolean }
): TourStepAdvance {
  const { fail } = options;
  if (value === undefined) return { mode: 'tap' };
  if (!isRecord(value)) return fail(`"${at}" must be an object`);
  if (value.mode === 'tap') return { mode: 'tap' };
  if (value.mode === 'lineEnd') return { mode: 'lineEnd' };
  if (value.mode !== 'auto') {
    // A newer minor's mode: the visitor taps on, as with no rule at all.
    if (options.lenient) return { mode: 'tap' };
    return fail(`"${at}.mode" must be "tap", "auto" or "lineEnd"`);
  }
  if (!isFiniteNumber(value.afterS) || value.afterS <= 0) {
    return fail(`"${at}.afterS" must be a number of seconds > 0`);
  }
  return { mode: 'auto', afterS: value.afterS };
}

function parseOption(
  value: unknown,
  at: string,
  fail: TourFail
): TourChoiceOption {
  if (!isRecord(value)) return fail(`"${at}" must be an object`);
  return {
    id: requireTourId(value.id, `${at}.id`, fail),
    label: requireTourText(value.label, `${at}.label`, fail),
    ...(value.goto === undefined
      ? {}
      : { goto: requireTourId(value.goto, `${at}.goto`, fail) }),
  };
}

function parseChoice(
  v: Record<string, unknown>,
  at: string,
  fail: TourFail
): Omit<TourChoice, 'id'> {
  const prompt = requireTourText(v.prompt, `${at}.prompt`, fail);
  const options = requireTourArray(v.options, `${at}.options`, fail).map(
    (o, i) => parseOption(o, `${at}.options[${String(i)}]`, fail)
  );
  if (options.length < 2) fail(`"${at}.options" must list at least 2 options`);
  assertUniqueTourIds(
    options.map((o) => o.id),
    'option',
    fail,
    `${at}.options: `
  );
  return { kind: 'choice', prompt, options };
}

// --- a station's children ----------------------------------------------

/** The kinds a child may have besides the block kinds: a station's story,
 *  and a story's choice and quiz. Disjoint from `TourBlockKind`, so `kind`
 *  alone tells every child apart. */
export const TOUR_CHILD_KINDS = ['story', 'choice', 'quiz'] as const;

/** A story's title: required, at most 80 code points by `tourTextCount`
 *  (the picker shows it). */
export const TOUR_STORY_TITLE_RULE = {
  max: 80,
  unit: 'codePoints',
  required: true,
} as const satisfies TourTextRule;

/** A block inside a story: shown when the visitor reaches it. */
export type TourStoryBlock = TourBlock & { readonly advance: TourStepAdvance };

/** A choice inside a story. It waits for an answer, so it has no advance. */
export interface TourChoice {
  readonly id: string;
  readonly kind: 'choice';
  readonly prompt: string;
  /** Each `goto` names a child of the SAME story; absent: the next child. */
  readonly options: readonly TourChoiceOption[];
}

/** A quiz inside a story. It waits for an answer, so it has no advance. */
export interface TourQuizEntry extends TourQuiz {
  readonly id: string;
  readonly kind: 'quiz';
}

/** A story's child, in the order a visitor meets it. */
export type TourStoryChild = TourStoryBlock | TourChoice | TourQuizEntry;

/** A story: a title and its own ordered children; may be empty. */
export interface TourStory {
  readonly id: string;
  readonly kind: 'story';
  readonly title: string;
  readonly children: readonly TourStoryChild[];
}

/** A station's child: a free block (standing in the world) or a story. */
export type TourStationChild = TourBlock | TourStory;

/** What the children reader left out: a block or a block's field (as the
 *  block reader reports it), or a whole child it cannot show in its place
 *  (a story, choice or quiz it skipped included), or one way on a choice
 *  lost because the child it named was left out (`child` is the choice). */
export type TourChildDrop =
  | TourBlockDrop
  | { readonly kind: 'child'; readonly child: string; readonly reason: string }
  | {
      readonly kind: 'option';
      readonly child: string;
      readonly option: string;
      readonly reason: string;
    };

/** What holds children: a station, or a creator's frame of one. */
export interface TourStationHolder {
  readonly children: readonly TourStationChild[];
}

/** How the children reader reads: as the block reader, with its own
 *  report. */
export interface TourChildrenReadOptions extends Omit<
  TourBlocksReadOptions,
  'onDropped'
> {
  readonly onDropped?: (drop: TourChildDrop) => void;
}

const BLOCK_KINDS: ReadonlySet<string> = new Set(Object.keys(TOUR_BLOCK_VIEWS));

interface ChildrenContext {
  readonly fail: TourFail;
  readonly lenient: boolean;
  readonly options: TourChildrenReadOptions;
  readonly readBlock: (
    value: Readonly<Record<string, unknown>>,
    at: string
  ) => TourBlockRead | null;
  /** Every child id the file names, in file order, skipped ones included. */
  readonly ids: string[];
}

/** A lenient reader leaves out a child: said to `onDropped`. */
function dropChild(ctx: ChildrenContext, child: string, reason: string): null {
  ctx.options.onDropped?.({ kind: 'child', child, reason });
  return null;
}

/** A child of a kind not known in its place: refused at this reader's own
 *  minor, skipped and reported in a newer one. */
function unknownChild(
  ctx: ChildrenContext,
  id: string,
  at: string,
  allowed: string
): null {
  const reason = `"${at}.kind" must be ${allowed}`;
  if (!ctx.lenient) return ctx.fail(reason);
  return dropChild(ctx, id, reason);
}

/** A free block: it must stand in the world (the block reader's own rule,
 *  {@link placeTourBlocks}, with nothing shown). */
function readFreeBlock(
  v: Record<string, unknown>,
  at: string,
  ctx: ChildrenContext
): TourBlock | null {
  const read = ctx.readBlock(v, at);
  if (read === null) return null;
  return placeTourBlocks([read], ctx.options)[0] ?? null;
}

/** A story block: any view of its kind (an unknown one reads as `card`,
 *  the story floor), and how it moves on. */
function readStoryBlock(
  v: Record<string, unknown>,
  at: string,
  ctx: ChildrenContext
): TourStoryBlock | null {
  const read = ctx.readBlock(v, at);
  if (read === null) return null;
  const advance = parseAdvance(v.advance, `${at}.advance`, ctx);
  return { ...read.block, advance };
}

/** A child as read: its id either way (a choice may name a skipped one),
 *  its index in the file, and the child - null when it was left out. */
interface ReadChild {
  readonly id: string;
  readonly index: number;
  readonly child: TourStoryChild | null;
}

function readStoryChild(
  value: unknown,
  index: number,
  at: string,
  ctx: ChildrenContext
): ReadChild {
  if (!isRecord(value)) return ctx.fail(`"${at}" must be an object`);
  const id = requireTourId(value.id, `${at}.id`, ctx.fail);
  ctx.ids.push(id);
  const { kind } = value;
  let child: TourStoryChild | null;
  if (typeof kind === 'string' && BLOCK_KINDS.has(kind)) {
    child = readStoryBlock(value, at, ctx);
  } else if (kind === 'choice') {
    child = { id, ...parseChoice(value, at, ctx.fail) };
  } else if (kind === 'quiz') {
    const quiz = parseQuiz(value, at, ctx);
    child =
      quiz === null
        ? dropChild(ctx, id, `"${at}.answer.type" is not known to this reader`)
        : { id, kind: 'quiz', ...quiz };
  } else {
    child = unknownChild(ctx, id, at, 'a block kind, choice or quiz');
  }
  return { id, index, child };
}

/** Every `goto` names a child of its own story (the skipped ones
 *  included); a failure names the choice by its index in the FILE. */
function checkStoryGotos(
  read: readonly ReadChild[],
  at: string,
  fail: TourFail
): void {
  const ids = new Set(read.map((r) => r.id));
  for (const { child, index } of read) {
    if (child?.kind !== 'choice') continue;
    child.options.forEach((option, o) => {
      if (option.goto !== undefined && !ids.has(option.goto)) {
        fail(
          `"${at}[${String(index)}].options[${String(o)}].goto" must name a child of this story`
        );
      }
    });
  }
}

/**
 * After a lenient reader left children out: a choice keeps the options
 * whose child is still there (no `goto`: always), and a choice left with
 * fewer than two goes too, reported (a pruned option of a choice that
 * stays is reported on its own) - repeated, because dropping a choice
 * can strand another that jumped to it. Ends: every round removes one.
 */
function withoutStrandedStoryChoices(
  children: readonly TourStoryChild[],
  ctx: ChildrenContext
): TourStoryChild[] {
  let kept = [...children];
  for (;;) {
    const ids = new Set(kept.map((c) => c.id));
    let changed = false;
    const next = kept.flatMap((child): TourStoryChild[] => {
      if (child.kind !== 'choice') return [child];
      const options = child.options.filter(
        (o) => o.goto === undefined || ids.has(o.goto)
      );
      if (options.length === child.options.length) return [child];
      changed = true;
      if (options.length >= 2) {
        for (const o of child.options.filter((x) => !options.includes(x))) {
          ctx.options.onDropped?.({
            kind: 'option',
            child: child.id,
            option: o.id,
            reason: `option "${o.id}" names a child this reader left out`,
          });
        }
        return [{ ...child, options }];
      }
      dropChild(ctx, child.id, `choice "${child.id}" has fewer than 2 ways on`);
      return [];
    });
    if (!changed) return next;
    kept = next;
  }
}

function readStoryChildren(
  value: unknown,
  at: string,
  ctx: ChildrenContext
): TourStoryChild[] {
  const read = requireTourArray(value, at, ctx.fail).map((c, i) =>
    readStoryChild(c, i, `${at}[${String(i)}]`, ctx)
  );
  checkStoryGotos(read, at, ctx.fail);
  const kept = read.flatMap((r) => (r.child === null ? [] : [r.child]));
  return ctx.lenient ? withoutStrandedStoryChoices(kept, ctx) : kept;
}

/** A story: its title is required at every minor; over its cap it fails a
 *  file of this reader's minor and is left out of a newer one's (which may
 *  widen the cap). Its children are read either way, so their structural
 *  faults fail the file. */
function readStory(
  v: Record<string, unknown>,
  id: string,
  at: string,
  ctx: ChildrenContext
): TourStory | null {
  const checked = checkTourBlockText(TOUR_STORY_TITLE_RULE, v.title);
  const titleAt = `"${at}.title"`;
  if (!checked.ok && (typeof v.title !== 'string' || checked.blank === true)) {
    return ctx.fail(`${titleAt} ${checked.reason}`);
  }
  const children = readStoryChildren(v.children, `${at}.children`, ctx);
  if (checked.ok) return { id, kind: 'story', title: checked.value, children };
  const reason = `${titleAt} ${checked.reason}`;
  if (!ctx.lenient) return ctx.fail(reason);
  return dropChild(ctx, id, reason);
}

function readStationChild(
  value: unknown,
  at: string,
  ctx: ChildrenContext
): TourStationChild | null {
  if (!isRecord(value)) return ctx.fail(`"${at}" must be an object`);
  const id = requireTourId(value.id, `${at}.id`, ctx.fail);
  ctx.ids.push(id);
  const { kind } = value;
  if (typeof kind === 'string' && BLOCK_KINDS.has(kind)) {
    return readFreeBlock(value, at, ctx);
  }
  if (kind === 'story') return readStory(value, id, at, ctx);
  return unknownChild(ctx, id, at, 'a block kind or story');
}

/** One station's children as read, and every child id its file names -
 *  the ones a lenient read left out included, in file order - which is
 *  what the ids across stations are checked on. */
export interface TourStationChildrenRead {
  readonly children: TourStationChild[];
  readonly ids: readonly string[];
}

/**
 * Read one station's `children` (the list `value`, at `at`): every block
 * checked (`tour-blocks.ts`), every free block standing in the world, every
 * story titled, every `goto` naming a child of its own story, and every id
 * unique in the station (blocks, stories, choices and quizzes are one
 * namespace; across stations: {@link checkTourChildIdsUnique}). The order
 * of the file is kept. Throws through `fail` naming the first violation; a
 * lenient reader (a newer minor) leaves out what it cannot show, reports
 * each through `onDropped`, prunes the options that named it and drops the
 * choices left with fewer than two. Structural faults - an id, a duplicate,
 * a `goto` naming nothing, a story without a title or children, a missing
 * list - fail at every minor.
 */
export function parseTourStationChildren(
  value: unknown,
  at: string,
  options: TourChildrenReadOptions
): TourStationChildrenRead {
  const ctx: ChildrenContext = {
    fail: options.fail,
    lenient: options.lenient === true,
    options,
    readBlock: tourBlockReader(options),
    ids: [],
  };
  const children = requireTourArray(value, at, options.fail).flatMap(
    (c, i): TourStationChild[] => {
      const child = readStationChild(c, `${at}[${String(i)}]`, ctx);
      return child === null ? [] : [child];
    }
  );
  assertUniqueTourIds(ctx.ids, 'child', options.fail, `${at}: `);
  return { children, ids: ctx.ids };
}

/** Whether a station's child is a story (else it is a free block). */
export function isTourStory(child: TourStationChild): child is TourStory {
  return child.kind === 'story';
}

/** Whether a story's child is a block (else a choice or a quiz). */
export function isTourStoryBlock(
  child: TourStoryChild
): child is TourStoryBlock {
  return child.kind !== 'choice' && child.kind !== 'quiz';
}

/** The stories of a children list, in its order. */
export function tourChildrenStories(
  children: readonly TourStationChild[]
): TourStory[] {
  return children.filter(isTourStory);
}

/** The free blocks of a children list (they stand in the world), in its
 *  order. */
export function tourChildrenFreeBlocks(
  children: readonly TourStationChild[]
): TourBlock[] {
  return children.filter((c): c is TourBlock => !isTourStory(c));
}

/** The blocks of a story's children, in its order. */
export function tourStoryChildrenBlocks(
  children: readonly TourStoryChild[]
): TourStoryBlock[] {
  return children.filter(isTourStoryBlock);
}

/** Every block of a children list, free and in stories, each once, in
 *  document order. */
export function tourChildrenBlocks(
  children: readonly TourStationChild[]
): (TourBlock | TourStoryBlock)[] {
  return children.flatMap((c) =>
    isTourStory(c) ? tourStoryChildrenBlocks(c.children) : [c]
  );
}

/** Where a child is: its index in the station's list, or its story and its
 *  index there. */
export interface TourChildrenPlace {
  readonly index: number;
  readonly story?: TourStory;
}

/** The place of the child with `id` in a children list; null when none
 *  has it. */
export function tourChildrenPlace(
  children: readonly TourStationChild[],
  id: string
): TourChildrenPlace | null {
  for (const [index, child] of children.entries()) {
    if (child.id === id) return { index };
    if (!isTourStory(child)) continue;
    const inStory = child.children.findIndex((c) => c.id === id);
    if (inStory >= 0) return { index: inStory, story: child };
  }
  return null;
}

/** Child ids are unique across the tour, not only within a station: one
 *  read per station, its `ids` - so an id a lenient read left out still
 *  counts, as it does within the station. */
export function checkTourChildIdsUnique(
  stations: readonly Pick<TourStationChildrenRead, 'ids'>[],
  fail: TourFail
): void {
  assertUniqueTourIds(
    stations.flatMap((s) => s.ids),
    'child',
    fail
  );
}

/** A station's stories, in its order. */
export function tourStories(
  station: Pick<TourStationHolder, 'children'>
): TourStory[] {
  return tourChildrenStories(station.children);
}

/** A story's blocks, in its order. */
export function tourStoryBlocks(story: TourStory): TourStoryBlock[] {
  return tourStoryChildrenBlocks(story.children);
}

/** Every block of a station's stories, in document order. */
export function tourStationStoryBlocks(
  station: Pick<TourStationHolder, 'children'>
): TourStoryBlock[] {
  return tourStories(station).flatMap(tourStoryBlocks);
}

/** Every block of a station, free and in stories, each once, in document
 *  order. */
export function tourStationBlocks(
  station: Pick<TourStationHolder, 'children'>
): (TourBlock | TourStoryBlock)[] {
  return tourChildrenBlocks(station.children);
}

/** Every id of a station's children, stories and the children of stories
 *  included, in document order: one namespace across the tour. */
export function tourStationChildIds(
  station: Pick<TourStationHolder, 'children'>
): string[] {
  return station.children.flatMap((child) =>
    isTourStory(child)
      ? [child.id, ...child.children.map((c) => c.id)]
      : [child.id]
  );
}

/** Where a child of a tour stands. */
export interface TourChildPlace<S> extends TourChildrenPlace {
  readonly station: S;
}

/** The place of the child with `id` in `manifest`; null when none has it. */
export function tourChildPlace<S extends TourStationHolder>(
  manifest: { readonly stations: readonly S[] },
  id: string
): TourChildPlace<S> | null {
  for (const station of manifest.stations) {
    const place = tourChildrenPlace(station.children, id);
    if (place !== null) return { ...place, station };
  }
  return null;
}
