/**
 * Simple game rules for a tour: LABELS a visitor holds or not (a path, a
 * key, a sword) and COUNTERS (coins), what content REQUIRES of them, what
 * an answer's EFFECTS change, the inventory, and a second round.
 *
 * - A label is `collectible` (kept by the next round) or `round` (forgotten
 *   by it), and may be `secret` (not listed until held).
 * - A counter is an integer with a `start` and a `floor`; it never goes
 *   below its floor.
 * - A requirement list holds when ALL its conditions hold: `has` a label,
 *   `lacks` a label, a counter `atLeast` n. A condition naming an id the
 *   game does not declare never holds (`lacks` included), so a typo hides
 *   content instead of revealing it.
 * - Effects apply in order: `set` and `clear` a label (idempotent), `add`
 *   a non-zero integer to a counter. An OPTION - a scene choice's option or
 *   a quiz answer alike - is all or nothing: if the whole list would end
 *   any counter it changes below its floor, or an effect names something
 *   the game cannot apply, the option is unavailable and nothing changes.
 * - An unavailable option is shown GREYED with what it needs when every
 *   label and counter blocking it is visible, and HIDDEN when any of them
 *   is `secret` (or the game cannot read what blocks it).
 * - A TYPED quiz (text, code, number) has one input for both outcomes: it
 *   is judged on both together, available only when either could be paid,
 *   else greyed or hidden as a whole (`quizInputDisplay`).
 * - A scene continues after a step at `stepAfter`: an option's `goto` (the
 *   first step with that id), else the next step; a `goto` naming no step
 *   ends the scene.
 *
 * Pure and dependency-free: every function takes the game and a run state
 * and returns a new state; nothing is cached, so a condition is always
 * judged at the moment of use. The types are this module's own, not the
 * tour file's: the file format does not carry game rules yet.
 *
 * @see tour-game-rules.ts.md
 */

/** Whether a label or counter survives into the next round. */
type TourGameKeep = 'collectible' | 'round';

interface TourGameLabel {
  readonly id: string;
  /** Shown in the inventory. */
  readonly name: string;
  readonly keep: TourGameKeep;
  /** Not listed in the inventory until held, and an option it blocks is
   *  hidden rather than greyed. Default false. */
  readonly secret?: boolean;
}

interface TourGameCounter {
  readonly id: string;
  readonly name: string;
  readonly keep: TourGameKeep;
  /** The value a run (and, for a round counter, each round) starts at. */
  readonly start: number;
  /** The lowest value the counter may take (the parser fills in 0). */
  readonly floor: number;
  /** Not shown in the inventory, and an option it blocks is hidden rather
   *  than greyed. Default false. */
  readonly secret?: boolean;
}

/** A state, judged while it lasts. */
export type TourGameCondition =
  | { readonly has: string }
  | { readonly lacks: string }
  | { readonly counter: string; readonly atLeast: number };

/** A change, made when an answer is given. */
export type TourGameEffect =
  | { readonly set: string }
  | { readonly clear: string }
  | { readonly add: string; readonly by: number };

/** An answer option of a scene choice. */
export interface TourGameOption {
  readonly id: string;
  readonly requires?: readonly TourGameCondition[];
  readonly effects?: readonly TourGameEffect[];
  /** The step of the same station the scene continues at; absent, the
   *  step after the choice. */
  readonly goto?: string;
}

/** What a quiz answer changes, by whether it was right. */
export interface TourGameQuizOutcomes {
  readonly correct?: readonly TourGameEffect[];
  readonly wrong?: readonly TourGameEffect[];
}

/** A scene step as the rules see it: shown content, a choice, or a quiz. */
export type TourGameStep =
  | {
      readonly id: string;
      readonly kind: 'content';
      readonly requires?: readonly TourGameCondition[];
    }
  | {
      readonly id: string;
      readonly kind: 'choice';
      readonly requires?: readonly TourGameCondition[];
      readonly options: readonly TourGameOption[];
    }
  | {
      readonly id: string;
      readonly kind: 'quiz';
      readonly requires?: readonly TourGameCondition[];
      readonly outcomes: TourGameQuizOutcomes;
      /** Answered by typing (text, code, number) rather than by picking
       *  an option: one input for both outcomes. Default false. */
      readonly typed?: boolean;
    };

