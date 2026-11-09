/**
 * Why this test matters: a station's children are written by one app and
 * read by another, often of a different minor. Four promises make that safe
 * for every station the shared generators can build (texts at every cap
 * with combining marks, surrogate pairs and whitespace runs; colliding and
 * 64-character ids; free and story blocks of every kind and view; choices,
 * quizzes), not only for the hand-written examples:
 *
 * 1. the reader keeps exactly what a valid file says, and the writer's
 *    output reads back to the same content (an exact round trip);
 * 2. a file of a newer minor never fails to open, and what survives still
 *    resolves - every free block stands in a view its kind may stand in free, every choice keeps
 *    two ways on - while the same file at this reader's own minor is
 *    refused;
 * 3. a text over its cap fails the file when the block needs it and is left
 *    out, reported, when it is optional;
 * 4. the generators themselves stay inside the format (property 1 reading
 *    every generated record is that check), at several sizes.
 *
 * Beside those: every block is listed once in document order, every child
 * is found where it is, and an id two children share - in a station or
 * across two - is refused at every minor.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  TOUR_ARBITRARY_ASSETS,
  tourIdArbitrary,
  tourStationChildrenArbitrary,
  tourTextArbitrary,
} from '../test-utils/tour-arbitraries';
import {
  TOUR_BLOCK_TEXT_RULES,
  TOUR_FREE_BLOCK_VIEWS,
  tourTextCount,
  type TourBlockKind,
  type TourTextRule,
} from './tour-blocks';
import { parseTourAssets } from './tour-assets';
import { tourFreeBlocks } from './tour-station-pose';
import {
  checkTourChildIdsUnique,
  isStory,
  parseTourStationChildren,
  TOUR_STORY_TITLE_RULE,
  tourChildrenBlocks,
  tourChildrenPlace,
  tourChildrenStories,
  type TourChildDrop,
  type TourStationChild,
} from './tour-story';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

const ASSETS = parseTourAssets(
  TOUR_ARBITRARY_ASSETS.map((a) => ({ ...a })),
  { fail }
);

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

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

/** A generated list with one of its capped texts - a required or an
 *  optional one, by `needed` - replaced by a text over its cap. */
const overCapCase = (needed: boolean) =>
  fc
    .tuple(tourStationChildrenArbitrary(), fc.nat())
    .map(([record, pick]) => {
      const targets = allChildren(record)
        .filter(isBlockRecord)
        .flatMap((b, i) =>
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
        const block = allChildren(odd).filter(isBlockRecord)[index]!;
        block[field] = over;
        return { odd, id: block['id'] as string, field };
      });
    });

