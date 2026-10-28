/**
 * Why this test matters: a station's blocks and story are written by one
 * app and read by another, often of a different minor. Four promises make
 * that safe for every station the shared generators can build (texts at
 * every cap with combining marks, surrogate pairs and whitespace runs;
 * colliding and 64-character ids; free and story blocks of every kind and
 * view; shows, choices, quizzes), not only for the hand-written examples:
 *
 * 1. the reader keeps exactly what a valid file says, and the writer's
 *    output reads back to the same content (an exact round trip);
 * 2. a file of a newer minor never fails to open, and what survives still
 *    resolves - no `show` names a skipped block, every free block stands in
 *    a world view, every choice keeps two ways on - while the same file at
 *    this reader's own minor is refused;
 * 3. a text over its cap fails the file when the block needs it and is left
 *    out, reported, when it is optional;
 * 4. the generators themselves stay inside the format (property 1 reading
 *    every generated record is that check), at several sizes.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  TOUR_ARBITRARY_ASSETS,
  tourStationContentArbitrary,
  tourTextArbitrary,
} from '../test-utils/tour-arbitraries';
import {
  TOUR_BLOCK_TEXT_RULES,
  type TourBlockDrop,
  type TourBlockKind,
  type TourTextRule,
} from './tour-blocks';
import { parseTourAssets } from './tour-assets';
import { parseTourStationContent, type TourStationContent } from './tour-story';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

const ASSETS = parseTourAssets(
  TOUR_ARBITRARY_ASSETS.map((a) => ({ ...a })),
  { fail }
);

type Content = {
  blocks: Record<string, unknown>[];
  steps: Record<string, unknown>[];
};

function parse(
  content: unknown,
  options: { lenient?: boolean; drops?: TourBlockDrop[] } = {}
): TourStationContent {
  return parseTourStationContent(content, 'station', {
    assets: ASSETS,
    fail,
    lenient: options.lenient === true,
    onDropped: (d) => options.drops?.push(d),
  });
}

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('station content (properties)', () => {
  // Swept: small stations, the default, and crowded ones.
  for (const size of [
    { maxBlocks: 2, maxExtraSteps: 1 },
    { maxBlocks: 6, maxExtraSteps: 3 },
    { maxBlocks: 16, maxExtraSteps: 8 },
  ]) {
    it(`the reader keeps a valid file exactly, and what it read reads back the same through JSON (up to ${String(size.maxBlocks)} blocks)`, () => {
      fc.assert(
        fc.property(tourStationContentArbitrary(size), (record) => {
          const parsed = parse(record);
          // Nothing added, nothing rewritten: texts as written, every
          // optional value that was there, no default invented.
          expect(parsed).toEqual(record);
          // The manifest's writer writes the in-memory station as it is.
          expect(parse(copy(parsed))).toEqual(parsed);
        }),
        { numRuns: size.maxBlocks > 6 ? 40 : 120 }
      );
    });
  }
});

/** Every place a newer minor could put a value this reader does not know,
 *  in a copy of `content`; one of them (by `pick`) is applied. */
function injectNewerMinor(content: Content, pick: number): void {
  const sites: (() => void)[] = [];
  for (const block of content.blocks) {
    sites.push(() => {
      block['view'] = 'hologram';
    });
    sites.push(() => {
      block['kind'] = 'primitives';
    });
    if ('image' in block) {
      sites.push(() => {
        block['image'] = 'splat';
      });
    }
    if ('caption' in block && block['kind'] === 'shortText') {
      sites.push(() => {
        block['caption'] = 'w'.repeat(41);
      });
    }
  }
  for (const step of content.steps) {
    const action = step['action'] as Record<string, unknown>;
    sites.push(() => {
      action['kind'] = 'dance';
    });
    if (action['kind'] === 'quiz') {
      sites.push(() => {
        (action['answer'] as Record<string, unknown>)['type'] = 'map-pick';
      });
    }
    sites.push(() => {
      step['advance'] = { mode: 'gaze' };
    });
  }
  if (sites.length > 0) sites[pick % sites.length]!();
}