/** A placed item (pin, photo, model) as the rules see it. */
interface TourGameItem {
  readonly id: string;
  readonly requires?: readonly TourGameCondition[];
}

export interface TourGameStation {
  readonly id: string;
  readonly requires?: readonly TourGameCondition[];
  readonly steps: readonly TourGameStep[];
  readonly items?: readonly TourGameItem[];
}

/** A tour's game: what it declares and where conditions and effects sit.
 *  Labels and counters share one id namespace. */
export interface TourGame {
  readonly labels: readonly TourGameLabel[];
  readonly counters: readonly TourGameCounter[];
  readonly stations: readonly TourGameStation[];
}

/** A visitor's game state. JSON-safe: labels as a sorted list of unique
 *  ids, counters as an id-to-integer record. */
export interface TourGameRunState {
  /** 1 for the first round. */
  readonly round: number;
  readonly labels: readonly string[];
  readonly counters: Readonly<Record<string, number>>;
}

/** Why something is unavailable. `need` is how much more of the counter
 *  the option would take. */
type TourGameBlock =
  | { readonly kind: 'requires'; readonly condition: TourGameCondition }
  | { readonly kind: 'invalid-effect'; readonly effect: TourGameEffect }
  | { readonly kind: 'floor'; readonly counter: string; readonly need: number };

export type TourGameAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: TourGameBlock };

export type TourGameChoice =
  | { readonly ok: true; readonly state: TourGameRunState }
  | { readonly ok: false; readonly reason: TourGameBlock };

/** One thing a greyed option needs: a label held, a label gone, or `need`
 *  more of a counter. */
type TourGameNeed =
  | { readonly has: string }
  | { readonly lacks: string }
  | { readonly counter: string; readonly need: number };

/** How an option shows: takeable, greyed with every need, or hidden. */
export type TourGameDisplay =
  | { readonly shown: 'available' }
  | { readonly shown: 'greyed'; readonly needs: readonly TourGameNeed[] }
  | { readonly shown: 'hidden' };

interface TourGameInventoryLabel {
  readonly id: string;
  readonly name: string;
  readonly keep: TourGameKeep;
  readonly secret: boolean;
  readonly held: boolean;
  /** `greyed`: a collectible not held; `hidden`: not held, and secret or
   *  a round label. */
  readonly shown: 'held' | 'greyed' | 'hidden';
}

interface TourGameInventoryCounter {
  readonly id: string;
  readonly name: string;
  readonly keep: TourGameKeep;
  readonly secret: boolean;
  readonly value: number;
  /** `hidden` for a secret counter. */
  readonly shown: 'value' | 'hidden';
}

export interface TourGameInventory {
  readonly labels: readonly TourGameInventoryLabel[];
  readonly counters: readonly TourGameInventoryCounter[];
}

// --- lookups ------------------------------------------------------------

function labelOf(game: TourGame, id: string): TourGameLabel | undefined {
  return game.labels.find((l) => l.id === id);
}

function counterOf(game: TourGame, id: string): TourGameCounter | undefined {
  return game.counters.find((c) => c.id === id);
}

/** A counter's value: its own entry in the state, else its start (a state
 *  saved before the counter existed). Never an inherited property. */
function valueOf(state: TourGameRunState, counter: TourGameCounter): number {
  const own = Object.hasOwn(state.counters, counter.id)
    ? state.counters[counter.id]
    : undefined;
  return typeof own === 'number' && Number.isFinite(own) ? own : counter.start;
}

function isHeld(state: TourGameRunState, id: string): boolean {
  return state.labels.includes(id);
}

/** Build a counters record; `Object.fromEntries` defines own properties,
 *  so an id such as "__proto__" is stored, not routed to a setter. */
function countersOf(
  game: TourGame,
  value: (counter: TourGameCounter) => number
): Record<string, number> {
  return Object.fromEntries(game.counters.map((c) => [c.id, value(c)]));
}

