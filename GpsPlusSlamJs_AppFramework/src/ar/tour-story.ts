/**
 * A station's STORY in `tour.json` version 4: the order of what a visitor
 * meets at a station and what they are asked. A step either SHOWS one of
 * the station's blocks (`tour-blocks.ts`), asks a CHOICE, or asks a QUIZ;
 * all content lives in the blocks. Read together with the station's
 * blocks ({@link parseTourStationContent}), because each decides the
 * other: a `show` step must name a block of this station, and a block no
 * step shows is free and must stand in the world.
 *
 * - `show`: names a block of THIS station. Naming another station's block,
 *   or none, fails the file. Two steps may show one block.
 * - `choice`: a prompt and at least two options; an option's `goto` names
 *   a step of this station, or is absent - then the scene continues at the
 *   next step. A `goto` naming no step fails the file.
 * - `quiz`: question, points and answer. There is no `route` (the walk is
 *   not branched by answers); a `route` field is an unknown field and
 *   ignored.
 * - `advance`: how a step moves on - a tap (also when absent), by itself
 *   after some seconds, or (minor 2) by itself when its line ends: the
 *   step's voice or sound has played, or, with none, its words have had
 *   their time to be read (the viewer's rule).
 *
 * LENIENT for a NEWER MINOR (as `tour-blocks.ts`): a step of an unknown
 * kind, a quiz of an unknown answer type, and a `show` naming a block this
 * reader skipped are left out; a choice then keeps only the options whose
 * step is still there (an option with no `goto` always is), and a choice
 * left with fewer than two goes too - repeated, since that can strand
 * another. A block left free by a skipped step must still stand in the
 * world, or it is skipped and reported. So no `show` ever names a block the
 * reader left out. An unknown advance mode is a tap.
 *
 * VERSION 5, beside the version 4 reader and not yet wired into the
 * manifest: a station holds ONE ordered list of CHILDREN, each a free block
 * (standing in the world) or a STORY, which holds its own ordered list of
 * blocks, choices and quizzes ({@link parseTourStationChildren}). A block
 * lives in exactly one place, so being inside a story is what shows it: no
 * `show` step. Ids of blocks, stories, choices and quizzes are one
 * namespace; a choice's `goto` names a child of its own story. The order
 * of the file is kept as written: nothing assumes free blocks first.
 *
 * @see tour-story.ts.md
 */