describe('caps (properties)', () => {
  it('a required text over its cap fails the file', () => {
    fc.assert(
      fc.property(overCapCase(true), ({ odd }) => {
        expect(() => children(odd)).toThrow(Invalid);
      }),
      { numRuns: 150 }
    );
  });

  it('an optional text over its cap is left out of its block, and reported', () => {
    fc.assert(
      fc.property(overCapCase(false), ({ odd, id, field }) => {
        const drops: TourChildDrop[] = [];
        const read = children(odd, { drops });
        const block = tourChildrenBlocks(read).find((b) => b.id === id) as
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

type Child = Record<string, unknown>;

type ChildrenOptions = { lenient?: boolean; drops?: TourChildDrop[] };

function childrenRead(list: unknown, options: ChildrenOptions = {}) {
  return parseTourStationChildren(list, 'children', {
    assets: ASSETS,
    fail,
    lenient: options.lenient === true,
    onDropped: (d) => options.drops?.push(d),
  });
}

function children(
  list: unknown,
  options: ChildrenOptions = {}
): TourStationChild[] {
  return childrenRead(list, options).children;
}

/** Every child of a children list, the children of its folders (stories
 *  among them) included, in document order. */
function allChildren(list: readonly Child[]): Child[] {
  return list.flatMap((c) =>
    c['kind'] === 'folder' ? [c, ...allChildren(c['children'] as Child[])] : [c]
  );
}

const isBlockRecord = (c: Child): boolean =>
  !['folder', 'choice', 'quiz'].includes(c['kind'] as string);

const CHILDREN_SIZES = [
  { maxStories: 1, maxFreeBlocks: 1, maxStoryChildren: 2 },
  { maxStories: 4, maxFreeBlocks: 4, maxStoryChildren: 5 },
  { maxStories: 8, maxFreeBlocks: 8, maxStoryChildren: 12 },
];

const SMALL = { maxStories: 2, maxFreeBlocks: 2, maxStoryChildren: 2 };

describe('children (properties)', () => {
  // Swept: small stations, the default, and crowded ones.
  for (const size of CHILDREN_SIZES) {
    it(`the reader keeps a valid list exactly, and what it read reads back the same through JSON (up to ${String(size.maxStories)} stories)`, () => {
      fc.assert(
        fc.property(tourStationChildrenArbitrary(size), (record) => {
          const parsed = children(record);
          // Nothing added, nothing rewritten, the order as written (free
          // blocks before, between or after the stories).
          expect(parsed).toEqual(record);
          expect(children(copy(parsed))).toEqual(parsed);
        }),
        { numRuns: size.maxStories > 4 ? 40 : 120 }
      );
    });
  }

  it('lists every block once, in document order, and finds every child where it is', () => {
    fc.assert(
      fc.property(
        tourStationChildrenArbitrary(),
        tourIdArbitrary,
        (record, other) => {
          const parsed = children(record);
          const all = allChildren(record);
          expect(tourChildrenBlocks(parsed).map((b) => b.id)).toEqual(
            all.filter(isBlockRecord).map((c) => c['id'])
          );
          // Stories and free blocks split the list, each in its order.
          expect(tourChildrenStories(parsed)).toEqual(parsed.filter(isStory));
          expect(tourFreeBlocks({ children: parsed })).toEqual(
            parsed.filter((c) => !isStory(c))
          );
          const ids = all.map((c) => c['id'] as string);
          const places = ids.map((id) => tourChildrenPlace(parsed, id));
          // Each place holds the child with that id, its story (if any)
          // being one of the list's own.
          expect(
            places.map((p) =>
              p === null
                ? null
                : (p.story === undefined
                    ? parsed[p.index]
                    : p.story.children[p.index]
                  )?.id
            )
          ).toEqual(ids);
          expect(
            places.filter(
              (p) => p?.story !== undefined && !parsed.includes(p.story)
            )
          ).toEqual([]);
          // An id no child has has no place.
          expect(tourChildrenPlace(parsed, other) === null).toBe(
            !ids.includes(other)
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it('refuses a list in which two children share an id, strict and lenient', () => {
    fc.assert(
      fc.property(
        tourStationChildrenArbitrary(),
        fc.nat(),
        fc.nat(),
        (record, a, b) => {
          const odd = copy(record);
          const all = allChildren(odd);
          fc.pre(all.length >= 2);
          const i = a % all.length;
          const j = (i + 1 + (b % (all.length - 1))) % all.length;
          all[j]!['id'] = all[i]!['id'];
          expect(() => children(odd)).toThrow(Invalid);
          expect(() => children(odd, { lenient: true })).toThrow(Invalid);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('ids are unique across stations: the check throws exactly when two lists share one', () => {
    let shared = 0;
    let apart = 0;
    fc.assert(
      fc.property(
        tourStationChildrenArbitrary(SMALL),
        tourStationChildrenArbitrary(SMALL),
        (first, second) => {
          const a = childrenRead(first);
          const b = childrenRead(second);
          const ids = new Set(allChildren(first).map((c) => c['id']));
          const meet = allChildren(second).some((c) => ids.has(c['id']));
          if (meet) shared++;
          else apart++;
          let outcome = 'passed';
          try {
            checkTourChildIdsUnique([a, b], fail);
          } catch (err) {
            outcome = err instanceof Invalid ? 'refused' : String(err);
          }
          expect(outcome).toBe(meet ? 'refused' : 'passed');
        }
      ),
      { numRuns: 300 }
    );
    // Both sides of the rule were actually exercised.
    expect(shared).toBeGreaterThan(0);
    expect(apart).toBeGreaterThan(0);
  });
});

/** Every place a newer minor could put a value this reader does not know,
 *  in a copy of a children list; one of them (by `pick`) is applied. */
function injectNewerChildren(list: Child[], pick: number): void {
  const sites: (() => void)[] = [];
  const block = (b: Child, inStory: boolean) => {
    sites.push(() => {
      b['view'] = 'hologram';
    });
    sites.push(() => {
      b['kind'] = 'primitives';
    });
    if ('image' in b) {
      sites.push(() => {
        b['image'] = 'splat';
      });
    }
    if (b['kind'] === 'shortText') {
      sites.push(() => {
        b['caption'] = 'w'.repeat(41);
      });
    }
    if (inStory) {
      sites.push(() => {
        b['advance'] = { mode: 'gaze' };
      });
    }
  };
  for (const child of list) {
    if (child['role'] !== 'story') {
      block(child, false);
      continue;
    }
    sites.push(() => {
      child['title'] = 't'.repeat(TOUR_STORY_TITLE_RULE.max + 1);
    });
    sites.push(() => {
      child['kind'] = 'scene';
    });
    for (const kid of child['children'] as Child[]) {
      sites.push(() => {
        kid['kind'] = 'dance';
      });
      if (kid['kind'] === 'quiz') {
        sites.push(() => {
          (kid['answer'] as Child)['type'] = 'map-pick';
        });
      } else if (kid['kind'] !== 'choice') {
        block(kid, true);
      }
    }
  }
  if (sites.length > 0) sites[pick % sites.length]!();
}

describe('a list of a newer minor (properties)', () => {
  it('lenient: never fails, and what remains still resolves; strict: the same list is refused', () => {
    fc.assert(
      fc.property(
        tourStationChildrenArbitrary(),
        fc.array(fc.nat(), { minLength: 1, maxLength: 3 }),
        (record, picks) => {
          const odd = copy(record);
          for (const pick of picks) injectNewerChildren(odd, pick);
          fc.pre(JSON.stringify(odd) !== JSON.stringify(record));
          const drops: TourChildDrop[] = [];
          const read = children(odd, { lenient: true, drops });
          const stories = tourChildrenStories(read);
          // Every choice keeps two ways on, each to a child still in its
          // story; every story block moves on in a known way.
          const faults = stories.flatMap((story) => {
            const ids = new Set(story.children.map((c) => c.id));
            return story.children.flatMap((c) => {
              if (c.kind === 'quiz') return [];
              if (c.kind !== 'choice') {
                return ['tap', 'auto', 'lineEnd'].includes(c.advance.mode)
                  ? []
                  : [`${c.id}: advance ${c.advance.mode}`];
              }
              const dangling = c.options.filter(
                (o) => o.goto !== undefined && !ids.has(o.goto)
              );
              return [
                ...(c.options.length < 2 ? [`${c.id}: one way on`] : []),
                ...dangling.map((o) => `${c.id}: goto ${String(o.goto)}`),
              ];
            });
          });
          expect(faults).toEqual([]);
          expect(
            stories.filter(
              (s) => tourTextCount(s.title) > TOUR_STORY_TITLE_RULE.max
            )
          ).toEqual([]);
          expect(
            tourFreeBlocks({ children: read }).filter(
              (b) =>
                !(TOUR_FREE_BLOCK_VIEWS[b.kind] as readonly string[]).includes(
                  b.view
                )
            )
          ).toEqual([]);
          // Every child it left out was reported, by id, and every way on
          // a kept choice lost, by choice and option.
          const reported = new Set(
            drops.flatMap((d) =>
              d.kind === 'child'
                ? [d.child]
                : d.kind === 'block'
                  ? [d.block]
                  : d.kind === 'option'
                    ? [`${d.child}/${d.option}`]
                    : []
            )
          );
          const keptTop = new Set(read.map((c) => c.id));
          const lost = odd
            .map((c) => c['id'] as string)
            .filter((id) => !keptTop.has(id));
          for (const story of stories) {
            const kept = new Set(story.children.map((c) => c.id));
            const source = odd.find((c) => c['id'] === story.id)!;
            for (const kid of source['children'] as Child[]) {
              if (!kept.has(kid['id'] as string)) {
                lost.push(kid['id'] as string);
              }
            }
            for (const c of story.children) {
              if (c.kind !== 'choice') continue;
              const options = new Set(c.options.map((o) => o.id));
              const written = (source['children'] as Child[]).find(
                (k) => k['id'] === c.id
              )!['options'] as { id: string }[];
              for (const o of written) {
                if (!options.has(o.id)) lost.push(`${c.id}/${o.id}`);
              }
            }
          }
          expect(lost.filter((id) => !reported.has(id))).toEqual([]);
          expect(() => children(odd)).toThrow(Invalid);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('a choice left with fewer than two reachable options goes, repeatedly', () => {
    // Why: leaving a choice out can strand a choice that jumped to it; no
    // scene may offer one way on.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (depth) => {
        // c0 -> c1 -> ... -> c(depth-1) -> gone (a skipped block).
        const kids: Child[] = [];
        for (let i = 0; i < depth; i++) {
          const goto = i + 1 < depth ? `c${String(i + 1)}` : 'gone';
          kids.push({
            id: `c${String(i)}`,
            kind: 'choice',
            prompt: '?',
            options: [
              { id: 'a', label: 'A', goto },
              { id: 'b', label: 'B', goto },
            ],
          });
        }
        kids.push({
          id: 'gone',
          kind: 'primitives',
          view: 'card',
          pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        });
        const read = children(
          [
            {
              id: 'story',
              kind: 'folder',
              role: 'story',
              title: 'T',
              children: kids,
            },
          ],
          { lenient: true }
        );
        expect(tourChildrenStories(read)[0]?.children).toEqual([]);
      })
    );
  });
});