function sortedLabels(labels: Iterable<string>): string[] {
  return [...new Set(labels)].sort();
}

// --- conditions -----------------------------------------------------------

function conditionHolds(
  game: TourGame,
  state: TourGameRunState,
  condition: TourGameCondition
): boolean {
  if ('has' in condition) {
    return (
      labelOf(game, condition.has) !== undefined && isHeld(state, condition.has)
    );
  }
  if ('lacks' in condition) {
    return (
      labelOf(game, condition.lacks) !== undefined &&
      !isHeld(state, condition.lacks)
    );
  }
  const counter = counterOf(game, condition.counter);
  return (
    counter !== undefined &&
    Number.isFinite(condition.atLeast) &&
    valueOf(state, counter) >= condition.atLeast
  );
}

function failingCondition(
  game: TourGame,
  state: TourGameRunState,
  requires: readonly TourGameCondition[] | undefined
): TourGameCondition | undefined {
  return (requires ?? []).find((c) => !conditionHolds(game, state, c));
}

// --- effects --------------------------------------------------------------

/** Whether the game can apply this effect at all. */
function isApplicable(game: TourGame, effect: TourGameEffect): boolean {
  if ('set' in effect) return labelOf(game, effect.set) !== undefined;
  if ('clear' in effect) return labelOf(game, effect.clear) !== undefined;
  return (
    counterOf(game, effect.add) !== undefined &&
    Number.isInteger(effect.by) &&
    effect.by !== 0
  );
}

/** Apply the applicable effects in order, without any floor. */
function applyRaw(
  game: TourGame,
  state: TourGameRunState,
  effects: readonly TourGameEffect[]
): { labels: Set<string>; counters: Map<string, number> } {
  const labels = new Set(state.labels);
  const counters = new Map(game.counters.map((c) => [c.id, valueOf(state, c)]));
  for (const effect of effects) {
    if (!isApplicable(game, effect)) continue;
    if ('set' in effect) labels.add(effect.set);
    else if ('clear' in effect) labels.delete(effect.clear);
    else counters.set(effect.add, (counters.get(effect.add) ?? 0) + effect.by);
  }
  return { labels, counters };
}

function stateFrom(
  game: TourGame,
  round: number,
  labels: Iterable<string>,
  counters: ReadonlyMap<string, number>
): TourGameRunState {
  return {
    round,
    labels: sortedLabels(labels),
    counters: countersOf(game, (c) => counters.get(c.id) ?? c.start),
  };
}

// --- the public rules -------------------------------------------------------

/** A run's first state: round 1, no label held, every counter at start. */
export function startRun(game: TourGame): TourGameRunState {
  return { round: 1, labels: [], counters: countersOf(game, (c) => c.start) };
}

interface TourGameTarget {
  readonly requires?: readonly TourGameCondition[];
  readonly effects?: readonly TourGameEffect[];
}

/** Every reason the target is unavailable now, in this order: the failing
 *  requirements, the effects the game cannot apply, then each counter the
 *  effects' RESULT would end below its floor. Empty when available. */
function blocksOf(
  game: TourGame,
  state: TourGameRunState,
  target: TourGameTarget
): TourGameBlock[] {
  const out: TourGameBlock[] = (target.requires ?? [])
    .filter((condition) => !conditionHolds(game, state, condition))
    .map((condition) => ({ kind: 'requires', condition }));
  const effects = target.effects ?? [];
  for (const effect of effects) {
    if (!isApplicable(game, effect))
      out.push({ kind: 'invalid-effect', effect });
  }
  const { counters } = applyRaw(game, state, effects);
  // Only the counters this option changes: a counter already below its
  // floor (a malformed state) does not block options that leave it alone.
  const touched = new Set(effects.flatMap((e) => ('add' in e ? [e.add] : [])));
  for (const counter of game.counters) {
    if (!touched.has(counter.id)) continue;
    const value = counters.get(counter.id) ?? counter.start;
    if (value < counter.floor) {
      out.push({
        kind: 'floor',
        counter: counter.id,
        need: counter.floor - value,
      });
    }
  }
  return out;
}

