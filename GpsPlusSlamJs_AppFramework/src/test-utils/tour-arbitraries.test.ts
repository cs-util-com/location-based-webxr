/**
 * Why this test matters: every property about blocks, stories and caps is
 * only as hostile as these generators. A text generator that never reaches
 * its cap, or whose "over" texts are not over, or that never writes a
 * combining mark or a surrogate pair, would let a counting bug through
 * every property that uses it while they all stay green. This pins what
 * the generators claim: exact counts in the reader's own unit, the
 * boundaries actually reached, the hostile spellings actually produced,
 * ids at their limit and colliding across namespaces, and version 5 children
 * lists that reach every shape the reader must keep (no story and four, an
 * empty story, a free block after a story, gotos back and forward, every
 * child kind). (Manifests the reader accepts:
 * ar/tour-manifest.property.test.ts.)
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  checkTourBlockText,
  TOUR_BLOCK_TEXT_RULES,
  tourTextCount,
  type TourTextRule,
} from '../ar/tour-blocks';
import { parseTourStationChildren } from '../ar/tour-story';
import { parseTourAssets } from '../ar/tour-assets';
import {
  TOUR_AUDIO_MAX_REACH_M,
  TOUR_AUDIO_MIN_REACH_M,
} from '../ar/tour-kinds';
import {
  TOUR_ARBITRARY_ASSETS,
  tourBlockArbitrary,
  tourIdArbitrary,
  tourStationChildrenArbitrary,
  tourTextArbitrary,
} from './tour-arbitraries';

const RULES: [string, TourTextRule][] = Object.entries(
  TOUR_BLOCK_TEXT_RULES
).flatMap(([kind, fields]) =>
  Object.entries(fields).map(
    ([field, rule]) => [`${kind}.${field}`, rule] as [string, TourTextRule]
  )
);

const SAMPLES = 400;

// These samples are fixed by seed, so only the clock can fail them: 400 texts
// of up to 32 000 characters take 4-7 s alone (children lists 4 s), and 10 to
// 15 times that with the machine's gates running, past the 30 s deadlock
// guard of the config. The fast-check limit does not cover `fc.sample`, so
// this is the only guard these tests have.
const SLOW_SAMPLES_TIMEOUT_MS = 120_000;

describe('tourTextArbitrary', () => {
  for (const [name, rule] of RULES) {
    it(
      `${name}: counts 1 to ${String(rule.max)}, reaching 1, the cap and one under it`,
      () => {
        const counts = fc
          .sample(tourTextArbitrary(rule), { numRuns: SAMPLES, seed: 7 })
          .map((text) => {
            expect(checkTourBlockText(rule, text)).toMatchObject({ ok: true });
            return tourTextCount(text, rule.unit);
          });
        expect(Math.min(...counts)).toBe(1);
        expect(Math.max(...counts)).toBe(rule.max);
        expect(counts).toContain(rule.max - 1);
      },
      SLOW_SAMPLES_TIMEOUT_MS
    );

    it(
      `${name}: an "over" text is one to three over the cap and fails the check`,
      () => {
        const counts = fc
          .sample(tourTextArbitrary(rule, { over: true }), {
            numRuns: 60,
            seed: 7,
          })
          .map((text) => {
            expect(checkTourBlockText(rule, text).ok).toBe(false);
            return tourTextCount(text, rule.unit);
          });
        expect(Math.min(...counts)).toBe(rule.max + 1);
        expect(Math.max(...counts)).toBeLessThanOrEqual(rule.max + 3);
      },
      SLOW_SAMPLES_TIMEOUT_MS
    );
  }

  it('writes combining marks, surrogate pairs, whitespace runs and padding', () => {
    // The spellings where a count by UTF-16 length, by grapheme, or of the
    // raw string would differ from the reader's count.
    const texts = fc.sample(
      tourTextArbitrary(TOUR_BLOCK_TEXT_RULES.shortText.caption),
      { numRuns: SAMPLES, seed: 11 }
    );
    expect(texts.some((t) => t.includes('́'))).toBe(true);
    // (No `u` flag: with it a pair is one code point and never matches.)
    expect(texts.some((t) => /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(t))).toBe(
      true
    );
    expect(texts.some((t) => /\S\s{2,}\S/u.test(t))).toBe(true);
    expect(texts.some((t) => t !== t.trim())).toBe(true);
    // Never blank: a required text must stay valid.
    expect(texts.every((t) => t.trim() !== '')).toBe(true);
  });

  it('a UTF-16 text counts its surrogate pairs as two', () => {
    const rule = TOUR_BLOCK_TEXT_RULES.longText.body;
    const texts = fc.sample(tourTextArbitrary(rule), {
      numRuns: 100,
      seed: 3,
    });
    const withPair = texts.find((t) => /[\uD800-\uDBFF]/.test(t));
    expect(withPair).toBeDefined();
    expect(tourTextCount(withPair!, 'utf16')).toBe(withPair!.length);
    expect(tourTextCount(withPair!, 'utf16')).toBeGreaterThan(
      [...withPair!].length
    );
  });
});

describe('tourIdArbitrary', () => {
  it('reaches the 64-character limit and collides with asset ids', () => {
    const ids = fc.sample(tourIdArbitrary, { numRuns: SAMPLES, seed: 5 });
    expect(ids.some((id) => id.length === 64)).toBe(true);
    const assetIds = new Set<string>(TOUR_ARBITRARY_ASSETS.map((a) => a.id));
    expect(ids.some((id) => assetIds.has(id))).toBe(true);
    expect(ids.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))).toBe(true);
  });
});

// What the manifest generator reaches (every block kind, step kind, free
// blocks and world view) is collected by the one manifest property in
// ar/tour-manifest.property.test.ts, over the same manifests it checks.

describe('tourStationChildrenArbitrary', () => {
  // Why this test matters: the version 5 properties are only as wide as
  // this generator. One that always put free blocks first, never wrote an
  // empty story or never jumped backward would let an order or goto bug
  // through every property while they all stay green.
  it(
    'builds children lists the reader accepts, reaching every shape it must keep',
    () => {
      const assets = parseTourAssets(
        TOUR_ARBITRARY_ASSETS.map((a) => ({ ...a })),
        {
          fail: (m: string): never => {
            throw new Error(m);
          },
        }
      );
      const seen = new Set<string>();
      fc.assert(
        fc.property(tourStationChildrenArbitrary(), (children) => {
          parseTourStationChildren(JSON.parse(JSON.stringify(children)), 'c', {
            assets,
            fail: (m: string): never => {
              throw new Error(m);
            },
          });
          const stories = children.filter((c) => c['kind'] === 'story');
          seen.add(`stories:${String(stories.length)}`);
          const firstStory = children.findIndex((c) => c['kind'] === 'story');
          if (
            firstStory >= 0 &&
            children.length > firstStory + stories.length
          ) {
            // A free block somewhere after the first story.
            if (children.slice(firstStory).some((c) => c['kind'] !== 'story')) {
              seen.add('free after story');
            }
          }
          for (const story of stories) {
            const kids = story['children'] as Record<string, unknown>[];
            if (kids.length === 0) seen.add('empty story');
            kids.forEach((kid, i) => {
              const kind = kid['kind'] as string;
              seen.add(kind === 'choice' || kind === 'quiz' ? kind : 'block');
              if (kind !== 'choice') return;
              for (const o of kid['options'] as { goto?: string }[]) {
                if (o.goto === undefined) continue;
                const j = kids.findIndex((k) => k['id'] === o.goto);
                seen.add(
                  j < i ? 'goto back' : j > i ? 'goto forward' : 'goto self'
                );
              }
            });
          }
        }),
        { numRuns: 300, seed: 9 }
      );
      for (const shape of [
        'stories:0',
        'stories:4',
        'empty story',
        'free after story',
        'block',
        'choice',
        'quiz',
        'goto back',
        'goto forward',
      ]) {
        expect(seen, shape).toContain(shape);
      }
    },
    SLOW_SAMPLES_TIMEOUT_MS
  );
});

describe('tourBlockArbitrary, audio', () => {
  // Why this test matters: an ambient zone's inner calm (`minM`) must stay
  // below its reach (`maxM`), and only a generator that writes `minM` puts
  // that rule under property coverage. Its bounds come from the format's
  // reach constants, so a change to one cannot drift past the reader.
  it('writes an inner calm below the reach, which the reader accepts', () => {
    const assets = parseTourAssets(
      TOUR_ARBITRARY_ASSETS.map((a) => ({ ...a })),
      {
        fail: (m: string): never => {
          throw new Error(m);
        },
      }
    );
    const seen = new Set<string>();
    fc.assert(
      // Free: its views are the world ones, a zone (reach required) and a
      // spot (reach kept, optional).
      fc.property(tourBlockArbitrary('a', 'free', ['audio']), (block) => {
        parseTourStationChildren(JSON.parse(JSON.stringify([block])), 'c', {
          assets,
          fail: (m: string): never => {
            throw new Error(m);
          },
        });
        const { minM, maxM } = block as { minM?: number; maxM?: number };
        if (minM !== undefined) {
          seen.add(maxM === undefined ? 'calm alone' : 'calm under reach');
        }
        const inReach = (m: number | undefined) =>
          m === undefined ||
          (m >= TOUR_AUDIO_MIN_REACH_M && m <= TOUR_AUDIO_MAX_REACH_M);
        const below = minM === undefined || maxM === undefined || minM < maxM;
        return inReach(minM) && inReach(maxM) && below;
      }),
      { numRuns: 300 }
    );
    expect([...seen].sort()).toEqual(['calm alone', 'calm under reach']);
  });
});
