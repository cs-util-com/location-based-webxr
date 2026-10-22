/**
 * Why this test matters: the reachability checks reason about what COULD
 * be held, never by playing the tour, so their one promise needs an
 * independent witness. On small random tours an exhaustive search plays
 * EVERY walk of up to three rounds with the rules themselves - visiting
 * stations in any order, skipping or leaving them, picking every option
 * that can be picked, answering every quiz right and wrong, following
 * every `goto` (backwards and to no step too) - and records what is ever
 * shown. Two promises are held to it:
 *
 * - sound: whatever the check calls unreachable or never available is
 *   never reached by any walk (a false alarm would teach creators to
 *   ignore the checks);
 * - no missed softlock: every choice or quiz some walk reaches with
 *   nothing to pick is reported as one that may trap the visitor.
 *
 * Counts per cause guard both against vacuity: a property that never
 * meets a cause proves nothing about it.
 *
 * Parameters (each a choice of this test, not of the rules): up to 4
 * stations of up to 3 steps, 3 labels, 2 counters, rounds capped at 3, and
 * walk states with a counter above COUNTER_CAP dropped so that loops keep
 * the search finite. Dropping states only removes walks, so it can hide a
 * broken promise but never invent one; more rounds, stations or a higher
 * cap can only let walks reach more.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { checkTourGame } from './tour-game-check';
import {
  answerQuiz,
  availability,
  chooseOption,
  nextAvailableStep,
  startNextRound,
  startRun,
  optionDisplay,
  stepAfter,
  type TourGame,
  type TourGameCondition,
  type TourGameEffect,
  type TourGameRunState,
  type TourGameStep,
} from './tour-game-rules';

const MAX_ROUNDS = 3;
const COUNTER_CAP = 20;
const LABEL_IDS = ['a', 'b', 'c'];
const COUNTER_IDS = ['x', 'y'];

const labelName = fc.oneof(
  { weight: 9, arbitrary: fc.constantFrom(...LABEL_IDS) },
  { weight: 1, arbitrary: fc.constant('zz') }
);
const counterName = fc.constantFrom(...COUNTER_IDS);

const condition: fc.Arbitrary<TourGameCondition> = fc.oneof(
  labelName.map((has) => ({ has })),
  labelName.map((lacks) => ({ lacks })),
  fc.record({ counter: counterName, atLeast: fc.integer({ min: -1, max: 5 }) })
);
const requires = fc.array(condition, { maxLength: 2 });

const effect: fc.Arbitrary<TourGameEffect> = fc.oneof(
  { weight: 3, arbitrary: labelName.map((set) => ({ set })) },
  { weight: 1, arbitrary: labelName.map((clear) => ({ clear })) },
  {
    weight: 2,
    arbitrary: fc.record({
      add: counterName,
      by: fc.integer({ min: -3, max: 3 }).filter((n) => n !== 0),
    }),
  }
);
const effects = fc.array(effect, { maxLength: 2 });

/** A step of index `i` among `count`: a choice may jump to any step of
 *  its station, itself and earlier ones included, or to no step. */
function stepAt(i: number, count: number): fc.Arbitrary<TourGameStep> {
  const id = `st${String(i)}`;
  const targets = [
    ...Array.from({ length: count }, (_, k) => `st${String(k)}`),
    'nope',
  ];
  const goto = fc.option(fc.constantFrom(...targets), { nil: undefined });
  const option = (o: number) =>
    fc
      .record({ requires, effects, goto })
      .map(({ requires: r, effects: e, goto: g }) => ({
        id: `o${String(o)}`,
        ...(r.length === 0 ? {} : { requires: r }),
        ...(e.length === 0 ? {} : { effects: e }),
        ...(g === undefined ? {} : { goto: g }),
      }));
  return fc.oneof(
    fc.record({ requires }).map(({ requires: r }) => ({
      id,
      kind: 'content' as const,
      ...(r.length === 0 ? {} : { requires: r }),
    })),
    fc
      .tuple(
        requires,
        fc
          .integer({ min: 1, max: 3 })
          .chain((n) =>
            fc.tuple(...Array.from({ length: n }, (_, o) => option(o)))
          )
      )
      .map(([r, options]) => ({
        id,
        kind: 'choice' as const,
        ...(r.length === 0 ? {} : { requires: r }),
        options,
      })),
    fc
      .record({
        requires,
        correct: effects,
        wrong: effects,
        typed: fc.boolean(),
      })
      .map((q) => ({
        id,
        kind: 'quiz' as const,
        ...(q.requires.length === 0 ? {} : { requires: q.requires }),
        ...(q.typed ? { typed: true } : {}),
        outcomes: { correct: q.correct, wrong: q.wrong },
      }))
  );
}

