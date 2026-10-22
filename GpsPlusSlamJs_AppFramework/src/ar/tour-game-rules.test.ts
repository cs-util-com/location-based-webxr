/**
 * Why this test matters: these are the rules a visitor's phone applies to
 * labels and counters while a tour is walked - what shows, which answers
 * can be picked, what an answer changes, and what a new round keeps. Each
 * rule is pinned by the smallest example that would break if the rule
 * were misread: the floor judged on a whole effect list, a refused option
 * or quiz answer that changes nothing, a typo that hides content instead
 * of revealing it, a blocked option greyed with what it needs unless a
 * secret blocks it, and a scene that ends on a jump to no step.
 */

import { describe, expect, it } from 'vitest';

import {
  answerQuiz,
  availability,
  chooseOption,
  inventory,
  nextAvailableStep,
  optionDisplay,
  startNextRound,
  startRun,
  stepAfter,
  type TourGame,
  type TourGameRunState,
  type TourGameStep,
} from './tour-game-rules';

const GAME: TourGame = {
  labels: [
    { id: 'red-key', name: 'Red key', keep: 'collectible' },
    { id: 'crown', name: 'Crown', keep: 'collectible', secret: true },
    { id: 'north', name: 'North path', keep: 'round' },
  ],
  counters: [
    { id: 'coins', name: 'Coins', keep: 'round', start: 0, floor: 0 },
    { id: 'stars', name: 'Stars', keep: 'collectible', start: 1, floor: 0 },
  ],
  stations: [],
};

function withState(
  labels: readonly string[],
  counters: Readonly<Record<string, number>>,
  round = 1
): TourGameRunState {
  return { round, labels, counters };
}

describe('startRun', () => {
  it('starts round 1 with no label held and every counter at its start', () => {
    expect(startRun(GAME)).toEqual({
      round: 1,
      labels: [],
      counters: { coins: 0, stars: 1 },
    });
  });
});

