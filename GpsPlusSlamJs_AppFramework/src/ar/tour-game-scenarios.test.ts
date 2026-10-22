/**
 * Why this test matters: the game rules exist for four kinds of tour, and
 * each is walked here end to end as a fixture - a path choice at the first
 * station that shows only that path's stations, a key behind a quiz, a
 * merchant selling a sword for two coins with a floor at zero, and a
 * collectible set that takes a second round, with scene steps gated by
 * labels. If a change to the rules breaks one of these, a real tour of
 * that kind breaks the same way. Each fixture is also a tour the creator
 * checks must find clean.
 */

import { describe, expect, it } from 'vitest';

import { checkTourGame } from './tour-game-check';
import {
  answerQuiz,
  availability,
  chooseOption,
  inventory,
  nextAvailableStep,
  startNextRound,
  startRun,
  type TourGame,
  type TourGameOption,
  type TourGameRunState,
  type TourGameStep,
} from './tour-game-rules';

function stationsAvailable(game: TourGame, state: TourGameRunState): string[] {
  return game.stations
    .filter((s) => availability(game, state, s).available)
    .map((s) => s.id);
}

function optionOf(
  game: TourGame,
  station: string,
  step: string,
  option: string
): TourGameOption {
  const found = game.stations
    .find((s) => s.id === station)
    ?.steps.find((s) => s.id === step);
  if (found?.kind !== 'choice') throw new Error(`no choice ${station}/${step}`);
  const picked = found.options.find((o) => o.id === option);
  if (picked === undefined) throw new Error(`no option ${option}`);
  return picked;
}

