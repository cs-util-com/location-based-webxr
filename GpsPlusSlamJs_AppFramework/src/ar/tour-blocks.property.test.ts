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
  TOUR_MODEL_MAX_SIZE_M,
  TOUR_MODEL_MIN_SIZE_M,
} from './tour-blocks';

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