describe('a file of a newer minor (properties)', () => {
  it('lenient: never fails, and every remaining reference resolves; strict: the same file is refused', () => {
    fc.assert(
      fc.property(
        tourStationContentArbitrary(),
        fc.array(fc.nat(), { minLength: 1, maxLength: 3 }),
        (record, picks) => {
          const odd = copy(record);
          for (const pick of picks) injectNewerMinor(odd, pick);
          fc.pre(JSON.stringify(odd) !== JSON.stringify(record));
          const drops: TourBlockDrop[] = [];
          const content = parse(odd, { lenient: true, drops });
          const blockIds = new Set(content.blocks.map((b) => b.id));
          const stepIds = new Set(content.steps.map((s) => s.id));
          const shows = content.steps.flatMap((s) =>
            s.action.kind === 'show' ? [s.action.block] : []
          );
          // Never a show naming a block the reader left out.
          expect(shows.filter((b) => !blockIds.has(b))).toEqual([]);
          const choices = content.steps.flatMap((s) =>
            s.action.kind === 'choice' ? [s.action] : []
          );
          expect(choices.filter((c) => c.options.length < 2)).toEqual([]);
          expect(
            choices
              .flatMap((c) => c.options)
              .filter((o) => o.goto !== undefined && !stepIds.has(o.goto))
          ).toEqual([]);
          expect(
            content.steps.filter(
              (s) => !['tap', 'auto'].includes(s.advance.mode)
            )
          ).toEqual([]);
          const shown = new Set(shows);
          expect(
            content.blocks.filter(
              (b) =>
                !shown.has(b.id) && !['pin', 'plane', 'placed'].includes(b.view)
            )
          ).toEqual([]);
          // Every block it left out was reported, by id.
          const kept = new Set(content.blocks.map((b) => b.id));
          const lost = odd.blocks
            .map((b) => b['id'] as string)
            .filter((id) => !kept.has(id));
          expect(
            new Set(drops.filter((d) => d.kind === 'block').map((d) => d.block))
          ).toEqual(new Set(lost));
          expect(() => parse(odd)).toThrow(Invalid);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('a choice left with fewer than two reachable options goes, repeatedly', () => {
    // Why (as version 3, `tour-stations.ts`): skipping a choice can strand
    // a choice that jumped to it; no scene may offer one way on.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (depth) => {
        // c0 -> c1 -> ... -> c(depth-1) -> s (a show of a skipped block).
        const steps: Record<string, unknown>[] = [];
        for (let i = 0; i < depth; i++) {
          steps.push({
            id: `c${String(i)}`,
            action: {
              kind: 'choice',
              prompt: '?',
              options: [
                {
                  id: 'a',
                  label: 'A',
                  goto: i + 1 < depth ? `c${String(i + 1)}` : 's',
                },
                {
                  id: 'b',
                  label: 'B',
                  goto: i + 1 < depth ? `c${String(i + 1)}` : 's',
                },
              ],
            },
          });
        }
        steps.push({ id: 's', action: { kind: 'show', block: 'gone' } });
        const content = parse(
          {
            blocks: [
              {
                id: 'gone',
                kind: 'primitives',
                view: 'card',
                pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              },
            ],
            steps,
          },
          { lenient: true }
        );
        expect(content.steps).toEqual([]);
      })
    );
  });
});

const CAPPED: readonly [TourBlockKind, string, boolean][] = Object.entries(
  TOUR_BLOCK_TEXT_RULES
).flatMap(([kind, fields]) =>
  Object.entries(fields).map(
    ([field, rule]) =>
      [kind as TourBlockKind, field, rule.required] as [
        TourBlockKind,
        string,
        boolean,
      ]
  )
);

/** A generated station with one of its capped texts - a required or an
 *  optional one, by `needed` - replaced by a text over its cap. */
const overCapCase = (needed: boolean) =>
  fc
    .tuple(tourStationContentArbitrary(), fc.nat())
    .map(([record, pick]) => {
      const targets = record.blocks.flatMap((b, i) =>
        CAPPED.filter(
          ([kind, , req]) => kind === b['kind'] && req === needed
        ).map(([kind, field]) => ({ index: i, kind, field }))
      );
      return { record, target: targets[pick % Math.max(1, targets.length)] };
    })
    .filter(({ target }) => target !== undefined)
    .chain(({ record, target }) => {
      const { index, kind, field } = target!;
      const rules = TOUR_BLOCK_TEXT_RULES[kind] as Record<string, TourTextRule>;
      return tourTextArbitrary(rules[field]!, { over: true }).map((over) => {
        const odd = copy(record);
        odd.blocks[index]![field] = over;
        return { odd, id: odd.blocks[index]!['id'] as string, field };
      });
    });

describe('caps (properties)', () => {
  it('a required text over its cap fails the file', () => {
    fc.assert(
      fc.property(overCapCase(true), ({ odd }) => {
        expect(() => parse(odd)).toThrow(Invalid);
      }),
      { numRuns: 150 }
    );
  });

  it('an optional text over its cap is left out of its block, and reported', () => {
    fc.assert(
      fc.property(overCapCase(false), ({ odd, id, field }) => {
        const drops: TourBlockDrop[] = [];
        const content = parse(odd, { drops });
        const block = content.blocks.find((b) => b.id === id) as
          Record<string, unknown> | undefined;
        expect(block).toBeDefined();
        expect(field in block!).toBe(false);
        expect(drops).toEqual([
          expect.objectContaining({ kind: 'field', block: id, field }),
        ]);
      }),
      { numRuns: 150 }
    );
  });
});