/**
 * Whether a station, item, step or option is available now, and if not,
 * why: the first failing requirement, else (for an option) the first
 * effect the game cannot apply, else the first counter its effects would
 * end below the floor, with how much is missing.
 */
export function availability(
  game: TourGame,
  state: TourGameRunState,
  target: TourGameTarget
): TourGameAvailability {
  const [reason] = blocksOf(game, state, target);
  return reason === undefined
    ? { available: true }
    : { available: false, reason };
}

/** What a block asks of the visitor, or undefined when it must hide the
 *  option: it names a secret, or something the game cannot read (an
 *  undeclared name, an effect it cannot apply, a requirement that is no
 *  whole number). */
function needOf(
  game: TourGame,
  state: TourGameRunState,
  block: TourGameBlock
): TourGameNeed | undefined {
  if (block.kind === 'invalid-effect') return undefined;
  if (block.kind === 'floor') {
    return counterOf(game, block.counter)?.secret === true
      ? undefined
      : { counter: block.counter, need: block.need };
  }
  const c = block.condition;
  if ('has' in c) return labelNeed(game, c.has, { has: c.has });
  if ('lacks' in c) return labelNeed(game, c.lacks, { lacks: c.lacks });
  const counter = counterOf(game, c.counter);
  if (counter === undefined || counter.secret === true) return undefined;
  if (!Number.isInteger(c.atLeast)) return undefined;
  return { counter: c.counter, need: c.atLeast - valueOf(state, counter) };
}

/** A label condition's need, unless the label is undeclared or secret. */
function labelNeed(
  game: TourGame,
  id: string,
  need: TourGameNeed
): TourGameNeed | undefined {
  const label = labelOf(game, id);
  return label === undefined || label.secret === true ? undefined : need;
}

/** Add a need, one entry per label condition and per counter (the larger
 *  shortfall: meeting it meets both). */
function addNeed(needs: TourGameNeed[], need: TourGameNeed): void {
  const same = (n: TourGameNeed): boolean =>
    'counter' in need
      ? 'counter' in n && n.counter === need.counter
      : 'has' in need
        ? 'has' in n && n.has === need.has
        : 'lacks' in n && n.lacks === need.lacks;
  const at = needs.findIndex(same);
  if (at < 0) needs.push(need);
  else if ('counter' in need) {
    const old = needs[at]!;
    if ('counter' in old && need.need > old.need) needs[at] = need;
  }
}

/** A list that both has and lacks one label can never hold. */
function contradicts(
  requires: readonly TourGameCondition[] | undefined
): boolean {
  const list = requires ?? [];
  return list.some(
    (c) => 'has' in c && list.some((d) => 'lacks' in d && d.lacks === c.has)
  );
}

/**
 * How an option (a choice's option or a quiz answer) shows now: available;
 * greyed with every need when each label and counter blocking it is
 * visible; hidden when any of them is secret, when the game cannot read
 * what blocks it, or when its requirement contradicts itself (no need
 * would ever be enough).
 */
export function optionDisplay(
  game: TourGame,
  state: TourGameRunState,
  target: TourGameTarget
): TourGameDisplay {
  const blocks = blocksOf(game, state, target);
  if (blocks.length === 0) return { shown: 'available' };
  if (contradicts(target.requires)) return { shown: 'hidden' };
  const needs: TourGameNeed[] = [];
  for (const block of blocks) {
    const need = needOf(game, state, block);
    if (need === undefined) return { shown: 'hidden' };
    addNeed(needs, need);
  }
  return { shown: 'greyed', needs };
}

/**
 * How a typed quiz's input (text, code, number) shows now. The outcome is
 * known only once the visitor submits, so the input is judged on both
 * outcomes together: available when either could be paid; otherwise
 * hidden when either outcome is hidden, else greyed with both outcomes'
 * needs merged (per counter the larger shortfall).
 */
