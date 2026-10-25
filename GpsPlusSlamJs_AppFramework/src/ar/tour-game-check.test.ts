/**
 * Why this test matters: these checks are what a creator sees before a
 * visitor finds the mistake on site - a station nothing unlocks, a label
 * nothing gives, a requirement that contradicts itself or asks for more
 * coins than the tour can ever pay, an option nobody can pick, a choice
 * that can trap the visitor. Each finding is pinned by the smallest tour
 * that produces it, and by its near miss that must stay silent: a check
 * that cries wolf teaches creators to ignore it.
 */

import { describe, expect, it } from 'vitest';

import { checkTourGame } from './tour-game-check';
import type { TourGame } from './tour-game-rules';

const LABELS: TourGame['labels'] = [
  { id: 'key', name: 'Key', keep: 'collectible' },
  { id: 'path', name: 'Path', keep: 'round' },
];
const COINS: TourGame['counters'] = [
  { id: 'coins', name: 'Coins', keep: 'round', start: 0, floor: 0 },
];

/** A station whose one choice offers the given effects, plus "leave". */
function giver(id: string, effects: TourGame['stations'][number]['steps']) {
  return { id, steps: effects };
}

function choiceStep(
  id: string,
  options: {
    id: string;
    effects?: unknown[];
    requires?: unknown[];
    goto?: string;
  }[]
): TourGame['stations'][number]['steps'][number] {
  return {
    id,
    kind: 'choice',
    options: options as never,
  };
}

const LEAVE = { id: 'leave' };

describe('checkTourGame - a clean tour', () => {
  it('reports nothing when every label is given and every gate can open', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: COINS,
      stations: [
        giver('a', [
          choiceStep('c', [
            { id: 'k', effects: [{ set: 'key' }, { set: 'path' }] },
            { id: 'pay', effects: [{ add: 'coins', by: 2 }] },
            LEAVE,
          ]),
        ]),
        { id: 'b', requires: [{ has: 'key' }, { has: 'path' }], steps: [] },
        {
          id: 'c',
          requires: [{ counter: 'coins', atLeast: 2 }],
          steps: [],
          items: [{ id: 'i', requires: [{ lacks: 'key' }] }],
        },
      ],
    };
    expect(checkTourGame(game)).toEqual([]);
  });
});