const station = (s: number) =>
  fc
    .integer({ min: 0, max: 3 })
    .chain((count) =>
      fc.record({
        requires,
        steps: fc.tuple(
          ...Array.from({ length: count }, (_, i) => stepAt(i, count))
        ),
        items: fc.array(requires, { maxLength: 2 }),
      })
    )
    .map(({ requires: r, steps, items }) => ({
      id: `s${String(s)}`,
      ...(r.length === 0 ? {} : { requires: r }),
      steps,
      items: items.map((ir, i) => ({
        id: `i${String(i)}`,
        ...(ir.length === 0 ? {} : { requires: ir }),
      })),
    }));

const keep = fc.constantFrom('collectible' as const, 'round' as const);

const tour: fc.Arbitrary<TourGame> = fc
  .record({
    keeps: fc.array(keep, { minLength: 5, maxLength: 5 }),
    starts: fc.array(fc.integer({ min: 0, max: 2 }), {
      minLength: 2,
      maxLength: 2,
    }),
    secret: fc.array(fc.boolean(), { minLength: 2, maxLength: 2 }),
    stations: fc
      .integer({ min: 1, max: 4 })
      .chain((n) =>
        fc.tuple(...Array.from({ length: n }, (_, s) => station(s)))
      ),
  })
  .map(({ keeps, starts, secret, stations }) => ({
    labels: LABEL_IDS.map((id, i) => ({ id, name: id, keep: keeps[i]! })),
    counters: COUNTER_IDS.map((id, i) => ({
      id,
      name: id,
      keep: keeps[3 + i]!,
      start: starts[i]!,
      floor: 0,
      ...(secret[i]! ? { secret: true } : {}),
    })),
    stations,
  }));

interface Seen {
  stations: Set<string>;
  items: Set<string>;
  steps: Set<string>;
  /** Options picked, and quiz outcomes taken (`<step>/correct`). */
  options: Set<string>;
  /** Choices and quizzes some walk reached with nothing to pick. */
  stuck: Set<string>;
  /** Choice quizzes some walk reached showing one outcome's answers and
   *  the other's greyed: the quiz gave its answer away. */
  gaveAway: Set<string>;
}

interface Walk {
  run: TourGameRunState;
  done: readonly boolean[];
  /** The scene playing: its station and step index. */
  at: { station: number; step: number } | null;
}

/** One walk's possible next states, deduplicated by the caller. */
type Push = (w: Walk) => void;

/** Mark what this state shows: every station whose requirement holds, and
 *  the items of each station that exists now or whose scene plays. */
function markShown(game: TourGame, w: Walk, seen: Seen): void {
  game.stations.forEach((st, si) => {
    const exists = availability(game, w.run, st).available;
    if (exists) seen.stations.add(st.id);
    if (!exists && w.at?.station !== si) return;
    for (const item of st.items ?? []) {
      if (availability(game, w.run, item).available) {
        seen.items.add(`${st.id}/${item.id}`);
      }
    }
  });
}

function finished(w: Walk, si: number): readonly boolean[] {
  return w.done.map((d, k) => d || k === si);
}

/** Continue station si's scene at step `from` (passing over steps whose
 *  requirement fails), or finish the station. */
function enter(game: TourGame, w: Walk, si: number, from: number): Walk {
  const steps = game.stations[si]!.steps;
  const step = nextAvailableStep(game, w.run, steps, from);
  return step < 0
    ? { run: w.run, done: finished(w, si), at: null }
    : { ...w, at: { station: si, step } };
}