export function quizInputDisplay(
  game: TourGame,
  state: TourGameRunState,
  outcomes: TourGameQuizOutcomes
): TourGameDisplay {
  const verdicts = [outcomes.correct, outcomes.wrong].map((effects) =>
    optionDisplay(game, state, { effects: effects ?? [] })
  );
  if (verdicts.some((v) => v.shown === 'hidden')) return { shown: 'hidden' };
  const needs: TourGameNeed[] = [];
  for (const v of verdicts) {
    if (v.shown === 'greyed') for (const n of v.needs) addNeed(needs, n);
  }
  return needs.length === 0
    ? { shown: 'available' }
    : { shown: 'greyed', needs };
}

/** Take an option: all or nothing. */
function take(
  game: TourGame,
  state: TourGameRunState,
  target: TourGameTarget
): TourGameChoice {
  const verdict = availability(game, state, target);
  if (!verdict.available) return { ok: false, reason: verdict.reason };
  const { labels, counters } = applyRaw(game, state, target.effects ?? []);
  return { ok: true, state: stateFrom(game, state.round, labels, counters) };
}

/** Pick a scene choice's option: all or nothing (see the module comment). */
export function chooseOption(
  game: TourGame,
  state: TourGameRunState,
  option: TourGameOption
): TourGameChoice {
  return take(game, state, option);
}

/** Give a quiz answer, right or wrong: the outcome is an option like any
 *  other, all or nothing, so an answer whose cost the visitor cannot pay
 *  is refused and changes nothing. */
export function answerQuiz(
  game: TourGame,
  state: TourGameRunState,
  outcomes: TourGameQuizOutcomes,
  correct: boolean
): TourGameChoice {
  const effects = (correct ? outcomes.correct : outcomes.wrong) ?? [];
  return take(game, state, { effects });
}

/** Where a scene continues after step `from`: the option's `goto` (the
 *  first step with that id), else the next step; -1 when the scene ends,
 *  which a `goto` naming no step and a `from` that is no step index do. */
export function stepAfter(
  steps: readonly TourGameStep[],
  from: number,
  option?: { readonly goto?: string }
): number {
  if (!Number.isInteger(from) || from < 0 || from >= steps.length) return -1;
  if (option?.goto !== undefined) {
    return steps.findIndex((s) => s.id === option.goto);
  }
  return from + 1 < steps.length ? from + 1 : -1;
}

/** The first step at or after `from` whose requirements hold now, or -1
 *  (the scene ends). A step whose requirement fails is passed over; a
 *  `from` below 0 (the scene has ended) or NaN stays -1. */
export function nextAvailableStep(
  game: TourGame,
  state: TourGameRunState,
  steps: readonly TourGameStep[],
  from: number
): number {
  if (!(from >= 0)) return -1;
  for (let i = Math.ceil(from); i < steps.length; i += 1) {
    if (failingCondition(game, state, steps[i]!.requires) === undefined) {
      return i;
    }
  }
  return -1;
}

/** Every label (in declaration order) and every counter, as the
 *  inventory shows them: a collectible not held greyed unless secret, a
 *  round label only while held, a counter's value unless secret. */
export function inventory(
  game: TourGame,
  state: TourGameRunState
): TourGameInventory {
  return {
    labels: game.labels.map((label) => {
      const held = isHeld(state, label.id);
      const secret = label.secret === true;
      const missing = secret || label.keep === 'round' ? 'hidden' : 'greyed';
      return {
        id: label.id,
        name: label.name,
        keep: label.keep,
        secret,
        held,
        shown: held ? 'held' : missing,
      };
    }),
    counters: game.counters.map((counter) => {
      const secret = counter.secret === true;
      return {
        id: counter.id,
        name: counter.name,
        keep: counter.keep,
        secret,
        value: valueOf(state, counter),
        shown: secret ? 'hidden' : 'value',
      };
    }),
  };
}

/** The next round: exactly the held collectible labels and the
 *  collectible counters' values are kept; round labels are dropped and
 *  round counters start again. */
export function startNextRound(
  game: TourGame,
  state: TourGameRunState
): TourGameRunState {
  return {
    round: state.round + 1,
    labels: sortedLabels(
      state.labels.filter((id) => labelOf(game, id)?.keep === 'collectible')
    ),
    counters: countersOf(game, (c) =>
      c.keep === 'collectible' ? valueOf(state, c) : c.start
    ),
  };
}
