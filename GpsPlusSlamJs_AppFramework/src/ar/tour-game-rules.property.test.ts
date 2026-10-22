/**
 * Why this test matters: the examples pin single rules; these properties
 * pin what must hold under ANY sequence a visitor can produce. Random
 * games (including undeclared names, zero and fractional adds) and random
 * sequences of chosen options, quiz answers and new rounds must never
 * push a counter below its floor or off the integers, choosing or
 * answering must never change the state it is given, a new round must
 * keep exactly the collectible labels and counters, and the inventory
 * must list every label once and show it exactly by held, keep and
 * secret. A greyed option's needs must be exactly what it takes: meeting
 * all of them makes the option available, leaving any one out does not,
 * and only a secret or something the game cannot read ever hides one.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  answerQuiz,
  chooseOption,
  inventory,
  optionDisplay,
  quizInputDisplay,
  startNextRound,
  startRun,
  type TourGame,
  type TourGameCondition,
  type TourGameEffect,
  type TourGameRunState,
} from './tour-game-rules';

const LABEL_IDS = ['a', 'b', 'c'] as const;
const COUNTER_IDS = ['x', 'y'] as const;
/** Names a game may not declare, and ids of the other kind. */
const ANY_NAME = fc.constantFrom('a', 'b', 'c', 'x', 'y', 'zz');

const keep = fc.constantFrom('collectible' as const, 'round' as const);

const game: fc.Arbitrary<TourGame> = fc
  .record({
    labels: fc.subarray([...LABEL_IDS]),
    counters: fc.subarray([...COUNTER_IDS]),
    keeps: fc.array(keep, { minLength: 5, maxLength: 5 }),
    secret: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
    floors: fc.array(fc.integer({ min: -3, max: 3 }), {
      minLength: 2,
      maxLength: 2,
    }),
    above: fc.array(fc.integer({ min: 0, max: 4 }), {
      minLength: 2,
      maxLength: 2,
    }),
  })
  .map(({ labels, counters, keeps, secret, floors, above }) => ({
    labels: labels.map((id, i) => ({
      id,
      name: id.toUpperCase(),
      keep: keeps[i]!,
      secret: secret[i]!,
    })),
    counters: counters.map((id, i) => ({
      id,
      name: id.toUpperCase(),
      keep: keeps[3 + i]!,
      start: floors[i]! + above[i]!,
      floor: floors[i]!,
      secret: secret[3 + i]!,
    })),
    stations: [],
  }));

/** Mostly a name of the right kind (the game may still not declare it),
 *  sometimes any name: noisy enough to reach the refusal paths, well-formed
 *  often enough that chosen options really move counters. */
const labelName = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...LABEL_IDS) },
  { weight: 1, arbitrary: ANY_NAME }
);
const counterName = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...COUNTER_IDS) },
  { weight: 1, arbitrary: ANY_NAME }
);

const condition: fc.Arbitrary<TourGameCondition> = fc.oneof(
  labelName.map((has) => ({ has })),
  labelName.map((lacks) => ({ lacks })),
  fc.record({ counter: counterName, atLeast: fc.integer({ min: -4, max: 8 }) })
);

const effect: fc.Arbitrary<TourGameEffect> = fc.oneof(
  labelName.map((set) => ({ set })),
  labelName.map((clear) => ({ clear })),
  fc.record({
    add: counterName,
    by: fc.oneof(
      { weight: 8, arbitrary: fc.integer({ min: -5, max: 5 }) },
      { weight: 1, arbitrary: fc.constant(0.5) },
      { weight: 1, arbitrary: fc.constant(Number.NaN) }
    ),
  }),
  fc.record({ add: counterName, by: fc.integer({ min: -5, max: -1 }) })
);

const effects = fc.array(effect, { maxLength: 3 });

type Action =
  | {
      kind: 'choose';
      requires: TourGameCondition[];
      effects: TourGameEffect[];
    }
  | { kind: 'quiz'; correct: boolean; effects: TourGameEffect[] }
  | { kind: 'round' };

const action: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('choose' as const),
      requires: fc.array(condition, { maxLength: 2 }),
      effects,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('quiz' as const),
      correct: fc.boolean(),
      effects,
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'round' as const }) }
);

function step(g: TourGame, s: TourGameRunState, a: Action): TourGameRunState {
  if (a.kind === 'round') return startNextRound(g, s);
  const result =
    a.kind === 'quiz'
      ? answerQuiz(
          g,
          s,
          a.correct ? { correct: a.effects } : { wrong: a.effects },
          a.correct
        )
      : chooseOption(g, s, {
          id: 'o',
          requires: a.requires,
          effects: a.effects,
        });
  return result.ok ? result.state : s;
}

/** What is wrong with a state: counters off the integers or below their
 *  floor, labels not sorted and unique. Empty when well-formed. */