/** Between scenes: play or skip any station that exists and is not done,
 *  or start the next round. */
function idleMoves(game: TourGame, w: Walk, push: Push): void {
  game.stations.forEach((st, si) => {
    if (w.done[si] || !availability(game, w.run, st).available) return;
    push(enter(game, w, si, 0));
    push({ ...w, done: finished(w, si) });
  });
  if (w.run.round < MAX_ROUNDS) {
    push({
      run: startNextRound(game, w.run),
      done: game.stations.map(() => false),
      at: null,
    });
  }
}

/** Inside a scene: leave it, or play the current step every way it can. */
function sceneMoves(
  game: TourGame,
  w: Walk & { at: NonNullable<Walk['at']> },
  push: Push,
  seen: Seen
): void {
  const { station: si, step: i } = w.at;
  const st = game.stations[si]!;
  const step = st.steps[i]!;
  const ref = `${st.id}/${step.id}`;
  seen.steps.add(ref);
  // Leaving a scene part-way is always possible (the station's skip).
  push({ run: w.run, done: finished(w, si), at: null });
  if (step.kind === 'content') {
    push(enter(game, w, si, stepAfter(st.steps, i)));
    return;
  }
  let any = false;
  const taken = (run: TourGameRunState, key: string, from: number) => {
    any = true;
    seen.options.add(`${ref}/${key}`);
    push(enter(game, { ...w, run }, si, from));
  };
  if (step.kind === 'quiz') {
    const results = [true, false].map((correct) =>
      answerQuiz(game, w.run, step.outcomes, correct)
    );
    // A typed input is one box: usable only when both outcomes can be
    // paid. A choice quiz offers each outcome's answers on their own.
    const open = step.typed === true ? results.every((r) => r.ok) : true;
    results.forEach((result, k) => {
      if (open && result.ok) {
        taken(
          result.state,
          k === 0 ? 'correct' : 'wrong',
          stepAfter(st.steps, i)
        );
      }
    });
    if (step.typed !== true) {
      const shown = [step.outcomes.correct, step.outcomes.wrong].map(
        (effects) =>
          optionDisplay(game, w.run, { effects: effects ?? [] }).shown
      );
      if (shown.includes('available') && shown.includes('greyed')) {
        seen.gaveAway.add(ref);
      }
    }
  } else {
    for (const option of step.options) {
      const result = chooseOption(game, w.run, option);
      if (result.ok) {
        taken(result.state, option.id, stepAfter(st.steps, i, option));
      }
    }
  }
  if (!any) seen.stuck.add(ref);
}

/** Every walk of up to MAX_ROUNDS rounds, by the rules themselves, short
 *  of walks whose counters climb above `cap`. */
function exhaustive(game: TourGame, cap = COUNTER_CAP): Seen {
  const seen: Seen = {
    stations: new Set(),
    items: new Set(),
    steps: new Set(),
    options: new Set(),
    stuck: new Set(),
    gaveAway: new Set(),
  };
  const visited = new Set<string>();
  const queue: Walk[] = [
    { run: startRun(game), done: game.stations.map(() => false), at: null },
  ];
  const push: Push = (w) => {
    if (Object.values(w.run.counters).some((v) => v > cap)) return;
    const key = JSON.stringify(w);
    if (visited.has(key)) return;
    visited.add(key);
    queue.push(w);
  };
  while (queue.length > 0) {
    const w = queue.pop()!;
    markShown(game, w, seen);
    if (w.at === null) idleMoves(game, w, push);
    else sceneMoves(game, { ...w, at: w.at }, push, seen);
  }
  return seen;
}

function refKey(at: {
  station: string;
  item?: string;
  step?: string;
  option?: string;
  outcome?: string;
}): string {
  return [at.station, at.item ?? at.step, at.option ?? at.outcome]
    .filter((p) => p !== undefined)
    .join('/');
}

