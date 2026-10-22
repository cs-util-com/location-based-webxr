/**
 * The creator's checks over a tour's game rules (`tour-game-rules.ts`):
 * mistakes a visitor would otherwise find on site.
 *
 * STRUCTURAL findings are exact: a name declared twice (labels and
 * counters share one namespace), a condition or effect naming something
 * undeclared, a number that is not an integer (or a zero add), a counter
 * starting below its floor, a `goto` naming no step of its station, a
 * duplicate id, a label no effect anywhere sets.
 *
 * REACHABILITY findings come from a SOUND OVER-APPROXIMATION: a fixpoint
 * over what could ever be held, ignoring order, clears and timing (each
 * condition is judged alone, never jointly).
 *
 * - `P`, the labels that could be held: those set by an effect of
 *   reachable content.
 * - `max(c)`, an upper bound per counter: its start plus every positive
 *   add of reachable content, each once; unbounded when such an add can
 *   repeat (its step lies on a loop of the scene) or the counter is
 *   collectible (rounds add up).
 * - A condition could hold when: `has L` - L is in P; `lacks L` - always
 *   (nothing is held at the start); `atLeast n` - `max(c) >= n`. A list
 *   could hold when each condition could and it does not both have and
 *   lack one label.
 * - An option - a choice's option or a quiz outcome - could be available
 *   when its list could hold, its effects can be applied, and for each
 *   counter its effects lower by a net d, `max(c) - d >= floor`.
 * - Reachable: a station whose list could hold; its items whose list could
 *   hold; its steps the scene flow reaches (`stepAfter` of the rules: a
 *   step with a requirement may be passed over; a choice or quiz continues
 *   through each option that could be available, a `goto` naming no step
 *   ending the scene) whose list could hold; the options of reachable
 *   steps that could be available, which are the sources of effects.
 *
 * So everything reported `unreachable` or `option-never-available` is
 * unreachable in every walk of every round; content may be called
 * reachable that no walk reaches (two round labels one choice gives
 * exclusively). Only the outermost unreachable thing is reported: the
 * steps and items of an unreachable station are not listed again. A tour
 * whose declarations the rules could read differently (a name declared
 * twice, a counter starting below its floor or at no whole number) gets
 * its structural findings and no reachability verdict at all.
 *
 * `choice-may-softlock` is the opposite trade: a reachable choice or quiz
 * with no FREE option (no requirement, effects that apply, no counter
 * going down; or a pair of otherwise free options requiring `has L` and
 * `lacks L`) MAY leave the visitor with nothing to pick. It never misses
 * such a step, and the cure - one free option such as "leave" - is always
 * cheap. A typed quiz is one option with two outcomes: open only when both
 * could be paid, free only when neither costs.
 *
 * `quiz-may-give-answer-away` makes the same trade: a reachable choice
 * quiz (not typed) whose outcomes could each be paid but cost differently
 * on a visible counter, so at some value of it one outcome's answers are
 * greyed beside the other's and show which is right. It never misses a
 * quiz some walk reaches in that state (or the case where one outcome can
 * never be paid, which `option-never-available` reports instead).
 *
 * Pure and dependency-free; findings come in declaration order,
 * structural first. The input is a parsed game: every array present.
 *
 * @see tour-game-check.ts.md
 */

import {
  stepAfter,
  type TourGame,
  type TourGameCondition,
  type TourGameEffect,
  type TourGameOption,
  type TourGameStation,
  type TourGameStep,
} from './tour-game-rules.js';

/** Where a finding sits: a station, and in it an item, or a step and one
 *  of its options (a choice's by id, a quiz's by outcome). */
interface TourGameRef {
  readonly station: string;
  readonly item?: string;
  readonly step?: string;
  readonly option?: string;
  readonly outcome?: 'correct' | 'wrong';
}

/** Why something is unreachable or never available. `max` is the check's
 *  upper bound on the counter (always finite here). */