describe('checkTourGame - structural findings', () => {
  it('reports a name declared twice, across labels and counters', () => {
    const game: TourGame = {
      labels: [...LABELS, { id: 'coins', name: 'Coins', keep: 'round' }],
      counters: COINS,
      stations: [
        giver('a', [
          choiceStep('c', [
            {
              id: 'k',
              effects: [
                { set: 'key' },
                { set: 'path' },
                { add: 'coins', by: 1 },
              ],
            },
            LEAVE,
          ]),
        ]),
      ],
    };
    expect(checkTourGame(game)).toContainEqual({
      kind: 'duplicate-name',
      name: 'coins',
    });
  });

  it('reports a condition or effect naming something undeclared', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: COINS,
      stations: [
        giver('a', [
          choiceStep('c', [
            {
              id: 'k',
              effects: [{ set: 'key' }, { set: 'path' }, { set: 'gem' }],
            },
            LEAVE,
          ]),
        ]),
        { id: 'b', requires: [{ has: 'coins' }], steps: [] },
      ],
    };
    const findings = checkTourGame(game);
    expect(findings).toContainEqual({
      kind: 'unknown-name',
      name: 'gem',
      at: { station: 'a', step: 'c', option: 'k' },
    });
    expect(findings).toContainEqual({
      kind: 'unknown-name',
      name: 'coins',
      at: { station: 'b' },
    });
  });

  it('reports numbers that are not integers, a zero add, and a start below the floor', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [
        { id: 'coins', name: 'Coins', keep: 'round', start: -1, floor: 0 },
        { id: 'gems', name: 'Gems', keep: 'round', start: 0.5, floor: 0 },
      ],
      stations: [
        giver('a', [
          choiceStep('c', [
            {
              id: 'k',
              effects: [
                { set: 'key' },
                { set: 'path' },
                { add: 'coins', by: 0 },
              ],
            },
            LEAVE,
          ]),
        ]),
        { id: 'b', requires: [{ counter: 'coins', atLeast: 1.5 }], steps: [] },
      ],
    };
    const findings = checkTourGame(game);
    expect(findings).toContainEqual({
      kind: 'start-below-floor',
      counter: 'coins',
    });
    expect(findings).toContainEqual({
      kind: 'bad-number',
      field: 'start',
      at: { counter: 'gems' },
    });
    expect(findings).toContainEqual({
      kind: 'bad-number',
      field: 'by',
      at: { station: 'a', step: 'c', option: 'k' },
    });
    expect(findings).toContainEqual({
      kind: 'bad-number',
      field: 'atLeast',
      at: { station: 'b' },
    });
  });

  it('reports a goto naming no step of its station', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [],
      stations: [
        giver('a', [
          choiceStep('c', [
            {
              id: 'k',
              effects: [{ set: 'key' }, { set: 'path' }],
              goto: 'nowhere',
            },
            LEAVE,
          ]),
        ]),
      ],
    };
    expect(checkTourGame(game)).toContainEqual({
      kind: 'unknown-step',
      step: 'nowhere',
      at: { station: 'a', step: 'c', option: 'k' },
    });
  });

  it('reports duplicate station, step, item and option ids', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [],
      stations: [
        {
          id: 'a',
          steps: [
            choiceStep('c', [
              { id: 'k', effects: [{ set: 'key' }, { set: 'path' }] },
              { id: 'k' },
            ]),
            { id: 'c', kind: 'content' },
          ],
          items: [{ id: 'i' }, { id: 'i' }],
        },
        { id: 'a', steps: [] },
      ],
    };
    const findings = checkTourGame(game);
    expect(findings).toContainEqual({
      kind: 'duplicate-id',
      id: 'a',
      within: null,
    });
    expect(findings).toContainEqual({
      kind: 'duplicate-id',
      id: 'c',
      within: { station: 'a' },
    });
    expect(findings).toContainEqual({
      kind: 'duplicate-id',
      id: 'i',
      within: { station: 'a' },
    });
    expect(findings).toContainEqual({
      kind: 'duplicate-id',
      id: 'k',
      within: { station: 'a', step: 'c' },
    });
  });

  it('reports a declared label that no effect anywhere sets', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [],
      stations: [
        giver('a', [
          choiceStep('c', [{ id: 'k', effects: [{ set: 'key' }] }, LEAVE]),
        ]),
      ],
    };
    expect(checkTourGame(game)).toEqual([
      { kind: 'label-never-set', label: 'path' },
    ]);
  });
});