function problems(g: TourGame, s: TourGameRunState): string[] {
  const out = g.counters.flatMap((c) => {
    const value = s.counters[c.id];
    return Number.isInteger(value) && value! >= c.floor
      ? []
      : [`${c.id}=${String(value)} (floor ${String(c.floor)})`];
  });
  const sorted = [...new Set(s.labels)].sort();
  if (sorted.join() !== s.labels.join()) out.push(`labels ${s.labels.join()}`);
  return out;
}

const reached = (g: TourGame, actions: readonly Action[]): TourGameRunState =>
  actions.reduce((acc, a) => step(g, acc, a), startRun(g));

type Need =
  | { readonly has: string }
  | { readonly lacks: string }
  | { readonly counter: string; readonly need: number };

/** The state with the given needs met: labels given or taken away,
 *  counters raised by what is missing. */
function meeting(
  s: TourGameRunState,
  needs: readonly Need[]
): TourGameRunState {
  const labels = new Set(s.labels);
  const counters = { ...s.counters };
  for (const n of needs) {
    if ('has' in n) labels.add(n.has);
    else if ('lacks' in n) labels.delete(n.lacks);
    else counters[n.counter] = (counters[n.counter] ?? 0) + n.need;
  }
  return { round: s.round, labels: [...labels].sort(), counters };
}

/** Every name a target uses, with the kind it is used as. */
function namesOf(target: {
  requires: readonly TourGameCondition[];
  effects: readonly TourGameEffect[];
}): { name: string; kind: 'label' | 'counter' }[] {
  const label = (name: string) => ({ name, kind: 'label' as const });
  const counter = (name: string) => ({ name, kind: 'counter' as const });
  return [
    ...target.requires.map((c) =>
      'has' in c
        ? label(c.has)
        : 'lacks' in c
          ? label(c.lacks)
          : counter(c.counter)
    ),
    ...target.effects.map((e) =>
      'set' in e ? label(e.set) : 'clear' in e ? label(e.clear) : counter(e.add)
    ),
  ];
}