type TourGameCause =
  | { readonly kind: 'contradiction'; readonly label: string }
  | { readonly kind: 'label-never-set'; readonly label: string }
  | {
      readonly kind: 'label-set-only-by-unreachable-content';
      readonly label: string;
    }
  | {
      readonly kind: 'counter-out-of-reach';
      readonly counter: string;
      readonly atLeast: number;
      readonly max: number;
    }
  | { readonly kind: 'floor'; readonly counter: string; readonly max: number }
  | { readonly kind: 'unknown-name'; readonly name: string }
  | { readonly kind: 'bad-number' }
  | { readonly kind: 'scene-flow' };

type TourGameFinding =
  | { readonly kind: 'duplicate-name'; readonly name: string }
  | {
      readonly kind: 'duplicate-id';
      readonly id: string;
      /** null: two stations. */
      readonly within: TourGameRef | null;
    }
  | {
      readonly kind: 'unknown-name';
      readonly name: string;
      readonly at: TourGameRef;
    }
  | {
      readonly kind: 'bad-number';
      readonly field: 'start' | 'floor' | 'atLeast' | 'by';
      readonly at: TourGameRef | { readonly counter: string };
    }
  | { readonly kind: 'start-below-floor'; readonly counter: string }
  | {
      readonly kind: 'unknown-step';
      readonly step: string;
      readonly at: TourGameRef;
    }
  | { readonly kind: 'label-never-set'; readonly label: string }
  | {
      readonly kind: 'unreachable';
      readonly at: TourGameRef;
      readonly because: TourGameCause;
    }
  | {
      readonly kind: 'option-never-available';
      readonly at: TourGameRef;
      readonly because: TourGameCause;
    }
  | { readonly kind: 'choice-may-softlock'; readonly at: TourGameRef }
  | {
      readonly kind: 'quiz-may-give-answer-away';
      readonly at: TourGameRef;
      /** The visible counter its outcomes cost differently on. */
      readonly counter: string;
    };

/** Every finding for this game: structural first, then reachability. */
export function checkTourGame(game: TourGame): TourGameFinding[] {
  const names = new Names(game);
  const structural = structuralFindings(game, names);
  if (structural.some(isMisreadDeclaration)) return structural;
  return [...structural, ...reachabilityFindings(game, names)];
}

/** A declaration the rules could read differently from this check: no
 *  reachability verdict is sound until it is fixed. */
function isMisreadDeclaration(finding: TourGameFinding): boolean {
  return (
    finding.kind === 'duplicate-name' ||
    finding.kind === 'start-below-floor' ||
    (finding.kind === 'bad-number' && 'counter' in finding.at)
  );
}

// --- names --------------------------------------------------------------

/** The declared names, first declaration winning, as the rules read them. */
class Names {
  readonly labels = new Set<string>();
  readonly counters = new Map<string, TourGame['counters'][number]>();
  /** Every label some effect anywhere sets (reachable or not). */
  readonly setAnywhere = new Set<string>();

  constructor(game: TourGame) {
    for (const label of game.labels) this.labels.add(label.id);
    for (const counter of game.counters) {
      if (!this.counters.has(counter.id))
        this.counters.set(counter.id, counter);
    }
    const effects = game.stations.flatMap((s) =>
      s.steps.flatMap((step) => effectListsOf(step).flat())
    );
    for (const e of effects) if ('set' in e) this.setAnywhere.add(e.set);
  }

  /** The name an effect or condition uses that is not declared as what it
   *  is used as, if any. */
  unknownIn(entry: TourGameCondition | TourGameEffect): string | undefined {
    const { name, kind } = nameOf(entry);
    const known =
      kind === 'label' ? this.labels.has(name) : this.counters.has(name);
    return known ? undefined : name;
  }
}

/** The name a condition or effect uses, and as what. */
function nameOf(entry: TourGameCondition | TourGameEffect): {
  name: string;
  kind: 'label' | 'counter';
} {
  if ('has' in entry) return { name: entry.has, kind: 'label' };
  if ('lacks' in entry) return { name: entry.lacks, kind: 'label' };
  if ('set' in entry) return { name: entry.set, kind: 'label' };
  if ('clear' in entry) return { name: entry.clear, kind: 'label' };
  if ('counter' in entry) return { name: entry.counter, kind: 'counter' };
  return { name: entry.add, kind: 'counter' };
}