describe('availability', () => {
  it('holds for no requirement and for an empty list', () => {
    const s = startRun(GAME);
    expect(availability(GAME, s, {})).toEqual({ available: true });
    expect(availability(GAME, s, { requires: [] })).toEqual({
      available: true,
    });
  });

  it('needs every condition of the list (all of)', () => {
    const s = withState(['red-key'], { coins: 3, stars: 1 });
    expect(
      availability(GAME, s, {
        requires: [{ has: 'red-key' }, { counter: 'coins', atLeast: 3 }],
      }).available
    ).toBe(true);
    expect(
      availability(GAME, s, {
        requires: [{ has: 'red-key' }, { counter: 'coins', atLeast: 4 }],
      })
    ).toEqual({
      available: false,
      reason: {
        kind: 'requires',
        condition: { counter: 'coins', atLeast: 4 },
      },
    });
  });

  it('reads lacks as the label not being held', () => {
    const none = startRun(GAME);
    const held = withState(['red-key'], { coins: 0, stars: 1 });
    expect(
      availability(GAME, none, { requires: [{ lacks: 'red-key' }] }).available
    ).toBe(true);
    expect(
      availability(GAME, held, { requires: [{ lacks: 'red-key' }] }).available
    ).toBe(false);
  });

  // A typo in a hand-edited file must hide content, never reveal it: an
  // unknown name fails `has`, `lacks` and `atLeast` alike, and a label id
  // used as a counter (or the reverse) counts as unknown.
  it('never holds a condition naming an undeclared label or counter', () => {
    const s = startRun(GAME);
    for (const condition of [
      { has: 'red-kee' },
      { lacks: 'red-kee' },
      { counter: 'gold', atLeast: 0 },
      { has: 'coins' },
      { counter: 'red-key', atLeast: 0 },
    ]) {
      expect(availability(GAME, s, { requires: [condition] }).available).toBe(
        false
      );
    }
  });

  it('refuses an option whose effects would end below a floor, saying by how much', () => {
    const s = withState([], { coins: 1, stars: 1 });
    expect(
      availability(GAME, s, { effects: [{ add: 'coins', by: -2 }] })
    ).toEqual({
      available: false,
      reason: { kind: 'floor', counter: 'coins', need: 1 },
    });
  });

  // The floor is judged on the result of the whole list, not after each
  // effect: "pay 2, receive 3" from 1 coin ends at 2.
  it('judges the floor on the net result of the effect list', () => {
    const s = withState([], { coins: 1, stars: 1 });
    expect(
      availability(GAME, s, {
        effects: [
          { add: 'coins', by: -2 },
          { add: 'coins', by: 3 },
        ],
      }).available
    ).toBe(true);
  });

  it('refuses an option with an effect it cannot apply', () => {
    const s = startRun(GAME);
    for (const effect of [
      { set: 'nope' },
      { clear: 'coins' },
      { add: 'nope', by: 1 },
      { add: 'coins', by: 0 },
      { add: 'coins', by: 1.5 },
      { add: 'coins', by: Number.NaN },
    ]) {
      const result = availability(GAME, s, { effects: [effect] });
      expect(result).toEqual({
        available: false,
        reason: { kind: 'invalid-effect', effect },
      });
    }
  });

  it('reports a failing requirement before a floor', () => {
    const s = startRun(GAME);
    const result = availability(GAME, s, {
      requires: [{ has: 'red-key' }],
      effects: [{ add: 'coins', by: -5 }],
    });
    expect(result.available === false && result.reason.kind).toBe('requires');
  });

  // Ids are path-safe ([A-Za-z0-9_-]), which admits "__proto__": a state
  // record must never read an inherited property as a counter value.
  it('does not read inherited properties as counters', () => {
    const game: TourGame = {
      labels: [],
      counters: [
        { id: '__proto__', name: 'Odd', keep: 'round', start: 0, floor: 0 },
      ],
      stations: [],
    };
    const bare = withState([], {});
    expect(
      availability(game, bare, {
        requires: [{ counter: '__proto__', atLeast: 1 }],
      }).available
    ).toBe(false);
    // A counter missing from a state reads as its start, never as the
    // inherited Object.prototype.
    const fromBare = chooseOption(game, bare, {
      id: 'o',
      effects: [{ add: '__proto__', by: 2 }],
    });
    expect(fromBare.ok && fromBare.state.counters['__proto__']).toBe(2);
    const s = startRun(game);
    expect(Object.hasOwn(s.counters, '__proto__')).toBe(true);
    const paid = chooseOption(game, s, {
      id: 'o',
      effects: [{ add: '__proto__', by: 2 }],
    });
    expect(paid.ok && Object.hasOwn(paid.state.counters, '__proto__')).toBe(
      true
    );
    expect(paid.ok && paid.state.counters['__proto__']).toBe(2);
  });
});

describe('chooseOption', () => {
  it('applies set, clear and add in order', () => {
    const s = withState(['north'], { coins: 2, stars: 1 });
    const result = chooseOption(GAME, s, {
      id: 'buy',
      effects: [
        { set: 'red-key' },
        { clear: 'north' },
        { add: 'coins', by: -2 },
      ],
    });
    expect(result).toEqual({
      ok: true,
      state: withState(['red-key'], { coins: 0, stars: 1 }),
    });
  });

  it('is idempotent for labels: set twice or clear a missing one', () => {
    const s = withState(['red-key'], { coins: 0, stars: 1 });
    const result = chooseOption(GAME, s, {
      id: 'o',
      effects: [{ set: 'red-key' }, { clear: 'north' }],
    });
    expect(result).toEqual({ ok: true, state: s });
  });

  it('lets a later effect on the same label win', () => {
    const s = startRun(GAME);
    const result = chooseOption(GAME, s, {
      id: 'o',
      effects: [{ set: 'north' }, { clear: 'north' }],
    });
    expect(result.ok && result.state.labels).toEqual([]);
  });

  it('keeps labels sorted and unique', () => {
    const s = startRun(GAME);
    const result = chooseOption(GAME, s, {
      id: 'o',
      effects: [{ set: 'north' }, { set: 'crown' }, { set: 'red-key' }],
    });
    expect(result.ok && result.state.labels).toEqual([
      'crown',
      'north',
      'red-key',
    ]);
  });

  it('changes nothing when refused (all or nothing)', () => {
    const s = withState([], { coins: 1, stars: 1 });
    const result = chooseOption(GAME, s, {
      id: 'buy',
      effects: [{ set: 'red-key' }, { add: 'coins', by: -2 }],
    });
    expect(result).toEqual({
      ok: false,
      reason: { kind: 'floor', counter: 'coins', need: 1 },
    });
    expect(s).toEqual(withState([], { coins: 1, stars: 1 }));
  });

  it('refuses an option whose requirement fails', () => {
    const result = chooseOption(GAME, startRun(GAME), {
      id: 'o',
      requires: [{ has: 'red-key' }],
      effects: [{ set: 'crown' }],
    });
    expect(result).toEqual({
      ok: false,
      reason: { kind: 'requires', condition: { has: 'red-key' } },
    });
  });

  it('accepts an option with no effects as a no-op', () => {
    const s = startRun(GAME);
    expect(chooseOption(GAME, s, { id: 'leave' })).toEqual({
      ok: true,
      state: s,
    });
  });
});