describe('checkTourGame - reachability', () => {
  it('reports a station requiring a label nothing sets, and only the station', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [],
      stations: [
        giver('a', [
          choiceStep('c', [{ id: 'k', effects: [{ set: 'key' }] }, LEAVE]),
        ]),
        {
          id: 'b',
          requires: [{ has: 'path' }],
          steps: [{ id: 's', kind: 'content', requires: [{ has: 'path' }] }],
          items: [{ id: 'i' }],
        },
      ],
    };
    expect(checkTourGame(game)).toEqual([
      { kind: 'label-never-set', label: 'path' },
      {
        kind: 'unreachable',
        at: { station: 'b' },
        because: { kind: 'label-never-set', label: 'path' },
      },
    ]);
  });

  it('reports a label set only by content that is itself unreachable', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [],
      stations: [
        {
          id: 'a',
          requires: [{ has: 'key' }],
          steps: [
            choiceStep('c', [
              { id: 'p', effects: [{ set: 'path' }, { set: 'key' }] },
              LEAVE,
            ]),
          ],
        },
      ],
    };
    // The key is set only inside the station that needs it: a circle.
    expect(checkTourGame(game)).toEqual([
      {
        kind: 'unreachable',
        at: { station: 'a' },
        because: {
          kind: 'label-set-only-by-unreachable-content',
          label: 'key',
        },
      },
    ]);
  });

  it('reports a requirement that contradicts itself', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [],
      stations: [
        giver('a', [
          choiceStep('c', [
            { id: 'k', effects: [{ set: 'key' }, { set: 'path' }] },
            LEAVE,
          ]),
        ]),
        {
          id: 'b',
          steps: [],
          items: [{ id: 'i', requires: [{ has: 'key' }, { lacks: 'key' }] }],
        },
      ],
    };
    expect(checkTourGame(game)).toEqual([
      {
        kind: 'unreachable',
        at: { station: 'b', item: 'i' },
        because: { kind: 'contradiction', label: 'key' },
      },
    ]);
  });

  it('reports a counter requirement above what the tour can ever pay', () => {
    const game: TourGame = {
      labels: [],
      counters: COINS,
      stations: [
        giver('a', [
          choiceStep('c', [
            { id: 'k', effects: [{ add: 'coins', by: 2 }] },
            LEAVE,
          ]),
        ]),
        giver('b', [
          choiceStep('c', [
            { id: 'k', effects: [{ add: 'coins', by: 1 }] },
            LEAVE,
          ]),
        ]),
        { id: 'gate', requires: [{ counter: 'coins', atLeast: 4 }], steps: [] },
      ],
    };
    expect(checkTourGame(game)).toEqual([
      {
        kind: 'unreachable',
        at: { station: 'gate' },
        because: {
          kind: 'counter-out-of-reach',
          counter: 'coins',
          atLeast: 4,
          max: 3,
        },
      },
    ]);
  });

  // A loop in a scene can pay out again and again, and a collectible
  // counter adds up over rounds: neither has a finite bound, so no
  // requirement on it is reported.
  it('treats a repeatable payout and a collectible counter as unbounded', () => {
    const looping: TourGame = {
      labels: [],
      counters: COINS,
      stations: [
        {
          id: 'a',
          steps: [
            { id: 'top', kind: 'content' },
            choiceStep('c', [
              { id: 'again', effects: [{ add: 'coins', by: 1 }], goto: 'top' },
              LEAVE,
            ]),
          ],
        },
        {
          id: 'gate',
          requires: [{ counter: 'coins', atLeast: 100 }],
          steps: [],
        },
      ],
    };
    expect(checkTourGame(looping)).toEqual([]);
    const collected: TourGame = {
      labels: [],
      counters: [
        { id: 'coins', name: 'Coins', keep: 'collectible', start: 0, floor: 0 },
      ],
      stations: [
        giver('a', [
          choiceStep('c', [
            { id: 'k', effects: [{ add: 'coins', by: 1 }] },
            LEAVE,
          ]),
        ]),
        {
          id: 'gate',
          requires: [{ counter: 'coins', atLeast: 100 }],
          steps: [],
        },
      ],
    };
    expect(checkTourGame(collected)).toEqual([]);
  });

  it('reports an option the floor always blocks', () => {
    const game: TourGame = {
      labels: [],
      counters: COINS,
      stations: [
        giver('a', [
          choiceStep('c', [
            { id: 'k', effects: [{ add: 'coins', by: 1 }] },
            LEAVE,
          ]),
        ]),
        giver('m', [
          choiceStep('buy', [
            { id: 'sword', effects: [{ add: 'coins', by: -2 }] },
            LEAVE,
          ]),
        ]),
      ],
    };
    expect(checkTourGame(game)).toEqual([
      {
        kind: 'option-never-available',
        at: { station: 'm', step: 'buy', option: 'sword' },
        because: { kind: 'floor', counter: 'coins', max: 1 },
      },
    ]);
  });

  it('reports an option whose requirement no walk satisfies', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [],
      stations: [
        giver('a', [
          choiceStep('c', [
            { id: 'k', effects: [{ set: 'key' }] },
            {
              id: 'p',
              requires: [{ has: 'nope' }],
              effects: [{ set: 'path' }],
            },
            LEAVE,
          ]),
        ]),
      ],
    };
    const findings = checkTourGame(game);
    expect(findings).toContainEqual({
      kind: 'option-never-available',
      at: { station: 'a', step: 'c', option: 'p' },
      because: { kind: 'unknown-name', name: 'nope' },
    });
    // `path` is set only by that option: unreachable content, not "never set".
    expect(findings).not.toContainEqual({
      kind: 'label-never-set',
      label: 'path',
    });
  });

  it('reports a step the scene flow never reaches', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [],
      stations: [
        {
          id: 'a',
          steps: [
            choiceStep('c', [
              {
                id: 'k',
                effects: [{ set: 'key' }, { set: 'path' }],
                goto: 'end',
              },
              { id: 'leave', goto: 'end' },
            ]),
            { id: 'skipped', kind: 'content' },
            { id: 'end', kind: 'content' },
          ],
        },
      ],
    };
    expect(checkTourGame(game)).toEqual([
      {
        kind: 'unreachable',
        at: { station: 'a', step: 'skipped' },
        because: { kind: 'scene-flow' },
      },
    ]);
  });

  it('reports a step whose own requirement can never hold', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [],
      stations: [
        giver('a', [
          choiceStep('c', [{ id: 'k', effects: [{ set: 'key' }] }, LEAVE]),
          { id: 's', kind: 'content', requires: [{ has: 'path' }] },
        ]),
      ],
    };
    expect(checkTourGame(game)).toContainEqual({
      kind: 'unreachable',
      at: { station: 'a', step: 's' },
      because: { kind: 'label-never-set', label: 'path' },
    });
  });

  // A jump to no step ends the scene (stepAfter): the payout cannot
  // repeat, so a requirement of two is truly out of reach. The exhaustive
  // walk in the property test agrees on this very tour.
  it('ends a scene on a goto naming no step, so its payout counts once', () => {
    const game: TourGame = {
      labels: [],
      counters: COINS,
      stations: [
        giver('a', [
          choiceStep('c', [
            { id: 'k', effects: [{ add: 'coins', by: 1 }], goto: 'nope' },
            LEAVE,
          ]),
        ]),
        { id: 'gate', requires: [{ counter: 'coins', atLeast: 2 }], steps: [] },
      ],
    };
    expect(checkTourGame(game)).toEqual([
      {
        kind: 'unknown-step',
        step: 'nope',
        at: { station: 'a', step: 'c', option: 'k' },
      },
      {
        kind: 'unreachable',
        at: { station: 'gate' },
        because: {
          kind: 'counter-out-of-reach',
          counter: 'coins',
          atLeast: 2,
          max: 1,
        },
      },
    ]);
  });

  // A chain the fixpoint climbs one option per pass: the bound must come
  // from the fixpoint itself, never from where a pass cap cut it off.
  it('climbs a long chain of options to its end, whatever its length', () => {
    for (const n of [1, 50, 100, 300]) {
      const options = Array.from({ length: n }, (_, k) => ({
        id: `o${String(k)}`,
        requires: [{ counter: 'coins', atLeast: k }],
        effects: [{ add: 'coins', by: 1 }],
      }));
      const game: TourGame = {
        labels: [],
        counters: COINS,
        stations: [
          giver('a', [choiceStep('c', [...options, LEAVE])]),
          {
            id: 'gate',
            requires: [{ counter: 'coins', atLeast: n }],
            steps: [],
          },
        ],
      };
      expect(checkTourGame(game)).toEqual([]);
    }
  });

  // A tour the rules would read differently from the check (a counter
  // declared twice, a start below its floor, a start that is no whole
  // number) gets its structural finding and NO reachability verdict: a
  // verdict on a misread tour could call reachable content unreachable.
  it('gives no reachability verdict on a tour with malformed declarations', () => {
    const twice: TourGame = {
      labels: [],
      counters: [
        ...COINS,
        { id: 'coins', name: 'Coins', keep: 'round', start: 5, floor: 0 },
      ],
      stations: [
        { id: 'gate', requires: [{ counter: 'coins', atLeast: 5 }], steps: [] },
      ],
    };
    expect(checkTourGame(twice)).toEqual([
      { kind: 'duplicate-name', name: 'coins' },
    ]);
    const below: TourGame = {
      labels: [],
      counters: [
        { id: 'coins', name: 'Coins', keep: 'round', start: -2, floor: 0 },
      ],
      stations: [
        {
          id: 'a',
          steps: [{ id: 'q', kind: 'quiz', outcomes: {} }],
        },
        { id: 'gate', requires: [{ counter: 'coins', atLeast: 0 }], steps: [] },
      ],
    };
    expect(checkTourGame(below)).toEqual([
      { kind: 'start-below-floor', counter: 'coins' },
    ]);
    const fractional: TourGame = {
      labels: [],
      counters: [
        { id: 'coins', name: 'Coins', keep: 'round', start: 0.5, floor: 0 },
      ],
      stations: [
        { id: 'gate', requires: [{ counter: 'coins', atLeast: 1 }], steps: [] },
      ],
    };
    expect(checkTourGame(fractional)).toEqual([
      { kind: 'bad-number', field: 'start', at: { counter: 'coins' } },
    ]);
  });

  // A quiz outcome is an option: one whose cost the tour can never pay is
  // never available - and since a quiz is answered only as a whole, the
  // quiz can then never be answered and may trap the visitor.
  it('reports a quiz outcome whose cost the tour can never pay', () => {
    const game: TourGame = {
      labels: [],
      counters: COINS,
      stations: [
        {
          id: 'a',
          steps: [
            {
              id: 'q',
              kind: 'quiz',
              outcomes: { wrong: [{ add: 'coins', by: -2 }] },
            },
          ],
        },
      ],
    };
    expect(checkTourGame(game)).toEqual([
      {
        kind: 'option-never-available',
        at: { station: 'a', step: 'q', outcome: 'wrong' },
        because: { kind: 'floor', counter: 'coins', max: 0 },
      },
      { kind: 'choice-may-softlock', at: { station: 'a', step: 'q' } },
    ]);
  });

  // A quiz neither of whose outcomes can be taken stops the scene there:
  // the steps after it are never reached, and the quiz may trap.
  it('stops the scene flow at a quiz no outcome of which can be taken', () => {
    const game: TourGame = {
      labels: [],
      counters: COINS,
      stations: [
        {
          id: 'a',
          steps: [
            {
              id: 'q',
              kind: 'quiz',
              outcomes: {
                correct: [{ add: 'coins', by: -1 }],
                wrong: [{ add: 'coins', by: -1 }],
              },
            },
            { id: 'after', kind: 'content' },
          ],
        },
      ],
    };
    const floor = { kind: 'floor', counter: 'coins', max: 0 } as const;
    expect(checkTourGame(game)).toEqual([
      {
        kind: 'option-never-available',
        at: { station: 'a', step: 'q', outcome: 'correct' },
        because: floor,
      },
      {
        kind: 'option-never-available',
        at: { station: 'a', step: 'q', outcome: 'wrong' },
        because: floor,
      },
      { kind: 'choice-may-softlock', at: { station: 'a', step: 'q' } },
      {
        kind: 'unreachable',
        at: { station: 'a', step: 'after' },
        because: { kind: 'scene-flow' },
      },
    ]);
  });

  it('counts both outcomes of a reachable quiz as sources', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [],
      stations: [
        {
          id: 'a',
          steps: [
            {
              id: 'q',
              kind: 'quiz',
              outcomes: { correct: [{ set: 'key' }], wrong: [{ set: 'path' }] },
            },
          ],
        },
        { id: 'b', requires: [{ has: 'key' }], steps: [] },
        { id: 'c', requires: [{ has: 'path' }], steps: [] },
      ],
    };
    expect(checkTourGame(game)).toEqual([]);
  });

  // Known limitation, by design: the check reasons about what COULD be
  // held at some time, not jointly. Two round labels that one choice gives
  // exclusively are never held together, yet the station needing both is
  // reported reachable. The check never reports reachable content as
  // unreachable (the property test); this is the other direction.
  it('does not see that one exclusive choice cannot give two round labels', () => {
    const game: TourGame = {
      labels: [
        { id: 'north', name: 'North', keep: 'round' },
        { id: 'south', name: 'South', keep: 'round' },
      ],
      counters: [],
      stations: [
        giver('a', [
          choiceStep('c', [
            { id: 'n', effects: [{ set: 'north' }] },
            { id: 's', effects: [{ set: 'south' }] },
          ]),
        ]),
        {
          id: 'both',
          requires: [{ has: 'north' }, { has: 'south' }],
          steps: [],
        },
      ],
    };
    expect(checkTourGame(game).filter((f) => f.kind === 'unreachable')).toEqual(
      []
    );
  });
});