function effectListsOf(step: TourGameStep): (readonly TourGameEffect[])[] {
  if (step.kind === 'choice') return step.options.map((o) => o.effects ?? []);
  if (step.kind === 'quiz') {
    return [step.outcomes.correct ?? [], step.outcomes.wrong ?? []];
  }
  return [];
}

function isBadAdd(effect: TourGameEffect): boolean {
  return 'add' in effect && (!Number.isInteger(effect.by) || effect.by === 0);
}

// --- structural ------------------------------------------------------------

function duplicatesOf(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of ids) (seen.has(id) ? twice : seen).add(id);
  return [...twice];
}

function structuralFindings(game: TourGame, names: Names): TourGameFinding[] {
  const out: TourGameFinding[] = [];
  for (const name of duplicatesOf([
    ...game.labels.map((l) => l.id),
    ...game.counters.map((c) => c.id),
  ])) {
    out.push({ kind: 'duplicate-name', name });
  }
  for (const counter of game.counters) {
    const at = { counter: counter.id };
    if (!Number.isInteger(counter.start)) {
      out.push({ kind: 'bad-number', field: 'start', at });
    }
    if (!Number.isInteger(counter.floor)) {
      out.push({ kind: 'bad-number', field: 'floor', at });
    }
    if (counter.start < counter.floor) {
      out.push({ kind: 'start-below-floor', counter: counter.id });
    }
  }
  for (const id of duplicatesOf(game.stations.map((s) => s.id))) {
    out.push({ kind: 'duplicate-id', id, within: null });
  }
  for (const station of game.stations)
    out.push(...stationStructure(station, names));
  for (const label of game.labels) {
    if (!names.setAnywhere.has(label.id)) {
      out.push({ kind: 'label-never-set', label: label.id });
    }
  }
  return out;
}

function conditionFindings(
  requires: readonly TourGameCondition[] | undefined,
  at: TourGameRef,
  names: Names
): TourGameFinding[] {
  return (requires ?? []).flatMap((c): TourGameFinding[] => {
    const unknown = names.unknownIn(c);
    if (unknown !== undefined)
      return [{ kind: 'unknown-name', name: unknown, at }];
    if ('atLeast' in c && !Number.isInteger(c.atLeast)) {
      return [{ kind: 'bad-number', field: 'atLeast', at }];
    }
    return [];
  });
}

function optionFindings(
  option: TourGameOption,
  at: TourGameRef,
  stepIds: ReadonlySet<string>,
  names: Names
): TourGameFinding[] {
  const out = conditionFindings(option.requires, at, names);
  for (const effect of option.effects ?? []) {
    const unknown = names.unknownIn(effect);
    if (unknown !== undefined)
      out.push({ kind: 'unknown-name', name: unknown, at });
    else if (isBadAdd(effect))
      out.push({ kind: 'bad-number', field: 'by', at });
  }
  if (option.goto !== undefined && !stepIds.has(option.goto)) {
    out.push({ kind: 'unknown-step', step: option.goto, at });
  }
  return out;
}

function stepStructure(
  station: TourGameStation,
  step: TourGameStep,
  stepIds: ReadonlySet<string>,
  names: Names
): TourGameFinding[] {
  const at = { station: station.id, step: step.id };
  const out = conditionFindings(step.requires, at, names);
  if (step.kind === 'choice') {
    for (const id of duplicatesOf(step.options.map((o) => o.id))) {
      out.push({ kind: 'duplicate-id', id, within: at });
    }
    for (const option of step.options) {
      out.push(
        ...optionFindings(option, { ...at, option: option.id }, stepIds, names)
      );
    }
  }
  if (step.kind === 'quiz') {
    for (const effect of [
      ...(step.outcomes.correct ?? []),
      ...(step.outcomes.wrong ?? []),
    ]) {
      const unknown = names.unknownIn(effect);
      if (unknown !== undefined)
        out.push({ kind: 'unknown-name', name: unknown, at });
      else if (isBadAdd(effect))
        out.push({ kind: 'bad-number', field: 'by', at });
    }
  }
  return out;
}

