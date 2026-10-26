/**
 * Why this test matters: every property about blocks, stories and caps is
 * only as hostile as these generators. A text generator that never reaches
 * its cap, or whose "over" texts are not over, or that never writes a
 * combining mark or a surrogate pair, would let a counting bug through
 * every property that uses it while they all stay green. This pins what
 * the generators claim: exact counts in the reader's own unit, the
 * boundaries actually reached, the hostile spellings actually produced,
 * ids at their limit and colliding across namespaces, and version 3
 * manifests the reader accepts.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  checkTourBlockText,
  TOUR_BLOCK_TEXT_RULES,
  tourTextCount,
  type TourTextRule,
} from '../ar/tour-blocks';
import { parseTourManifest } from '../ar/tour-manifest';
import {
  TOUR_ARBITRARY_ASSETS,
  tourIdArbitrary,
  tourManifestV3Arbitrary,
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

describe('tourTextArbitrary', () => {
  for (const [name, rule] of RULES) {
    it(`${name}: counts 1 to ${String(rule.max)}, reaching 1, the cap and one under it`, () => {
      const counts = fc
        .sample(tourTextArbitrary(rule), { numRuns: SAMPLES, seed: 7 })
        .map((text) => {
          expect(checkTourBlockText(rule, text)).toMatchObject({ ok: true });
          return tourTextCount(text, rule.unit);
        });
      expect(Math.min(...counts)).toBe(1);
      expect(Math.max(...counts)).toBe(rule.max);
      expect(counts).toContain(rule.max - 1);
    });

    it(`${name}: an "over" text is one to three over the cap and fails the check`, () => {
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
    });
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

describe('tourManifestV3Arbitrary', () => {
  it('builds version 3 manifests the reader accepts, with steps of every kind', () => {
    const kinds = new Set<string>();
    fc.assert(
      fc.property(tourManifestV3Arbitrary, (record) => {
        const manifest = parseTourManifest(JSON.parse(JSON.stringify(record)));
        for (const station of manifest.stations) {
          for (const step of station.steps) kinds.add(step.action.kind);
        }
      }),
      { numRuns: 200, seed: 9 }
    );
    expect([...kinds].sort()).toEqual(
      [
        'audio',
        'character',
        'choice',
        'image',
        'model',
        'quiz',
        'text',
        'video',
      ].sort()
    );
  });
});
