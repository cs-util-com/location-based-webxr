/**
 * Why this test matters: a placed model's size (`sizeM`, the scaled model's
 * largest side in metres) is the one number of a block a creator drags
 * freely, so the bound must hold for every double, not only the handful of
 * examples in `tour-blocks.test.ts`: every size inside 0.05-500 m reads
 * back exactly through JSON, every positive size outside it is refused by
 * a strict read and left out by a lenient one, and nothing that is not a
 * positive finite number is ever a size - at any minor.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseTourAssets } from './tour-assets';
import {
  readTourBlocks,
  TOUR_BLOCK_VIEWS,
  TOUR_MODEL_MAX_NOTES,
  TOUR_MODEL_MAX_SECTIONS,
  TOUR_MODEL_MAX_SIZE_M,
  TOUR_MODEL_MIN_SIZE_M,
  TOUR_MODEL_NOTE_RULES,
  TOUR_MODEL_WORLD_VIEWS,
  tourBlocksMinor,
} from './tour-blocks';
import {
  tourModelAnimationArbitrary,
  tourModelNoteArbitrary,
  tourModelSectionArbitrary,
} from '../test-utils/tour-arbitraries';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

const assets = parseTourAssets([{ id: 'statue', path: 'content/statue.glb' }], {
  fail,
});

const model = (sizeM: unknown) => ({
  id: 'm1',
  kind: 'model',
  view: 'placed',
  asset: 'statue',
  sizeM,
  createdAtIso: '2026-10-19T12:00:00.000Z',
  pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
});

/** The one block read from `value`, or none when a lenient read left it
 *  out. */
function read(value: unknown, lenient = false) {
  return readTourBlocks([value], 'x', { assets, fail, lenient }).map(
    (r) => r.block
  )[0];
}

/** What a read makes of a model's notes: their count, 'absent', 'left out'
 *  (a lenient read skipped the block) or 'refused' (a strict read threw). */
function noteCount(value: unknown, lenient: boolean): number | string {
  try {
    const block = read(value, lenient);
    if (block === undefined) return 'left out';
    if (block.kind !== 'model') return 'not a model';
    return block.annotations?.length ?? 'absent';
  } catch (error) {
    return error instanceof Invalid ? 'refused' : 'other error';
  }
}

/** The first note's title after a strict read, or why the read refused. */
function firstNoteTitle(value: unknown): string | undefined {
  try {
    const block = read(value);
    return block?.kind === 'model' ? block.annotations?.[0]?.title : undefined;
  } catch (error) {
    return error instanceof Invalid
      ? `refused: ${/is longer than 64/.exec(error.message)?.[0] ?? error.message}`
      : 'other error';
  }
}

/** The double next to `x` towards `towards` (one ulp). */
function nextDouble(x: number, towards: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, towards > x === x >= 0 ? bits + 1n : bits - 1n);
  return view.getFloat64(0);
}

const inside = fc.double({
  min: TOUR_MODEL_MIN_SIZE_M,
  max: TOUR_MODEL_MAX_SIZE_M,
  noNaN: true,
});
const positiveOutside = fc.oneof(
  fc.double({
    min: Number.MIN_VALUE,
    max: nextDouble(TOUR_MODEL_MIN_SIZE_M, 0),
    noNaN: true,
  }),
  fc.double({
    min: nextDouble(TOUR_MODEL_MAX_SIZE_M, Infinity),
    max: Number.MAX_VALUE,
    noNaN: true,
  })
);
const neverASize = fc.oneof(
  fc.double({ max: 0, noNaN: true }),
  fc.constantFrom(Number.NaN, Infinity, -Infinity),
  fc.string(),
  fc.constant(null),
  fc.boolean()
);