describe('answerQuiz', () => {
  const quiz = {
    correct: [{ set: 'red-key' }, { add: 'coins', by: 2 }],
    wrong: [{ add: 'coins', by: -2 }],
  } as const;

  it('applies the outcome of a right or a wrong answer', () => {
    const s = startRun(GAME);
    expect(answerQuiz(GAME, s, quiz, true)).toEqual({
      ok: true,
      state: withState(['red-key'], { coins: 2, stars: 1 }),
    });
    expect(
      answerQuiz(GAME, withState([], { coins: 3, stars: 1 }), quiz, false)
    ).toEqual({ ok: true, state: withState([], { coins: 1, stars: 1 }) });
  });

  // A quiz answer is an option like any other: one whose cost the
  // visitor cannot pay is unavailable and changes nothing - it is never
  // clamped at the floor.
  it('refuses an answer whose cost the visitor cannot pay, changing nothing', () => {
    const s = withState([], { coins: 1, stars: 1 });
    expect(answerQuiz(GAME, s, quiz, false)).toEqual({
      ok: false,
      reason: { kind: 'floor', counter: 'coins', need: 1 },
    });
    expect(s).toEqual(withState([], { coins: 1, stars: 1 }));
  });

  it('refuses an outcome with an effect it cannot apply', () => {
    const result = answerQuiz(
      GAME,
      startRun(GAME),
      { correct: [{ set: 'nope' }, { set: 'north' }] },
      true
    );
    expect(result).toEqual({
      ok: false,
      reason: { kind: 'invalid-effect', effect: { set: 'nope' } },
    });
  });

  // A counter already below its floor (a malformed state) is left alone
  // by an answer that does not touch it: nothing lifts it to the floor.
  it('leaves a counter the outcome does not touch as it is', () => {
    const s = withState([], { coins: -2, stars: 1 });
    expect(answerQuiz(GAME, s, { correct: [{ set: 'north' }] }, true)).toEqual({
      ok: true,
      state: withState(['north'], { coins: -2, stars: 1 }),
    });
  });

  it('changes nothing for an outcome with no effects', () => {
    const s = startRun(GAME);
    expect(answerQuiz(GAME, s, {}, false)).toEqual({ ok: true, state: s });
  });
});

