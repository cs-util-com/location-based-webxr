/**
 * A station's STORY in `tour.json` version 4: the order of what a visitor
 * meets at a station and what they are asked. A step either SHOWS one of
 * the station's blocks (`tour-blocks.ts`), asks a CHOICE, or asks a QUIZ;
 * all content lives in the blocks. Read together with the station's
 * blocks ({@link parseTourStationContent}), because each decides the
 * other: a `show` step must name a block of this station, and a block no
 * step shows is free and must stand in the world.
 *
 * Not wired yet: the manifest still reads and writes version 3 (whose
 * steps carry their content inline, `tour-stations.ts`). The quiz and the
 * advance rule are that module's, so both versions read them alike.
 *
 * - `show`: names a block of THIS station. Naming another station's block,
 *   or none, fails the file. Two steps may show one block.
 * - `choice`: a prompt and at least two options; an option's `goto` names
 *   a step of this station, or is absent - then the scene continues at the
 *   next step. A `goto` naming no step fails the file.
 * - `quiz`: question, points and answer as in version 3. There is no
 *   `route` (the walk is not branched by answers in version 4); a `route`
 *   field is an unknown field and ignored.
 *
 * LENIENT for a NEWER MINOR (as `tour-blocks.ts`): a step of an unknown
 * kind, a quiz of an unknown answer type, and a `show` naming a block this
 * reader skipped are left out; a choice then keeps only the options whose
 * step is still there (an option with no `goto` always is), and a choice
 * left with fewer than two goes too - repeated, since that can strand
 * another. A block left free by a skipped step must still stand in the
 * world, or it is skipped and reported. So no `show` ever names a block the
 * reader left out.
 *
 * @see tour-story.ts.md
 */

import { isRecord } from '../utils/json-guards.js';
import { TOUR_ID_PATTERN } from './tour-archive.js';
import {
  placeTourBlocks,
  readTourBlocks,
  type TourBlock,
  type TourBlocksReadOptions,
} from './tour-blocks.js';
import {
  parseTourQuiz,
  parseTourStepAdvance,
  type TourQuiz,
  type TourStepAdvance,
} from './tour-stations.js';

type Fail = (message: string) => never;

/** One way on from a choice. */
export interface TourStoryOption {
  readonly id: string;
  readonly label: string;
  /** A step of this station; absent: the next step. */
  readonly goto?: string;
}

/** What a story step does. */
export type TourStoryAction =
  | { readonly kind: 'show'; readonly block: string }
  | {
      readonly kind: 'choice';
      readonly prompt: string;
      readonly options: readonly TourStoryOption[];
    }
  | ({ readonly kind: 'quiz' } & TourQuiz);

export interface TourStoryStep {
  readonly id: string;
  readonly action: TourStoryAction;
  readonly advance: TourStepAdvance;
}

/** A station's blocks and its story, read together. */
export interface TourStationContent {
  readonly blocks: readonly TourBlock[];
  readonly steps: readonly TourStoryStep[];
}

/** Thrown inside a step's read when a lenient reader cannot show it;
 *  caught per step. Never escapes this module. */
class SkippedStep extends Error {}

interface StoryContext {
  readonly fail: Fail;
  readonly lenient: boolean;
  /** The ids of the blocks read. */
  readonly blocks: ReadonlySet<string>;
  /** Every block id the file names, the skipped ones included. */
  readonly namedBlocks: ReadonlySet<string>;
}

function requireId(value: unknown, at: string, fail: Fail): string {
  if (typeof value !== 'string' || !TOUR_ID_PATTERN.test(value)) {
    return fail(`"${at}" must be a short path-safe id`);
  }
  return value;
}

function requireText(value: unknown, at: string, fail: Fail): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return fail(`"${at}" must be a non-empty string`);
  }
  return value;
}

function assertUnique(ids: readonly string[], what: string, fail: Fail): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail(`duplicate ${what} id "${id}"`);
    seen.add(id);
  }
}