/** The set of what the walks showed, for the kind of place `at` names. */
function shownSet(
  at: { item?: string; step?: string },
  seen: Seen
): Set<string> {
  if (at.item !== undefined) return seen.items;
  return at.step !== undefined ? seen.steps : seen.stations;
}

/** Every broken promise of the check against what the walks reached. */
function violations(
  findings: ReturnType<typeof checkTourGame>,
  seen: Seen
): string[] {
  const out: string[] = [];
  for (const f of findings) {
    if (f.kind === 'unreachable' && shownSet(f.at, seen).has(refKey(f.at))) {
      out.push(`reported unreachable, reached: ${refKey(f.at)}`);
    }
    if (f.kind === 'option-never-available' && seen.options.has(refKey(f.at))) {
      out.push(`reported never available, picked: ${refKey(f.at)}`);
    }
  }
  const softlocks = new Set(
    findings
      .filter((f) => f.kind === 'choice-may-softlock')
      .map((f) => refKey(f.at))
  );
  for (const ref of seen.stuck) {
    if (!softlocks.has(ref)) out.push(`stuck choice not reported: ${ref}`);
  }
  // Giving the answer away is reported as the warning, or - when one
  // outcome can never be paid - as that outcome never being available.
  const warned = new Set(
    findings.flatMap((f) =>
      f.kind === 'quiz-may-give-answer-away' ||
      (f.kind === 'option-never-available' && f.at.outcome !== undefined)
        ? [refKey({ station: f.at.station, step: f.at.step })]
        : []
    )
  );
  for (const ref of seen.gaveAway) {
    if (!warned.has(ref)) out.push(`answer given away, not reported: ${ref}`);
  }
  return out;
}

/** The causes a run of the property must meet at least once each. */
const GUARDED_CAUSES = [
  'unreachable:label-never-set',
  'unreachable:label-set-only-by-unreachable-content',
  'unreachable:counter-out-of-reach',
  'unreachable:contradiction',
  'unreachable:unknown-name',
  'unreachable:scene-flow',
  'option-never-available:floor',
  'option-never-available:counter-out-of-reach',
  'stuck',
  'gave-away',
  'quiz-may-give-answer-away',
] as const;

describe('tour game check - against an exhaustive walk search', () => {
  it('never reports reachable content, and never misses a stuck choice', () => {
    const met = new Map<string, number>();
    const count = (key: string, n = 1) => met.set(key, (met.get(key) ?? 0) + n);
    fc.assert(
      fc.property(tour, (game) => {
        const seen = exhaustive(game);
        const findings = checkTourGame(game);
        for (const f of findings) {
          if (f.kind === 'unreachable' || f.kind === 'option-never-available')
            count(`${f.kind}:${f.because.kind}`);
          if (f.kind === 'quiz-may-give-answer-away') count(f.kind);
        }
        count('stuck', seen.stuck.size);
        count('gave-away', seen.gaveAway.size);
        expect(violations(findings, seen)).toEqual([]);
      }),
      { numRuns: 1000 }
    );
    expect(
      GUARDED_CAUSES.filter((cause) => (met.get(cause) ?? 0) === 0)
    ).toEqual([]);
  });

  // The rules end a scene on a goto naming no step; a walk that instead
  // restarted the scene would replay the payout and reach the gate the
  // check calls out of reach.
  it('agrees with the walks on a goto naming no step', () => {
    const game: TourGame = {
      labels: [],
      counters: [{ id: 'x', name: 'x', keep: 'round', start: 0, floor: 0 }],
      stations: [
        {
          id: 's0',
          steps: [
            {
              id: 'c',
              kind: 'choice',
              options: [
                { id: 'k', effects: [{ add: 'x', by: 1 }], goto: 'nope' },
                { id: 'leave' },
              ],
            },
          ],
        },
        { id: 'gate', requires: [{ counter: 'x', atLeast: 2 }], steps: [] },
      ],
    };
    const findings = checkTourGame(game);
    expect(findings.map((f) => f.kind)).toContain('unreachable');
    expect(violations(findings, exhaustive(game))).toEqual([]);
  });
});