describe('tour game rules - properties', () => {
  it('never breaks a floor or the integers under any sequence of actions', () => {
    fc.assert(
      fc.property(game, fc.array(action, { maxLength: 25 }), (g, actions) => {
        let s = startRun(g);
        const seen = problems(g, s);
        for (const a of actions) {
          s = step(g, s, a);
          seen.push(...problems(g, s));
        }
        expect(seen).toEqual([]);
      }),
      { numRuns: 300 }
    );
  });

  // The rules return new states; a view that keeps the old one (to undo,
  // or to show "before") must be able to trust it.
  it('never mutates the state it is given, chosen or answered', () => {
    fc.assert(
      fc.property(
        game,
        fc.array(action, { maxLength: 10 }),
        fc.array(condition, { maxLength: 2 }),
        effects,
        fc.boolean(),
        (g, before, requires, fx, correct) => {
          const s = reached(g, before);
          const copy = JSON.parse(JSON.stringify(s)) as TourGameRunState;
          chooseOption(g, s, { id: 'o', requires, effects: fx });
          answerQuiz(g, s, { correct: fx, wrong: fx }, correct);
          expect(s).toEqual(copy);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('keeps exactly the collectible labels and counters in a new round', () => {
    fc.assert(
      fc.property(game, fc.array(action, { maxLength: 20 }), (g, actions) => {
        const s = reached(g, actions);
        const next = startNextRound(g, s);
        const collectible = new Set(
          g.labels.filter((l) => l.keep === 'collectible').map((l) => l.id)
        );
        expect(next.round).toBe(s.round + 1);
        expect(next.labels).toEqual(
          s.labels.filter((id) => collectible.has(id))
        );
        for (const c of g.counters) {
          expect(next.counters[c.id]).toBe(
            c.keep === 'collectible' ? s.counters[c.id] : c.start
          );
        }
      }),
      { numRuns: 300 }
    );
  });

  it('lists every label once, in order, shown exactly by held, keep and secret', () => {
    fc.assert(
      fc.property(game, fc.array(action, { maxLength: 20 }), (g, actions) => {
        const s = reached(g, actions);
        const listed = inventory(g, s);
        expect(listed.labels.map((l) => l.id)).toEqual(
          g.labels.map((l) => l.id)
        );
        for (const l of listed.labels) {
          const held = s.labels.includes(l.id);
          const missing = l.secret || l.keep === 'round' ? 'hidden' : 'greyed';
          expect(l.held).toBe(held);
          expect(l.shown).toBe(held ? 'held' : missing);
        }
        expect(listed.counters.map((c) => [c.id, c.value, c.shown])).toEqual(
          g.counters.map((c) => [
            c.id,
            s.counters[c.id],
            c.secret === true ? 'hidden' : 'value',
          ])
        );
      }),
      { numRuns: 300 }
    );
  });

  // The needs a greyed option lists are what the view tells the visitor
  // ("needs 2 coins and the red key"): they must be enough and each one
  // necessary, or the visitor is told a wrong price.
  it('lists needs that are enough together and each one necessary', () => {
    let greyed = 0;
    fc.assert(
      fc.property(
        game,
        fc.array(action, { maxLength: 10 }),
        fc.array(condition, { maxLength: 3 }),
        effects,
        (g, before, requires, fx) => {
          const s = reached(g, before);
          const target = { id: 'o', requires, effects: fx };
          const shown = optionDisplay(g, s, target);
          if (shown.shown !== 'greyed') return;
          greyed += 1;
          expect(shown.needs.length).toBeGreaterThan(0);
          expect(chooseOption(g, meeting(s, shown.needs), target).ok).toBe(
            true
          );
          shown.needs.forEach((_, k) => {
            const allBut = shown.needs.filter((__, j) => j !== k);
            expect(chooseOption(g, meeting(s, allBut), target).ok).toBe(false);
          });
        }
      ),
      { numRuns: 400 }
    );
    expect(greyed).toBeGreaterThan(0);
  });

  // A typed answer's input is one box for two possible outcomes: offered
  // only when both could be paid, and a greyed box's needs must be
  // exactly what makes both payable.
  it('offers a typed input only when both outcomes can be paid, with needs that are exact', () => {
    let greyed = 0;
    fc.assert(
      fc.property(
        game,
        fc.array(action, { maxLength: 10 }),
        effects,
        effects,
        (g, before, correct, wrong) => {
          const s = reached(g, before);
          const outcomes = { correct, wrong };
          const both = (at: TourGameRunState) =>
            answerQuiz(g, at, outcomes, true).ok &&
            answerQuiz(g, at, outcomes, false).ok;
          const shown = quizInputDisplay(g, s, outcomes);
          expect(shown.shown === 'available').toBe(both(s));
          const needs = shown.shown === 'greyed' ? shown.needs : [];
          if (needs.length > 0) greyed += 1;
          expect(needs.length === 0 || both(meeting(s, needs))).toBe(true);
          const partial = needs.map((_, k) =>
            both(
              meeting(
                s,
                needs.filter((__, j) => j !== k)
              )
            )
          );
          expect(partial.filter(Boolean)).toEqual([]);
        }
      ),
      { numRuns: 400 }
    );
    expect(greyed).toBeGreaterThan(0);
  });

  // Hiding is reserved for the creator's secrets and the creator's
  // mistakes; anything else blocked must be greyed with its price. A
  // typed quiz's input is hidden exactly when one of its two outcomes
  // would be, so it inherits the same rule.
  it('hides an option only for a secret or a name or number the game cannot read', () => {
    let hidden = 0;
    let hiddenInputs = 0;
    fc.assert(
      fc.property(
        game,
        fc.array(action, { maxLength: 10 }),
        fc.array(condition, { maxLength: 3 }),
        effects,
        effects,
        (g, before, requires, fx, other) => {
          const s = reached(g, before);
          const target = { requires, effects: fx };
          const shown = optionDisplay(g, s, target);
          const outcomeHidden = [fx, other].some(
            (e) => optionDisplay(g, s, { effects: e }).shown === 'hidden'
          );
          const input = quizInputDisplay(g, s, { correct: fx, wrong: other });
          expect(input.shown === 'hidden').toBe(outcomeHidden);
          if (outcomeHidden) hiddenInputs += 1;
          const secrets = new Set(
            [...g.labels, ...g.counters]
              .filter((d) => d.secret === true)
              .map((d) => d.id)
          );
          const needs = shown.shown === 'greyed' ? shown.needs : [];
          const secretNeeds = needs.filter((n) =>
            secrets.has('has' in n ? n.has : 'lacks' in n ? n.lacks : n.counter)
          );
          expect(secretNeeds).toEqual([]);
          if (shown.shown !== 'hidden') return;
          hidden += 1;
          const declared = {
            label: new Set(g.labels.map((l) => l.id)),
            counter: new Set(g.counters.map((c) => c.id)),
          };
          const used = namesOf(target);
          const secret = [...g.labels, ...g.counters].some(
            (d) => d.secret === true && used.some((u) => u.name === d.id)
          );
          const unreadable =
            used.some((u) => !declared[u.kind].has(u.name)) ||
            fx.some(
              (e) => 'add' in e && (!Number.isInteger(e.by) || e.by === 0)
            ) ||
            requires.some((c) =>
              'has' in c
                ? requires.some((d) => 'lacks' in d && d.lacks === c.has)
                : false
            );
          expect(secret || unreadable).toBe(true);
        }
      ),
      { numRuns: 400 }
    );
    expect(hidden).toBeGreaterThan(0);
    expect(hiddenInputs).toBeGreaterThan(0);
  });
});