function pick(
  game: TourGame,
  state: TourGameRunState,
  station: string,
  step: string,
  option: string
): TourGameRunState {
  const result = chooseOption(
    game,
    state,
    optionOf(game, station, step, option)
  );
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.reason)}`);
  return result.state;
}

/** The ids of the steps a station's scene plays, in order, with no
 *  choice in between (a straight scene). */
function playedSteps(
  game: TourGame,
  state: TourGameRunState,
  steps: readonly TourGameStep[]
): string[] {
  const out: string[] = [];
  for (let i = nextAvailableStep(game, state, steps, 0); i >= 0;) {
    out.push(steps[i]!.id);
    i = nextAvailableStep(game, state, steps, i + 1);
  }
  return out;
}

describe('a path choice at the first station', () => {
  const game: TourGame = {
    labels: [
      { id: 'tournament', name: 'The tournament', keep: 'round' },
      { id: 'festival', name: "The knights' festival", keep: 'round' },
    ],
    counters: [],
    stations: [
      {
        id: 'gate',
        steps: [
          {
            id: 'ask',
            kind: 'choice',
            options: [
              { id: 't', effects: [{ set: 'tournament' }] },
              { id: 'f', effects: [{ set: 'festival' }] },
            ],
          },
        ],
      },
      { id: 'lists', requires: [{ has: 'tournament' }], steps: [] },
      { id: 'stands', requires: [{ has: 'tournament' }], steps: [] },
      { id: 'feast', requires: [{ has: 'festival' }], steps: [] },
      { id: 'keep', steps: [] },
    ],
  };

  it('shows only the first station and the shared end before the choice', () => {
    expect(stationsAvailable(game, startRun(game))).toEqual(['gate', 'keep']);
  });

  it("shows the chosen path's stations and never the other path's", () => {
    const t = pick(game, startRun(game), 'gate', 'ask', 't');
    expect(stationsAvailable(game, t)).toEqual([
      'gate',
      'lists',
      'stands',
      'keep',
    ]);
    const f = pick(game, startRun(game), 'gate', 'ask', 'f');
    expect(stationsAvailable(game, f)).toEqual(['gate', 'feast', 'keep']);
  });

  it('forgets the path in a new round', () => {
    const t = pick(game, startRun(game), 'gate', 'ask', 't');
    expect(stationsAvailable(game, startNextRound(game, t))).toEqual([
      'gate',
      'keep',
    ]);
  });

  it('is a clean tour for the checks', () => {
    expect(checkTourGame(game)).toEqual([]);
  });
});

describe('a key behind a quiz', () => {
  const quiz = { correct: [{ set: 'red-key' }] } as const;
  const game: TourGame = {
    labels: [{ id: 'red-key', name: 'Red key', keep: 'collectible' }],
    counters: [],
    stations: [
      { id: 'well', steps: [{ id: 'q', kind: 'quiz', outcomes: quiz }] },
      {
        id: 'tower',
        requires: [{ has: 'red-key' }],
        steps: [],
        items: [{ id: 'door-open', requires: [{ has: 'red-key' }] }],
      },
    ],
  };

  it('keeps the tower closed after a wrong answer, the key greyed', () => {
    const s = answerQuiz(game, startRun(game), quiz, false);
    expect(stationsAvailable(game, s)).toEqual(['well']);
    expect(inventory(game, s).labels[0]?.shown).toBe('greyed');
  });

  it('opens the tower and lights the key after a right answer', () => {
    const s = answerQuiz(game, startRun(game), quiz, true);
    expect(stationsAvailable(game, s)).toEqual(['well', 'tower']);
    expect(inventory(game, s).labels[0]?.shown).toBe('held');
    const tower = game.stations[1]!;
    expect(availability(game, s, tower.items![0]!).available).toBe(true);
  });

  it('is a clean tour for the checks', () => {
    expect(checkTourGame(game)).toEqual([]);
  });
});

describe('a merchant selling a sword for 2 coins', () => {
  const game: TourGame = {
    labels: [{ id: 'sword', name: 'Sword', keep: 'round' }],
    counters: [
      { id: 'coins', name: 'Coins', keep: 'round', start: 0, floor: 0 },
    ],
    stations: [
      {
        id: 'farm',
        steps: [
          {
            id: 'help',
            kind: 'choice',
            options: [
              { id: 'yes', effects: [{ add: 'coins', by: 2 }] },
              { id: 'no' },
            ],
          },
        ],
      },
      {
        id: 'market',
        steps: [
          { id: 'hello', kind: 'content' },
          {
            id: 'offer',
            kind: 'choice',
            options: [
              {
                id: 'buy',
                requires: [{ lacks: 'sword' }],
                effects: [{ set: 'sword' }, { add: 'coins', by: -2 }],
              },
              { id: 'leave' },
            ],
          },
          { id: 'admire', kind: 'content', requires: [{ has: 'sword' }] },
        ],
      },
    ],
  };
  const buy = optionOf(game, 'market', 'offer', 'buy');

  it('makes "buy" unavailable at 0 coins, saying 2 are missing', () => {
    expect(availability(game, startRun(game), buy)).toEqual({
      available: false,
      reason: { kind: 'floor', counter: 'coins', need: 2 },
    });
  });

  it('sells the sword at 2 coins, leaving 0', () => {
    const rich = pick(game, startRun(game), 'farm', 'help', 'yes');
    const after = pick(game, rich, 'market', 'offer', 'buy');
    expect(after.labels).toEqual(['sword']);
    expect(after.counters).toEqual({ coins: 0 });
  });

  it('never sells a second sword, and the gated dialogue plays after', () => {
    const rich = pick(game, startRun(game), 'farm', 'help', 'yes');
    const after = pick(game, rich, 'market', 'offer', 'buy');
    expect(availability(game, after, buy)).toEqual({
      available: false,
      reason: { kind: 'requires', condition: { lacks: 'sword' } },
    });
    const steps = game.stations[1]!.steps;
    expect(playedSteps(game, rich, steps)).toEqual(['hello', 'offer']);
    expect(playedSteps(game, after, steps)).toEqual([
      'hello',
      'offer',
      'admire',
    ]);
  });

  it('is a clean tour for the checks ("leave" keeps the choice open)', () => {
    expect(checkTourGame(game)).toEqual([]);
  });
});

describe('a collectible set with a second round', () => {
  const take = (label: string): TourGameStep => ({
    id: 'take',
    kind: 'choice',
    options: [{ id: 'take', effects: [{ set: label }] }, { id: 'leave' }],
  });
  const game: TourGame = {
    labels: [
      { id: 'red-key', name: 'Red key', keep: 'collectible' },
      { id: 'green-key', name: 'Green key', keep: 'collectible' },
      { id: 'crown', name: 'Crown', keep: 'collectible', secret: true },
      { id: 'north', name: 'North', keep: 'round' },
      { id: 'south', name: 'South', keep: 'round' },
    ],
    counters: [],
    stations: [
      {
        id: 'gate',
        steps: [
          {
            id: 'welcome-back',
            kind: 'content',
            requires: [{ has: 'red-key' }],
          },
          {
            id: 'pick',
            kind: 'choice',
            options: [
              { id: 'n', effects: [{ set: 'north' }] },
              { id: 's', effects: [{ set: 'south' }] },
            ],
          },
        ],
      },
      {
        id: 'north-tower',
        requires: [{ has: 'north' }],
        steps: [take('red-key')],
      },
      {
        id: 'south-tower',
        requires: [{ has: 'south' }],
        steps: [take('green-key')],
      },
      {
        id: 'treasury',
        requires: [{ has: 'red-key' }, { has: 'green-key' }],
        steps: [take('crown')],
      },
    ],
  };

  function roundOne(): TourGameRunState {
    const north = pick(game, startRun(game), 'gate', 'pick', 'n');
    return pick(game, north, 'north-tower', 'take', 'take');
  }

  it('holds one key after round 1; the treasury stays shut', () => {
    const s = roundOne();
    expect(s.labels).toEqual(['north', 'red-key']);
    expect(stationsAvailable(game, s)).not.toContain('treasury');
  });

  it('keeps the key and forgets the path in round 2, and welcomes back', () => {
    const second = startNextRound(game, roundOne());
    expect(second).toMatchObject({ round: 2, labels: ['red-key'] });
    const gate = game.stations[0]!.steps;
    expect(playedSteps(game, startRun(game), gate)).toEqual(['pick']);
    expect(nextAvailableStep(game, second, gate, 0)).toBe(0);
  });

  it('opens the treasury with the second key and reveals the secret crown', () => {
    const second = startNextRound(game, roundOne());
    const south = pick(game, second, 'gate', 'pick', 's');
    const keys = pick(game, south, 'south-tower', 'take', 'take');
    expect(stationsAvailable(game, keys)).toContain('treasury');
    const crown = (s: TourGameRunState) =>
      inventory(game, s).labels.find((l) => l.id === 'crown')?.shown;
    expect(crown(keys)).toBe('hidden');
    expect(crown(pick(game, keys, 'treasury', 'take', 'take'))).toBe('held');
  });

  it('is a clean tour for the checks (the treasury is reachable over rounds)', () => {
    expect(checkTourGame(game)).toEqual([]);
  });
});
