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
 *   a non-zero integer to a counter. A CHOSEN option is all or nothing: if
 *   the whole list would end any counter below its floor, or an effect
 *   names something the game cannot apply, the option is unavailable and
 *   nothing changes. A QUIZ outcome is forced (the visitor answered): it
 *   clamps at the floor and skips what it cannot apply, so a cost never
 *   greys out an answer and gives it away.
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
  /** Not listed in the inventory until held. Default false. */
  readonly secret?: boolean;
}

interface TourGameCounter {
  readonly id: string;
  readonly name: string;
  readonly keep: TourGameKeep;
  /** The value a run (and, for a round counter, each round) starts at. */
  readonly start: number;
  /** The lowest value the counter may take. */
  readonly floor: number;
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

interface TourGameInventoryLabel {
  readonly id: string;
  readonly name: string;
  readonly keep: TourGameKeep;
  readonly secret: boolean;
  readonly held: boolean;
  /** `greyed`: not held; `hidden`: not held and secret. */
  readonly shown: 'held' | 'greyed' | 'hidden';
}

interface TourGameInventoryCounter {
  readonly id: string;
  readonly name: string;
  readonly keep: TourGameKeep;
  readonly value: number;
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

/**
 * Whether a station, item, step or option is available now, and if not,
 * why: the first failing requirement, else (for an option) the first
 * effect the game cannot apply, else the first counter its effects would
 * end below the floor, with how much is missing.
 */
export function availability(
  game: TourGame,
  state: TourGameRunState,
  target: {
    readonly requires?: readonly TourGameCondition[];
    readonly effects?: readonly TourGameEffect[];
  }
): TourGameAvailability {
  const condition = failingCondition(game, state, target.requires);
  if (condition !== undefined) {
    return { available: false, reason: { kind: 'requires', condition } };
  }
  const effects = target.effects ?? [];
  const invalid = effects.find((e) => !isApplicable(game, e));
  if (invalid !== undefined) {
    return {
      available: false,
      reason: { kind: 'invalid-effect', effect: invalid },
    };
  }
  const { counters } = applyRaw(game, state, effects);
  // Only the counters this option changes: a counter already below its
  // floor (a malformed state) does not block options that leave it alone.
  const touched = new Set(effects.flatMap((e) => ('add' in e ? [e.add] : [])));
  for (const counter of game.counters) {
    if (!touched.has(counter.id)) continue;
    const value = counters.get(counter.id) ?? counter.start;
    if (value < counter.floor) {
      return {
        available: false,
        reason: {
          kind: 'floor',
          counter: counter.id,
          need: counter.floor - value,
        },
      };
    }
  }
  return { available: true };
}

/** Pick a scene choice's option: all or nothing (see the module comment). */
export function chooseOption(
  game: TourGame,
  state: TourGameRunState,
  option: TourGameOption
): TourGameChoice {
  const verdict = availability(game, state, option);
  if (!verdict.available) return { ok: false, reason: verdict.reason };
  const { labels, counters } = applyRaw(game, state, option.effects ?? []);
  return { ok: true, state: stateFrom(game, state.round, labels, counters) };
}

/** Apply a quiz answer's outcome: forced, so clamped at each floor, and an
 *  effect the game cannot apply is skipped. */
export function answerQuiz(
  game: TourGame,
  state: TourGameRunState,
  outcomes: TourGameQuizOutcomes,
  correct: boolean
): TourGameRunState {
  const effects = (correct ? outcomes.correct : outcomes.wrong) ?? [];
  const { labels, counters } = applyRaw(game, state, effects);
  for (const counter of game.counters) {
    const value = counters.get(counter.id) ?? counter.start;
    counters.set(counter.id, Math.max(counter.floor, value));
  }
  return stateFrom(game, state.round, labels, counters);
}

/** The first step at or after `from` whose requirements hold now, or -1
 *  (the scene ends). A step whose requirement fails is passed over. */
export function nextAvailableStep(
  game: TourGame,
  state: TourGameRunState,
  steps: readonly TourGameStep[],
  from: number
): number {
  if (Number.isNaN(from)) return -1;
  for (let i = Math.max(0, Math.ceil(from)); i < steps.length; i += 1) {
    if (failingCondition(game, state, steps[i]!.requires) === undefined) {
      return i;
    }
  }
  return -1;
}

/** Every label (in declaration order) and every counter, as the
 *  inventory shows them. */
export function inventory(
  game: TourGame,
  state: TourGameRunState
): TourGameInventory {
  return {
    labels: game.labels.map((label) => {
      const held = isHeld(state, label.id);
      const secret = label.secret === true;
      return {
        id: label.id,
        name: label.name,
        keep: label.keep,
        secret,
        held,
        shown: held ? 'held' : secret ? 'hidden' : 'greyed',
      };
    }),
    counters: game.counters.map((counter) => ({
      id: counter.id,
      name: counter.name,
      keep: counter.keep,
      value: valueOf(state, counter),
    })),
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