describe('checkTourGame - softlocks', () => {
  it('warns about a reachable choice with no free option', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: COINS,
      stations: [
        giver('a', [
          choiceStep('c', [
            {
              id: 'k',
              effects: [
                { set: 'key' },
                { set: 'path' },
                { add: 'coins', by: 3 },
              ],
            },
            LEAVE,
          ]),
        ]),
        giver('m', [
          choiceStep('buy', [
            { id: 'x', effects: [{ add: 'coins', by: -1 }] },
            { id: 'y', requires: [{ has: 'key' }] },
          ]),
        ]),
      ],
    };
    expect(checkTourGame(game)).toEqual([
      { kind: 'choice-may-softlock', at: { station: 'm', step: 'buy' } },
    ]);
  });

  it('accepts an option that only gives or only sets as free', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: COINS,
      stations: [
        giver('a', [
          choiceStep('c', [
            { id: 'k', requires: [{ has: 'path' }], effects: [{ set: 'key' }] },
            { id: 'p', effects: [{ set: 'path' }, { add: 'coins', by: 1 }] },
          ]),
        ]),
      ],
    };
    expect(checkTourGame(game)).toEqual([]);
  });

  // One of "has L" and "lacks L" always holds, so the pair is never stuck.
  it('accepts a has/lacks pair of the same label as free together', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [],
      stations: [
        giver('a', [
          choiceStep('c', [
            {
              id: 'with',
              requires: [{ has: 'key' }],
              effects: [{ set: 'path' }],
            },
            {
              id: 'without',
              requires: [{ lacks: 'key' }],
              effects: [{ set: 'key' }],
            },
          ]),
        ]),
      ],
    };
    expect(checkTourGame(game)).toEqual([]);
  });

  // A condition on an undeclared label never holds, `lacks` included, so
  // the pair that is free for a declared label is stuck for a typo.
  it('does not accept a has/lacks pair of an undeclared label as free', () => {
    const game: TourGame = {
      labels: [],
      counters: [],
      stations: [
        giver('a', [
          choiceStep('c', [
            { id: 'with', requires: [{ has: 'zz' }] },
            { id: 'without', requires: [{ lacks: 'zz' }] },
          ]),
        ]),
      ],
    };
    expect(checkTourGame(game)).toContainEqual({
      kind: 'choice-may-softlock',
      at: { station: 'a', step: 'c' },
    });
  });

  // A quiz is answered only as a whole, so a free right answer does not
  // help while the wrong one cannot be paid: any cost on either outcome
  // may trap the visitor, and only a quiz that costs nothing cannot.
  it('warns about a reachable quiz when either outcome costs', () => {
    const quiz = (correct: number, wrong: number): TourGame => ({
      labels: [],
      counters: COINS,
      stations: [
        giver('farm', [
          choiceStep('c', [
            { id: 'k', effects: [{ add: 'coins', by: 3 }] },
            LEAVE,
          ]),
        ]),
        {
          id: 'a',
          steps: [
            {
              id: 'q',
              kind: 'quiz',
              outcomes: {
                correct: [{ add: 'coins', by: correct }],
                wrong: [{ add: 'coins', by: wrong }],
              },
            },
          ],
        },
      ],
    });
    const softlock = [
      { kind: 'choice-may-softlock', at: { station: 'a', step: 'q' } },
    ];
    expect(checkTourGame(quiz(1, -1))).toEqual(softlock);
    expect(checkTourGame(quiz(-1, -1))).toEqual(softlock);
    expect(checkTourGame(quiz(1, 2))).toEqual([]);
  });

  it('does not warn about a choice that is never reached', () => {
    const game: TourGame = {
      labels: LABELS,
      counters: [],
      stations: [
        giver('a', [
          choiceStep('c', [
            { id: 'k', effects: [{ set: 'key' }, { set: 'path' }] },
            LEAVE,
          ]),
        ]),
        {
          id: 'b',
          requires: [{ has: 'nope' }],
          steps: [
            choiceStep('stuck', [
              { id: 'x', requires: [{ has: 'key' }] },
              { id: 'y', requires: [{ has: 'key' }] },
            ]),
          ],
        },
      ],
    };
    expect(checkTourGame(game).map((f) => f.kind)).toEqual([
      'unknown-name',
      'unreachable',
    ]);
  });
});