import { isFiniteNumber, isRecord } from '../utils/json-guards.js';
import {
  checkTourBlockText,
  placeTourBlocks,
  readTourBlocks,
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
  /** Version 4: a step of this station; version 5: a child of the same
   *  story. Absent: the next one. */
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

/** What a story step does. */
export type TourStepAction =
  | { readonly kind: 'show'; readonly block: string }
  | {
      readonly kind: 'choice';
      readonly prompt: string;
      readonly options: readonly TourChoiceOption[];
    }
  | ({ readonly kind: 'quiz' } & TourQuiz);

/** A story step: what it does, and how it moves on. */
export interface TourStep {
  readonly id: string;
  readonly action: TourStepAction;
  readonly advance: TourStepAdvance;
}

/** A station's blocks and its story, read together. */
export interface TourStationContent {
  readonly blocks: readonly TourBlock[];
  readonly steps: readonly TourStep[];
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Thrown inside a step's read when a lenient reader cannot show it;
 *  caught per step. Never escapes this module. */
class SkippedStep extends Error {}

interface StoryContext {
  readonly fail: TourFail;
  readonly lenient: boolean;
  /** The ids of the blocks read. */
  readonly blocks: ReadonlySet<string>;
  /** Every block id the file names, the skipped ones included. */
  readonly namedBlocks: ReadonlySet<string>;
}

/** The ids of the blocks `steps` show: a station's STORY blocks. Every
 *  other block of the station is free (it stands in the world). */
export function tourShownBlockIds(
  steps: readonly TourStep[]
): ReadonlySet<string> {
  return new Set(
    steps.flatMap((s) => (s.action.kind === 'show' ? [s.action.block] : []))
  );
}

/** The lowest minor `steps` need: 2 when one moves on when its line
 *  ends; 0 otherwise. */
export function tourStepsMinor(steps: readonly TourStep[]): number {
  return steps.some((s) => s.advance.mode === 'lineEnd') ? 2 : 0;
}

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
 * not know the answer's type (a newer minor's): the step cannot be shown.
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

// --- steps ------------------------------------------------------------

/** How a step advances: tap when absent; a newer minor's mode reads as
 *  tap for a lenient reader. */
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

function parseShow(
  v: Record<string, unknown>,
  at: string,
  ctx: StoryContext
): TourStepAction {
  const block = v.block;
  if (typeof block === 'string' && ctx.blocks.has(block)) {
    return { kind: 'show', block };
  }
  // A block of this file the reader left out: the step goes with it.
  if (ctx.lenient && typeof block === 'string' && ctx.namedBlocks.has(block)) {
    throw new SkippedStep();
  }
  return ctx.fail(`"${at}.block" must name a block of this station`);
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

type ChoiceAction = Extract<TourStepAction, { kind: 'choice' }>;

function parseChoice(
  v: Record<string, unknown>,
  at: string,
  fail: TourFail
): ChoiceAction {
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

function parseAction(
  value: unknown,
  at: string,
  ctx: StoryContext
): TourStepAction {
  if (!isRecord(value)) return ctx.fail(`"${at}" must be an object`);
  switch (value.kind) {
    case 'show':
      return parseShow(value, at, ctx);
    case 'choice':
      return parseChoice(value, at, ctx.fail);
    case 'quiz': {
      const quiz = parseQuiz(value, at, ctx);
      if (quiz === null) throw new SkippedStep();
      return { kind: 'quiz', ...quiz };
    }
    default:
      if (ctx.lenient) throw new SkippedStep();
      return ctx.fail(`"${at}.kind" must be show, choice or quiz`);
  }
}

/** A step read: its id either way (a choice may name a skipped step), its
 *  index in the file, and the step - null when a lenient reader cannot
 *  show it. */
interface ReadStep {
  readonly id: string;
  readonly index: number;
  readonly step: TourStep | null;
}

function parseStep(
  value: unknown,
  index: number,
  at: string,
  ctx: StoryContext
): ReadStep {
  if (!isRecord(value)) return ctx.fail(`"${at}" must be an object`);
  const id = requireTourId(value.id, `${at}.id`, ctx.fail);
  let action: TourStepAction;
  try {
    action = parseAction(value.action, `${at}.action`, ctx);
  } catch (err) {
    if (err instanceof SkippedStep) return { id, index, step: null };
    throw err;
  }
  const advance = parseAdvance(value.advance, `${at}.advance`, ctx);
  return { id, index, step: { id, action, advance } };
}

/** Every `goto` names a step of the station (the skipped ones included);
 *  a failure names the step by its index in the FILE. */
function checkGotos(
  read: readonly ReadStep[],
  at: string,
  fail: TourFail
): void {
  const stepIds = new Set(read.map((r) => r.id));
  for (const { step, index } of read) {
    if (step?.action.kind !== 'choice') continue;
    step.action.options.forEach((option, o) => {
      if (option.goto !== undefined && !stepIds.has(option.goto)) {
        fail(
          `"${at}[${String(index)}].action.options[${String(o)}].goto" must name a step of this station`
        );
      }
    });
  }
}

/**
 * After a lenient reader skipped steps: a choice keeps the options whose
 * step is still there (no `goto`: always), and a choice left with fewer
 * than two is skipped too - repeated, because skipping a choice can strand
 * another that jumped to it. Ends: every round removes something.
 */
function withoutStrandedChoices(steps: readonly TourStep[]): TourStep[] {
  let kept = [...steps];
  for (;;) {
    const ids = new Set(kept.map((s) => s.id));
    let changed = false;
    const next = kept.flatMap((step): TourStep[] => {
      const { action } = step;
      if (action.kind !== 'choice') return [step];
      const options = action.options.filter(
        (o) => o.goto === undefined || ids.has(o.goto)
      );
      if (options.length === action.options.length) return [step];
      changed = true;
      return options.length < 2
        ? []
        : [{ ...step, action: { ...action, options } }];
    });
    if (!changed) return next;
    kept = next;
  }
}

function readSteps(value: unknown, at: string, ctx: StoryContext): TourStep[] {
  const read = requireTourArray(value, at, ctx.fail).map((s, i) =>
    parseStep(s, i, `${at}[${String(i)}]`, ctx)
  );
  assertUniqueTourIds(
    read.map((r) => r.id),
    'step',
    ctx.fail,
    `${at}: `
  );
  checkGotos(read, at, ctx.fail);
  const steps = read.flatMap((r) => (r.step === null ? [] : [r.step]));
  return ctx.lenient ? withoutStrandedChoices(steps) : steps;
}

/** The ids a station content's blocks carry, skipped or not. */
function namedBlockIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    (value as unknown[]).flatMap((b) =>
      isRecord(b) && typeof b.id === 'string' ? [b.id] : []
    )
  );
}

/**
 * Read one station's `blocks` and `steps` (from the record `value`, at
 * `at`): every block checked (`tour-blocks.ts`), every step resolved, and
 * every block no step shows standing in the world. Throws through `fail`
 * naming the first violation; a lenient reader (a newer minor) skips what
 * it cannot show and reports each skipped block through `onDropped`.
 */
export function parseTourStationContent(
  value: unknown,
  at: string,
  options: TourBlocksReadOptions
): TourStationContent {
  const { fail } = options;
  if (!isRecord(value)) return fail(`"${at}" must be an object`);
  const lenient = options.lenient === true;
  const read = readTourBlocks(value.blocks, `${at}.blocks`, options);
  const steps = readSteps(value.steps, `${at}.steps`, {
    fail,
    lenient,
    blocks: new Set(read.map((r) => r.block.id)),
    namedBlocks: namedBlockIds(value.blocks),
  });
  const shown = tourShownBlockIds(steps);
  return { blocks: placeTourBlocks(read, shown, options), steps };
}

// --- version 5: a station's children ----------------------------------

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
 *  (a story, choice or quiz it skipped included). */
export type TourChildDrop =
  | TourBlockDrop
  | { readonly kind: 'child'; readonly child: string; readonly reason: string };

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
  return placeTourBlocks([read], new Set(), ctx.options)[0] ?? null;
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
 * fewer than two goes too, reported - repeated, because dropping a choice
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
      if (options.length >= 2) return [{ ...child, options }];
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
): TourStationChild[] {
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
  return children;
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
export interface TourChildPlace {
  readonly index: number;
  readonly story?: TourStory;
}

/** The place of the child with `id` in a children list; null when none
 *  has it. */
export function tourChildrenPlace(
  children: readonly TourStationChild[],
  id: string
): TourChildPlace | null {
  for (const [index, child] of children.entries()) {
    if (child.id === id) return { index };
    if (!isTourStory(child)) continue;
    const inStory = child.children.findIndex((c) => c.id === id);
    if (inStory >= 0) return { index: inStory, story: child };
  }
  return null;
}

/** Every id of a children list, stories' children included, in document
 *  order. */
function childIds(children: readonly TourStationChild[]): string[] {
  return children.flatMap((c) =>
    isTourStory(c) ? [c.id, ...c.children.map((s) => s.id)] : [c.id]
  );
}

/** Child ids are unique across the tour, not only within a station: one
 *  children list per station, as read. */
export function checkTourChildIdsUnique(
  stations: readonly (readonly TourStationChild[])[],
  fail: TourFail
): void {
  assertUniqueTourIds(stations.flatMap(childIds), 'child', fail);
}
