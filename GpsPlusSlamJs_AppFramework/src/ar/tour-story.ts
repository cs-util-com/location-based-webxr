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
 * - `advance`: how a step moves on - a tap (also when absent), or by
 *   itself after some seconds.
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
 * @see tour-story.ts.md
 */

import { isFiniteNumber, isRecord } from '../utils/json-guards.js';
import {
  placeTourBlocks,
  readTourBlocks,
  type TourBlock,
  type TourBlocksReadOptions,
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
  { readonly mode: 'tap' } | { readonly mode: 'auto'; readonly afterS: number };

/** One way on from a choice. */
export interface TourChoiceOption {
  readonly id: string;
  readonly label: string;
  /** A step of this station; absent: the next step. */
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
  if (value.mode !== 'auto') {
    // A newer minor's mode: the visitor taps on, as with no rule at all.
    if (options.lenient) return { mode: 'tap' };
    return fail(`"${at}.mode" must be "tap" or "auto"`);
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

function parseChoice(
  v: Record<string, unknown>,
  at: string,
  fail: TourFail
): TourStepAction {
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