function stationStructure(
  station: TourGameStation,
  names: Names
): TourGameFinding[] {
  const within = { station: station.id };
  const items = station.items ?? [];
  const out = conditionFindings(station.requires, within, names);
  for (const id of duplicatesOf(station.steps.map((s) => s.id))) {
    out.push({ kind: 'duplicate-id', id, within });
  }
  for (const id of duplicatesOf(items.map((i) => i.id))) {
    out.push({ kind: 'duplicate-id', id, within });
  }
  for (const item of items) {
    out.push(
      ...conditionFindings(item.requires, { ...within, item: item.id }, names)
    );
  }
  const stepIds = new Set(station.steps.map((s) => s.id));
  for (const step of station.steps) {
    out.push(...stepStructure(station, step, stepIds, names));
  }
  return out;
}

// --- reachability -----------------------------------------------------------

/** What could ever be held: the fixpoint's state. */
interface Bounds {
  readonly labels: ReadonlySet<string>;
  readonly max: ReadonlyMap<string, number>;
}

/** Why the list could never hold, or null when it could. */
function listCause(
  requires: readonly TourGameCondition[] | undefined,
  bounds: Bounds,
  names: Names
): TourGameCause | null {
  const list = requires ?? [];
  const contradiction = list.find(
    (c) => 'has' in c && list.some((d) => 'lacks' in d && d.lacks === c.has)
  );
  if (contradiction !== undefined && 'has' in contradiction) {
    return { kind: 'contradiction', label: contradiction.has };
  }
  for (const c of list) {
    const cause = conditionCause(c, bounds, names);
    if (cause !== null) return cause;
  }
  return null;
}

/** Why one condition could never hold, or null when it could. */
function conditionCause(
  c: TourGameCondition,
  bounds: Bounds,
  names: Names
): TourGameCause | null {
  const unknown = names.unknownIn(c);
  if (unknown !== undefined) return { kind: 'unknown-name', name: unknown };
  if ('lacks' in c) return null;
  if ('has' in c) {
    if (bounds.labels.has(c.has)) return null;
    return names.setAnywhere.has(c.has)
      ? { kind: 'label-set-only-by-unreachable-content', label: c.has }
      : { kind: 'label-never-set', label: c.has };
  }
  if (!Number.isFinite(c.atLeast)) return { kind: 'bad-number' };
  const max = bounds.max.get(c.counter) ?? 0;
  return max < c.atLeast
    ? {
        kind: 'counter-out-of-reach',
        counter: c.counter,
        atLeast: c.atLeast,
        max,
      }
    : null;
}

/** The net change an effect list makes per counter. */
function netAdds(effects: readonly TourGameEffect[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const e of effects)
    if ('add' in e) net.set(e.add, (net.get(e.add) ?? 0) + e.by);
  return net;
}

/** One way an answer can turn out, and where a finding about it points
 *  beside its step. */
interface Branch {
  readonly ref:
    { readonly option: string } | { readonly outcome: 'correct' | 'wrong' };
  readonly effects: readonly TourGameEffect[];
}

/** Something a visitor takes at a step: a choice's option (one branch),
 *  a choice quiz's outcome (one branch: its answers are offered on their
 *  own), or a typed quiz's input (two branches: right and wrong share one
 *  input, which is open only when both could be paid). */
interface Answer {
  readonly requires: readonly TourGameCondition[] | undefined;
  readonly branches: readonly Branch[];
  /** The choice's option, for its `goto`; a quiz continues at the next
   *  step. */
  readonly option: TourGameOption | undefined;
}

function quizBranch(
  step: Extract<TourGameStep, { kind: 'quiz' }>,
  outcome: 'correct' | 'wrong'
): Branch {
  return { ref: { outcome }, effects: step.outcomes[outcome] ?? [] };
}

function answersOf(step: TourGameStep): Answer[] {
  if (step.kind === 'choice') {
    return step.options.map((option) => ({
      requires: option.requires,
      branches: [{ ref: { option: option.id }, effects: option.effects ?? [] }],
      option,
    }));
  }
  if (step.kind !== 'quiz') return [];
  const branches = [quizBranch(step, 'correct'), quizBranch(step, 'wrong')];
  return step.typed === true
    ? [{ requires: undefined, branches, option: undefined }]
    : branches.map((b) => ({
        requires: undefined,
        branches: [b],
        option: undefined,
      }));
}