describe('optionDisplay', () => {
  const SECRETS: TourGame = {
    labels: [
      { id: 'red-key', name: 'Red key', keep: 'collectible' },
      { id: 'crown', name: 'Crown', keep: 'collectible', secret: true },
    ],
    counters: [
      { id: 'coins', name: 'Coins', keep: 'round', start: 0, floor: 0 },
      {
        id: 'karma',
        name: 'Karma',
        keep: 'round',
        start: 0,
        floor: 0,
        secret: true,
      },
    ],
    stations: [],
  };
  const none = startRun(SECRETS);

  it('shows an option the visitor can take as available', () => {
    expect(optionDisplay(SECRETS, none, {})).toEqual({ shown: 'available' });
  });

  // The visitor learns the price: every visible thing that blocks the
  // option is listed, so the view can say "needs 2 coins and the red key".
  it('greys an option blocked only by visible names, listing every need', () => {
    expect(
      optionDisplay(SECRETS, none, {
        requires: [{ has: 'red-key' }, { counter: 'coins', atLeast: 2 }],
      })
    ).toEqual({
      shown: 'greyed',
      needs: [{ has: 'red-key' }, { counter: 'coins', need: 2 }],
    });
    const held = withState(['red-key'], { coins: 0, karma: 0 });
    expect(
      optionDisplay(SECRETS, held, { requires: [{ lacks: 'red-key' }] })
    ).toEqual({ shown: 'greyed', needs: [{ lacks: 'red-key' }] });
  });

  // A requirement and a cost on one counter are one need: the larger
  // shortfall, since meeting it meets both.
  it('merges a requirement and a cost on one counter into the larger need', () => {
    const s = withState([], { coins: 1, karma: 0 });
    expect(
      optionDisplay(SECRETS, s, {
        requires: [{ counter: 'coins', atLeast: 3 }],
        effects: [{ add: 'coins', by: -2 }],
      })
    ).toEqual({ shown: 'greyed', needs: [{ counter: 'coins', need: 2 }] });
    expect(
      optionDisplay(SECRETS, s, {
        requires: [{ counter: 'coins', atLeast: 2 }],
        effects: [{ add: 'coins', by: -4 }],
      })
    ).toEqual({ shown: 'greyed', needs: [{ counter: 'coins', need: 3 }] });
  });

  it('hides an option when any label or counter blocking it is secret', () => {
    expect(
      optionDisplay(SECRETS, none, {
        requires: [{ has: 'red-key' }, { has: 'crown' }],
      })
    ).toEqual({ shown: 'hidden' });
    expect(
      optionDisplay(SECRETS, none, { effects: [{ add: 'karma', by: -1 }] })
    ).toEqual({ shown: 'hidden' });
    expect(
      optionDisplay(SECRETS, none, {
        requires: [{ counter: 'karma', atLeast: 1 }],
      })
    ).toEqual({ shown: 'hidden' });
  });

  // A secret that does NOT block the option reveals nothing, so it does
  // not hide it.
  it('greys an option whose secret condition holds and a visible one fails', () => {
    const s = withState(['crown'], { coins: 0, karma: 0 });
    expect(
      optionDisplay(SECRETS, s, {
        requires: [{ has: 'crown' }, { has: 'red-key' }],
      })
    ).toEqual({ shown: 'greyed', needs: [{ has: 'red-key' }] });
  });

  // A typo hides content: an undeclared name, an effect the game cannot
  // apply, or a requirement that is no whole number never greys.
  it('hides an option blocked by something the game cannot read', () => {
    for (const target of [
      { requires: [{ has: 'red-kee' }] },
      { requires: [{ counter: 'coins', atLeast: 1.5 }] },
      { effects: [{ add: 'coins', by: 0 }] },
      { effects: [{ set: 'nope' }] },
    ]) {
      expect(optionDisplay(SECRETS, none, target)).toEqual({
        shown: 'hidden',
      });
    }
  });
});

describe('stepAfter', () => {
  const steps: TourGameStep[] = [
    { id: 'a', kind: 'content' },
    { id: 'b', kind: 'content' },
    { id: 'b', kind: 'content' },
  ];

  it('continues at the next step, and ends after the last', () => {
    expect(stepAfter(steps, 0)).toBe(1);
    expect(stepAfter(steps, 2)).toBe(-1);
  });

  it('follows a goto to the first step with that id, backwards too', () => {
    expect(stepAfter(steps, 0, { goto: 'b' })).toBe(1);
    expect(stepAfter(steps, 2, { goto: 'a' })).toBe(0);
  });

  // A jump to no step must end the scene, never restart it: a restart
  // would replay the choice and pay its effects again.
  it('ends the scene on a goto naming no step, and for a from that is no step', () => {
    expect(stepAfter(steps, 0, { goto: 'nope' })).toBe(-1);
    for (const from of [-1, 3, 0.5, Number.NaN]) {
      expect(stepAfter(steps, from)).toBe(-1);
    }
  });
});

