/**
 * Why this test matters: the examples pin single rules; these properties
 * pin what must hold under ANY sequence a visitor can produce. Random
 * games (including undeclared names, zero and fractional adds) and random
 * sequences of chosen options, quiz outcomes and new rounds must never
 * push a counter below its floor or off the integers, a refused option
 * must change nothing, a new round must keep exactly the collectible
 * labels and counters, and the inventory must list every label once and
 * show it exactly by whether it is held and secret.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  answerQuiz,
  availability,
  chooseOption,
  inventory,
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
    secret: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
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
  if (a.kind === 'quiz') {
    const outcomes = a.correct ? { correct: a.effects } : { wrong: a.effects };
    return answerQuiz(g, s, outcomes, a.correct);
  }
  const result = chooseOption(g, s, {
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

  // Choosing never mutates the state it is given, and it refuses exactly
  // when availability says the option is unavailable: the two cannot
  // drift apart.
  it('refuses exactly what availability refuses, and never mutates the state', () => {
    fc.assert(
      fc.property(
        game,
        fc.array(action, { maxLength: 10 }),
        fc.array(condition, { maxLength: 2 }),
        effects,
        (g, before, requires, fx) => {
          const s = before.reduce((acc, a) => step(g, acc, a), startRun(g));
          const copy = JSON.parse(JSON.stringify(s)) as TourGameRunState;
          const result = chooseOption(g, s, { id: 'o', requires, effects: fx });
          const option = { id: 'o', requires, effects: fx };
          expect(result.ok).toBe(availability(g, s, option).available);
          expect(s).toEqual(copy);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('keeps exactly the collectible labels and counters in a new round', () => {
    fc.assert(
      fc.property(game, fc.array(action, { maxLength: 20 }), (g, actions) => {
        const s = actions.reduce((acc, a) => step(g, acc, a), startRun(g));
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

  it('lists every label once, in order, shown exactly by held and secret', () => {
    fc.assert(
      fc.property(game, fc.array(action, { maxLength: 20 }), (g, actions) => {
        const s = actions.reduce((acc, a) => step(g, acc, a), startRun(g));
        const listed = inventory(g, s);
        expect(listed.labels.map((l) => l.id)).toEqual(
          g.labels.map((l) => l.id)
        );
        for (const l of listed.labels) {
          const held = s.labels.includes(l.id);
          expect(l.held).toBe(held);
          expect(l.shown).toBe(held ? 'held' : l.secret ? 'hidden' : 'greyed');
        }
        expect(listed.counters.map((c) => [c.id, c.value])).toEqual(
          g.counters.map((c) => [c.id, s.counters[c.id]])
        );
      }),
      { numRuns: 300 }
    );
  });
});