/** Why one branch's effects could never be applied, or null. */
function branchCause(
  effects: readonly TourGameEffect[],
  bounds: Bounds,
  names: Names
): TourGameCause | null {
  return effectsCause(effects, names) ?? floorCause(effects, bounds, names);
}

/** Why the answer could never be taken (every branch must be payable),
 *  or null when it could. */
function answerCause(
  answer: Answer,
  bounds: Bounds,
  names: Names
): TourGameCause | null {
  const listed = listCause(answer.requires, bounds, names);
  if (listed !== null) return listed;
  for (const b of answer.branches) {
    const why = branchCause(b.effects, bounds, names);
    if (why !== null) return why;
  }
  return null;
}

/** An answer that could never be taken, reported on each branch at fault
 *  (every branch, when its requirement is). */
function neverAvailable(
  answer: Answer,
  at: TourGameRef,
  bounds: Bounds,
  names: Names
): TourGameFinding[] {
  const listed = listCause(answer.requires, bounds, names);
  return answer.branches.flatMap((b): TourGameFinding[] => {
    const why = listed ?? branchCause(b.effects, bounds, names);
    return why === null
      ? []
      : [
          {
            kind: 'option-never-available',
            at: { ...at, ...b.ref },
            because: why,
          },
        ];
  });
}

/**
 * The visible counter a choice quiz's outcomes cost differently on, if
 * any: with both outcomes payable at some point, some value of it pays
 * the cheaper outcome and not the dearer one, so the dearer one's
 * answers are greyed beside the other's and the quiz gives its answer
 * away. An outcome that can never be paid is left to
 * `option-never-available` (the quiz ALWAYS gives it away); a typed quiz
 * shows one input for both, and a secret counter hides rather than greys.
 */
function giveAwayCounter(
  step: TourGameStep,
  bounds: Bounds,
  names: Names
): string | undefined {
  if (step.kind !== 'quiz' || step.typed === true) return undefined;
  const lists = [step.outcomes.correct ?? [], step.outcomes.wrong ?? []];
  if (lists.some((e) => branchCause(e, bounds, names) !== null))
    return undefined;
  const [right, wrong] = lists.map(netAdds);
  return [...names.counters.values()].find((counter) => {
    const a = right!.get(counter.id) ?? 0;
    const b = wrong!.get(counter.id) ?? 0;
    return counter.secret !== true && a !== b && Math.min(a, b) < 0;
  })?.id;
}

/** The first effect the game cannot apply, as a cause; else null. */
function effectsCause(
  effects: readonly TourGameEffect[],
  names: Names
): TourGameCause | null {
  for (const e of effects) {
    const unknown = names.unknownIn(e);
    if (unknown !== undefined) return { kind: 'unknown-name', name: unknown };
    if (isBadAdd(e)) return { kind: 'bad-number' };
  }
  return null;
}

/** A counter the effects lower below its floor even at its bound. */
function floorCause(
  effects: readonly TourGameEffect[],
  bounds: Bounds,
  names: Names
): TourGameCause | null {
  for (const [counter, d] of netAdds(effects)) {
    const max = bounds.max.get(counter) ?? 0;
    const floor = names.counters.get(counter)?.floor ?? 0;
    if (d < 0 && max + d < floor) return { kind: 'floor', counter, max };
  }
  return null;
}

/** One list of effects reachable content can apply. */
interface Source {
  readonly effects: readonly TourGameEffect[];
  /** Its step lies on a loop of the scene: it can apply again. */
  readonly repeatable: boolean;
}

interface Flow {
  /** Steps the flow arrives at (perhaps only to pass them over). */
  readonly arrived: ReadonlySet<number>;
  /** Steps arrived at whose list could hold: they play. */
  readonly reached: ReadonlySet<number>;
  readonly sources: readonly Source[];
}

interface FlowContext {
  readonly steps: readonly TourGameStep[];
  readonly bounds: Bounds;
  readonly names: Names;
}