describe('nextAvailableStep', () => {
  const steps: TourGameStep[] = [
    { id: 'a', kind: 'content' },
    { id: 'b', kind: 'content', requires: [{ has: 'red-key' }] },
    { id: 'c', kind: 'content' },
  ];

  it('passes over a step whose requirement fails', () => {
    const s = startRun(GAME);
    expect(nextAvailableStep(GAME, s, steps, 0)).toBe(0);
    expect(nextAvailableStep(GAME, s, steps, 1)).toBe(2);
    const held = withState(['red-key'], { coins: 0, stars: 1 });
    expect(nextAvailableStep(GAME, held, steps, 1)).toBe(1);
  });

  // -1 is "the scene has ended" everywhere, so feeding stepAfter's -1
  // back in must keep the scene ended rather than start it again.
  it('returns -1 at the end, and for a start that is no index', () => {
    const s = startRun(GAME);
    expect(nextAvailableStep(GAME, s, steps, 3)).toBe(-1);
    expect(nextAvailableStep(GAME, s, [steps[1]!], 0)).toBe(-1);
    expect(nextAvailableStep(GAME, s, steps, Number.NaN)).toBe(-1);
    expect(nextAvailableStep(GAME, s, steps, -1)).toBe(-1);
    expect(nextAvailableStep(GAME, s, steps, -4)).toBe(-1);
  });
});

describe('inventory', () => {
  it('lists every label in order: held, greyed, or hidden when secret', () => {
    const s = withState(['north'], { coins: 2, stars: 1 });
    expect(inventory(GAME, s)).toEqual({
      labels: [
        {
          id: 'red-key',
          name: 'Red key',
          keep: 'collectible',
          secret: false,
          held: false,
          shown: 'greyed',
        },
        {
          id: 'crown',
          name: 'Crown',
          keep: 'collectible',
          secret: true,
          held: false,
          shown: 'hidden',
        },
        {
          id: 'north',
          name: 'North path',
          keep: 'round',
          secret: false,
          held: true,
          shown: 'held',
        },
      ],
      counters: [
        {
          id: 'coins',
          name: 'Coins',
          keep: 'round',
          secret: false,
          value: 2,
          shown: 'value',
        },
        {
          id: 'stars',
          name: 'Stars',
          keep: 'collectible',
          secret: false,
          value: 1,
          shown: 'value',
        },
      ],
    });
  });

  // A round label (a path) says nothing a visitor can act on while not
  // held, so it is shown while held and never greyed.
  it('hides a round label that is not held, and shows it while held', () => {
    const labels = inventory(GAME, startRun(GAME)).labels;
    expect(labels[2]).toMatchObject({ id: 'north', shown: 'hidden' });
  });

  it('hides a secret counter, value and all', () => {
    const game: TourGame = {
      ...GAME,
      counters: [
        {
          id: 'karma',
          name: 'Karma',
          keep: 'round',
          start: 3,
          floor: 0,
          secret: true,
        },
      ],
    };
    expect(inventory(game, startRun(game)).counters).toEqual([
      {
        id: 'karma',
        name: 'Karma',
        keep: 'round',
        secret: true,
        value: 3,
        shown: 'hidden',
      },
    ]);
  });

  it('shows a secret label once it is held', () => {
    const s = withState(['crown'], { coins: 0, stars: 1 });
    expect(inventory(GAME, s).labels[1]).toMatchObject({
      held: true,
      shown: 'held',
    });
  });

  // A state saved before the tour declared a counter (or a hand-built one)
  // reads that counter as its start everywhere.
  it('shows a counter missing from the state at its start', () => {
    expect(inventory(GAME, withState([], {})).counters[0]?.value).toBe(0);
  });
});

describe('startNextRound', () => {
  it('keeps the collectibles, forgets the round, and counts the round', () => {
    const s = withState(
      ['crown', 'north', 'red-key'],
      { coins: 5, stars: 4 },
      2
    );
    expect(startNextRound(GAME, s)).toEqual(
      withState(['crown', 'red-key'], { coins: 0, stars: 4 }, 3)
    );
  });

  it('drops a held label the tour no longer declares', () => {
    const s = withState(['ghost', 'red-key'], { coins: 0, stars: 1 });
    expect(startNextRound(GAME, s).labels).toEqual(['red-key']);
  });
});