function parseShow(
  v: Record<string, unknown>,
  at: string,
  ctx: StoryContext
): TourStoryAction {
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

function parseOption(value: unknown, at: string, fail: Fail): TourStoryOption {
  if (!isRecord(value)) return fail(`"${at}" must be an object`);
  return {
    id: requireId(value.id, `${at}.id`, fail),
    label: requireText(value.label, `${at}.label`, fail),
    ...(value.goto === undefined
      ? {}
      : { goto: requireId(value.goto, `${at}.goto`, fail) }),
  };
}

function parseChoice(
  v: Record<string, unknown>,
  at: string,
  fail: Fail
): TourStoryAction {
  const prompt = requireText(v.prompt, `${at}.prompt`, fail);
  if (!Array.isArray(v.options))
    return fail(`"${at}.options" must be an array`);
  const options = (v.options as unknown[]).map((o, i) =>
    parseOption(o, `${at}.options[${String(i)}]`, fail)
  );
  if (options.length < 2) fail(`"${at}.options" must list at least 2 options`);
  assertUnique(
    options.map((o) => o.id),
    'option',
    fail
  );
  return { kind: 'choice', prompt, options };
}

function parseAction(
  value: unknown,
  at: string,
  ctx: StoryContext
): TourStoryAction {
  if (!isRecord(value)) return ctx.fail(`"${at}" must be an object`);
  switch (value.kind) {
    case 'show':
      return parseShow(value, at, ctx);
    case 'choice':
      return parseChoice(value, at, ctx.fail);
    case 'quiz': {
      const quiz = parseTourQuiz(value, at, ctx);
      if (quiz === null) throw new SkippedStep();
      return { kind: 'quiz', ...quiz };
    }
    default:
      if (ctx.lenient) throw new SkippedStep();
      return ctx.fail(`"${at}.kind" must be show, choice or quiz`);
  }
}

/** A step, or null when a lenient reader cannot show it; its id either
 *  way (a choice may name a skipped step). */
function parseStep(
  value: unknown,
  at: string,
  ctx: StoryContext
): { id: string; step: TourStoryStep | null } {
  if (!isRecord(value)) return ctx.fail(`"${at}" must be an object`);
  const id = requireId(value.id, `${at}.id`, ctx.fail);
  let action: TourStoryAction;
  try {
    action = parseAction(value.action, `${at}.action`, ctx);
  } catch (err) {
    if (err instanceof SkippedStep) return { id, step: null };
    throw err;
  }
  const advance = parseTourStepAdvance(value.advance, `${at}.advance`, ctx);
  return { id, step: { id, action, advance } };
}

/** Every `goto` names a step of the station (the skipped ones included).
 *  `read` holds every step of the file, null where a lenient reader
 *  skipped one, so a failure names the step by its index in the file. */
function checkGotos(
  read: readonly { readonly step: TourStoryStep | null }[],
  stepIds: ReadonlySet<string>,
  at: string,
  fail: Fail
): void {
  read.forEach(({ step }, i) => {
    if (step?.action.kind !== 'choice') return;
    step.action.options.forEach((option, o) => {
      if (option.goto !== undefined && !stepIds.has(option.goto)) {
        fail(
          `"${at}[${String(i)}].action.options[${String(o)}].goto" must name a step of this station`
        );
      }
    });
  });
}

/**
 * After a lenient reader skipped steps: a choice keeps the options whose
 * step is still there (no `goto`: always), and a choice left with fewer
 * than two is skipped too - repeated, because skipping a choice can strand
 * another that jumped to it. Ends: every round removes something.
 */
function withoutStrandedChoices(
  steps: readonly TourStoryStep[]
): TourStoryStep[] {
  let kept = [...steps];
  for (;;) {
    const ids = new Set(kept.map((s) => s.id));
    let changed = false;
    const next = kept.flatMap((step): TourStoryStep[] => {
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

function readSteps(
  value: unknown,
  at: string,
  ctx: StoryContext
): TourStoryStep[] {
  if (!Array.isArray(value)) return ctx.fail(`"${at}" must be an array`);
  const read = (value as unknown[]).map((s, i) =>
    parseStep(s, `${at}[${String(i)}]`, ctx)
  );
  const ids = read.map((r) => r.id);
  assertUnique(ids, 'step', ctx.fail);
  const steps = read.flatMap((r) => (r.step === null ? [] : [r.step]));
  checkGotos(read, new Set(ids), at, ctx.fail);
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
  const fail: Fail = options.fail;
  if (!isRecord(value)) return fail(`"${at}" must be an object`);
  const lenient = options.lenient === true;
  const read = readTourBlocks(value.blocks, `${at}.blocks`, options);
  const steps = readSteps(value.steps, `${at}.steps`, {
    fail,
    lenient,
    blocks: new Set(read.map((r) => r.block.id)),
    namedBlocks: namedBlockIds(value.blocks),
  });
  const shown = new Set(
    steps.flatMap((s) => (s.action.kind === 'show' ? [s.action.block] : []))
  );
  return { blocks: placeTourBlocks(read, shown, options), steps };
}

function defaultFail(message: string): never {
  throw new Error(`tour-story: ${message}`);
}

/**
 * A station's content as a writer writes it: `content` re-read strictly
 * through {@link parseTourStationContent}, so a programming error fails
 * loud here instead of producing a file a visitor cannot open - including
 * any value a reader would leave out (an optional text over its cap). The
 * result is ready for `JSON.stringify`.
 */
export function serializeTourStationContent(
  content: TourStationContent,
  options: {
    readonly assets: TourBlocksReadOptions['assets'];
    readonly fail?: Fail;
  }
): TourStationContent {
  const fail = options.fail ?? defaultFail;
  return parseTourStationContent(
    JSON.parse(JSON.stringify(content)) as unknown,
    'content',
    {
      assets: options.assets,
      fail,
      onDropped: (drop) => fail(drop.reason),
    }
  );
}