describe('a placed model size (properties)', () => {
  it('every size within the bound reads back exactly through JSON', () => {
    fc.assert(
      fc.property(inside, (sizeM) => {
        expect(read(JSON.parse(JSON.stringify(model(sizeM))))).toMatchObject({
          kind: 'model',
          sizeM,
        });
      }),
      { numRuns: 500 }
    );
  });

  it('the doubles right at the bound: the bounds are in, one ulp beyond is out', () => {
    for (const sizeM of [TOUR_MODEL_MIN_SIZE_M, TOUR_MODEL_MAX_SIZE_M]) {
      expect(read(model(sizeM))).toMatchObject({ sizeM });
    }
    for (const sizeM of [
      nextDouble(TOUR_MODEL_MIN_SIZE_M, 0),
      nextDouble(TOUR_MODEL_MAX_SIZE_M, Infinity),
    ]) {
      expect(() => read(model(sizeM))).toThrow(Invalid);
    }
  });

  it('every positive size beyond the bound: refused strictly, left out leniently', () => {
    fc.assert(
      fc.property(positiveOutside, (sizeM) => {
        expect(() => read(model(sizeM))).toThrow(Invalid);
        expect(read(model(sizeM), true)).toBeUndefined();
      }),
      { numRuns: 500 }
    );
  });

  it('nothing that is not a positive finite number is a size, at any minor', () => {
    fc.assert(
      fc.property(neverASize, fc.boolean(), (sizeM, lenient) => {
        expect(() => read(model(sizeM), lenient)).toThrow(Invalid);
      }),
      { numRuns: 500 }
    );
  });
});

/**
 * Why these matter: a model's notes, sections and clip (minor 1) are lists
 * a creator grows freely, so their limits and the minor the writer stamps
 * must hold for every list, not only the examples in `tour-blocks.test.ts`.
 */
describe("a model's notes, sections and clip (properties)", () => {
  const noteList = (n: number) =>
    fc.array(tourModelNoteArbitrary, { minLength: n, maxLength: n });

  it('every valid set of notes, sections and clip in any world view reads back exactly through JSON', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOUR_MODEL_WORLD_VIEWS),
        fc.option(tourModelAnimationArbitrary, { nil: undefined }),
        fc.array(tourModelNoteArbitrary, {
          minLength: 1,
          maxLength: TOUR_MODEL_MAX_NOTES,
        }),
        fc.array(tourModelSectionArbitrary, {
          minLength: 1,
          maxLength: TOUR_MODEL_MAX_SECTIONS,
        }),
        (view, animation, annotations, sections) => {
          const block = {
            ...model(2),
            view,
            ...(animation === undefined ? {} : { animation }),
            annotations,
            sections,
          };
          const json = JSON.parse(JSON.stringify(block)) as typeof block;
          expect(read(json)).toEqual(json);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('any number of notes: none reads as absent, up to 32 kept, more refused strictly and left out leniently', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 0, max: TOUR_MODEL_MAX_NOTES + 8 })
          .chain((n) => noteList(n).map((notes) => ({ n, notes }))),
        ({ n, notes }) => {
          const block = { ...model(2), annotations: notes };
          const expected =
            n === 0
              ? ['absent', 'absent']
              : n <= TOUR_MODEL_MAX_NOTES
                ? [n, n]
                : ['refused', 'left out'];
          expect([noteCount(block, false), noteCount(block, true)]).toEqual(
            expected
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a note's title: kept up to 64 counted characters, refused beyond", () => {
    fc.assert(
      fc.property(
        tourModelNoteArbitrary,
        fc.integer({ min: 1, max: 80 }),
        (note, n) => {
          const title = 'n'.repeat(n);
          const block = { ...model(2), annotations: [{ ...note, title }] };
          const kept = n <= TOUR_MODEL_NOTE_RULES.title.max;
          expect(firstNoteTitle(block)).toBe(
            kept ? title : 'refused: is longer than 64'
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the minor a model needs is 1 exactly when it uses a new view or any new field', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOUR_BLOCK_VIEWS.model),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        tourModelNoteArbitrary,
        tourModelSectionArbitrary,
        tourModelAnimationArbitrary,
        (view, hasNote, hasSection, hasClip, note, section, animation) => {
          const block = {
            ...model(view === 'stage' ? undefined : 2),
            view,
            ...(hasNote ? { annotations: [note] } : {}),
            ...(hasSection ? { sections: [section] } : {}),
            ...(hasClip ? { animation } : {}),
          };
          if (view === 'stage') delete (block as { sizeM?: unknown }).sizeM;
          const newView = !['placed', 'stage', 'card'].includes(view);
          const expected = newView || hasNote || hasSection || hasClip ? 1 : 0;
          const blocks = readTourBlocks([block], 'x', { assets, fail }).map(
            (r) => r.block
          );
          expect(tourBlocksMinor(blocks)).toBe(expected);
        }
      ),
      { numRuns: 300 }
    );
  });
});