/** The scene flow of a reachable station under the bounds. */
function sceneFlow(
  station: TourGameStation,
  bounds: Bounds,
  names: Names
): Flow {
  const steps = station.steps;
  const ctx: FlowContext = { steps, bounds, names };
  const edges = new Map<number, number[]>();
  const arrived = new Set<number>();
  const reached = new Set<number>();
  const queue: number[] = steps.length > 0 ? [0] : [];
  for (const i of queue) arrived.add(i);
  while (queue.length > 0) {
    const i = queue.pop()!;
    const { plays, next } = successors(i, ctx);
    if (plays) reached.add(i);
    edges.set(i, next);
    for (const j of next.filter((k) => !arrived.has(k))) {
      arrived.add(j);
      queue.push(j);
    }
  }
  const sources = [...reached].flatMap((i) =>
    sourcesOf(steps[i]!, onLoop(edges, i), bounds, names)
  );
  return { arrived, reached, sources };
}

/** Whether step i could play, and the steps the flow may continue at
 *  (by the rules' `stepAfter`; -1, the scene ending, is no step). */
function successors(
  i: number,
  ctx: FlowContext
): { plays: boolean; next: number[] } {
  const step = ctx.steps[i]!;
  const next: number[] = [];
  // A step with a requirement may be passed over.
  if ((step.requires?.length ?? 0) > 0) next.push(stepAfter(ctx.steps, i));
  const plays = listCause(step.requires, ctx.bounds, ctx.names) === null;
  if (plays && step.kind === 'content') next.push(stepAfter(ctx.steps, i));
  if (plays) {
    for (const answer of answersOf(step)) {
      if (answerCause(answer, ctx.bounds, ctx.names) === null) {
        next.push(stepAfter(ctx.steps, i, answer.option));
      }
    }
  }
  return { plays, next: next.filter((j) => j >= 0) };
}

/** Whether step i lies on a loop of the flow's edges. */
function onLoop(
  edges: ReadonlyMap<number, readonly number[]>,
  i: number
): boolean {
  const seen = new Set<number>();
  const stack = [...(edges.get(i) ?? [])];
  while (stack.length > 0) {
    const j = stack.pop()!;
    if (j === i) return true;
    if (seen.has(j)) continue;
    seen.add(j);
    stack.push(...(edges.get(j) ?? []));
  }
  return false;
}

/** The effect lists a playing step can apply: every branch of its
 *  options (or quiz outcomes, or typed input) that could be available. */
function sourcesOf(
  step: TourGameStep,
  repeatable: boolean,
  bounds: Bounds,
  names: Names
): Source[] {
  return answersOf(step)
    .filter((answer) => answerCause(answer, bounds, names) === null)
    .flatMap((answer) =>
      answer.branches.map((b) => ({ effects: b.effects, repeatable }))
    );
}

/** The bounds the sources imply. */
function boundsFrom(names: Names, sources: readonly Source[]): Bounds {
  const labels = new Set<string>();
  const max = new Map<string, number>();
  for (const [id, counter] of names.counters) max.set(id, counter.start);
  for (const { effects, repeatable } of sources) {
    for (const e of effects) {
      if (names.unknownIn(e) !== undefined || isBadAdd(e)) continue;
      if ('set' in e) labels.add(e.set);
      if ('add' in e && e.by > 0) raise(max, names, e.add, e.by, repeatable);
    }
  }
  return { labels, max };
}

/** Add a positive payout to a counter's bound: unbounded when it can
 *  repeat or the counter is collectible (rounds add up). */
function raise(
  max: Map<string, number>,
  names: Names,
  counter: string,
  by: number,
  repeatable: boolean
): void {
  const unbounded =
    repeatable || names.counters.get(counter)?.keep === 'collectible';
  max.set(counter, unbounded ? Infinity : (max.get(counter) ?? 0) + by);
}

function sameBounds(a: Bounds, b: Bounds): boolean {
  if (a.labels.size !== b.labels.size) return false;
  for (const l of a.labels) if (!b.labels.has(l)) return false;
  for (const [id, v] of a.max) if (b.max.get(id) !== v) return false;
  return true;
}