describe('checkTourGame - a quiz is answered only as a whole', () => {
  /** A farm paying 3 coins, then a quiz with these outcomes. */
  const withQuiz = (
    outcomes: { correct?: number; wrong?: number },
    counters: TourGame['counters'] = COINS
  ): TourGame => ({
    labels: [],
    counters,
    stations: [
      giver('farm', [
        choiceStep('c', [
          { id: 'k', effects: [{ add: 'coins', by: 3 }] },
          LEAVE,
        ]),
      ]),
      {
        id: 'a',
        steps: [
          {
            id: 'q',
            kind: 'quiz',
            outcomes: {
              ...(outcomes.correct === undefined
                ? {}
                : { correct: [{ add: 'coins', by: outcomes.correct }] }),
              ...(outcomes.wrong === undefined
                ? {}
                : { wrong: [{ add: 'coins', by: outcomes.wrong }] }),
            },
          },
          { id: 'after', kind: 'content' },
        ],
      },
    ],
  });
  const softlock = [
    { kind: 'choice-may-softlock', at: { station: 'a', step: 'q' } },
  ];

  // Outcomes that cost differently cannot give the answer away: at 1
  // coin a wrong answer costing 2 greys the WHOLE quiz, right answers
  // included. What remains is that the visitor may be unable to answer,
  // which is the softlock warning - on a visible or a secret counter
  // alike, since the whole quiz is hidden then too.
  it('warns only that a quiz whose outcomes cost differently may trap', () => {
    const secret: TourGame['counters'] = [
      {
        id: 'coins',
        name: 'Coins',
        keep: 'round',
        start: 0,
        floor: 0,
        secret: true,
      },
    ];
    expect(checkTourGame(withQuiz({ wrong: -2 }))).toEqual(softlock);
    expect(checkTourGame(withQuiz({ correct: 1, wrong: -1 }))).toEqual(
      softlock
    );
    expect(checkTourGame(withQuiz({ wrong: -2 }, secret))).toEqual(softlock);
  });

  // Equal costs may trap the visitor like any other cost; a quiz
  // without costs, or with gains only, is silent.
  it('treats equal costs as a possible trap and a quiz without costs as clean', () => {
    expect(checkTourGame(withQuiz({ correct: -2, wrong: -2 }))).toEqual(
      softlock
    );
    expect(checkTourGame(withQuiz({}))).toEqual([]);
    expect(checkTourGame(withQuiz({ correct: 2, wrong: 1 }))).toEqual([]);
    expect(checkTourGame(withQuiz({ correct: 1 }))).toEqual([]);
  });

  // One outcome the tour can never pay closes the quiz for good: that
  // outcome is never available, the quiz may trap, and the scene never
  // gets past it - even though the right answer itself would be free.
  it('closes a quiz whose one outcome can never be paid and stops the scene there', () => {
    expect(checkTourGame(withQuiz({ wrong: -5 }))).toEqual([
      {
        kind: 'option-never-available',
        at: { station: 'a', step: 'q', outcome: 'wrong' },
        because: { kind: 'floor', counter: 'coins', max: 3 },
      },
      ...softlock,
      {
        kind: 'unreachable',
        at: { station: 'a', step: 'after' },
        because: { kind: 'scene-flow' },
      },
    ]);
  });
});
