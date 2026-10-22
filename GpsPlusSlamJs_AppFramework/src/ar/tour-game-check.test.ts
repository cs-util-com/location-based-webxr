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