/**
 * The fixpoint: bounds grow until nothing new becomes reachable. Every
 * condition only gets easier as the bounds grow, so the set of sources
 * only grows, and the bounds are a function of it: a pass that changes
 * them adds a source or makes one repeatable, at most twice per source.
 * The pass cap follows from that count (plus slack). Reaching it would
 * mean a defect in this argument; the result is then the TOP bounds -
 * every declared label could be held, no counter has a bound - never
 * bounds cut short, which could call reachable content unreachable and
 * miss a choice that traps.
 */
function fixpoint(game: TourGame, names: Names): Bounds {
  const answers = game.stations.reduce(
    (n, s) => n + s.steps.reduce((m, step) => m + answersOf(step).length, 0),
    0
  );
  const cap = 2 * answers + game.labels.length + 2;
  let bounds = boundsFrom(names, []);
  for (let pass = 0; pass < cap; pass += 1) {
    const sources = game.stations.flatMap((station) =>
      listCause(station.requires, bounds, names) === null
        ? sceneFlow(station, bounds, names).sources
        : []
    );
    const next = boundsFrom(names, sources);
    if (sameBounds(next, bounds)) return bounds;
    bounds = next;
  }
  return {
    labels: names.labels,
    max: new Map([...names.counters.keys()].map((id) => [id, Infinity])),
  };
}

/** A free option: no requirement, and on every branch effects that apply
 *  and no counter down. */
function isFreeOfCost(answer: Answer, names: Names): boolean {
  return answer.branches.every(
    ({ effects }) =>
      effects.every((e) => names.unknownIn(e) === undefined && !isBadAdd(e)) &&
      [...netAdds(effects).values()].every((d) => d >= 0)
  );
}

function hasFreeOption(answers: readonly Answer[], names: Names): boolean {
  const costFree = answers.filter((a) => isFreeOfCost(a, names));
  if (costFree.some((a) => (a.requires?.length ?? 0) === 0)) return true;
  const single = (a: Answer): TourGameCondition | undefined =>
    a.requires?.length === 1 ? a.requires[0] : undefined;
  return costFree.some((a) => {
    const c = single(a);
    if (c === undefined || !('has' in c) || !names.labels.has(c.has))
      return false;
    return costFree.some((b) => {
      const d = single(b);
      return d !== undefined && 'lacks' in d && d.lacks === c.has;
    });
  });
}

function stationFindings(
  station: TourGameStation,
  bounds: Bounds,
  names: Names
): TourGameFinding[] {
  const ref = { station: station.id };
  const cause = listCause(station.requires, bounds, names);
  if (cause !== null) return [{ kind: 'unreachable', at: ref, because: cause }];
  const out: TourGameFinding[] = [];
  for (const item of station.items ?? []) {
    const itemCause = listCause(item.requires, bounds, names);
    if (itemCause !== null) {
      out.push({
        kind: 'unreachable',
        at: { ...ref, item: item.id },
        because: itemCause,
      });
    }
  }
  const flow = sceneFlow(station, bounds, names);
  station.steps.forEach((step, i) => {
    const at = { ...ref, step: step.id };
    if (!flow.arrived.has(i)) {
      out.push({ kind: 'unreachable', at, because: { kind: 'scene-flow' } });
      return;
    }
    if (!flow.reached.has(i)) {
      const stepCause = listCause(step.requires, bounds, names);
      if (stepCause !== null)
        out.push({ kind: 'unreachable', at, because: stepCause });
      return;
    }
    if (step.kind === 'content') return;
    const answers = answersOf(step);
    for (const answer of answers) {
      out.push(...neverAvailable(answer, at, bounds, names));
    }
    if (!hasFreeOption(answers, names)) {
      out.push({ kind: 'choice-may-softlock', at });
    }
    const counter = giveAwayCounter(step, bounds, names);
    if (counter !== undefined) {
      out.push({ kind: 'quiz-may-give-answer-away', at, counter });
    }
  });
  return out;
}

function reachabilityFindings(game: TourGame, names: Names): TourGameFinding[] {
  const bounds = fixpoint(game, names);
  return game.stations.flatMap((station) =>
    stationFindings(station, bounds, names)
  );
}
