/**
 * Why these tests matter: a block's local pose decides where a visitor
 * sees it relative to its station. The pose must be checked at the
 * boundary and read back exactly (no -0, a unit rotation); the block
 * readers (`tour-blocks.ts`) use this one rule.
 */

import { describe, expect, it } from 'vitest';

import { parseTourLocalPose, TOUR_ITEM_MAX_OFFSET_M } from './tour-items';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

describe('parseTourLocalPose', () => {
  it('reads three offsets and a unit rotation, -0 read as 0 and a near-unit rotation renormalized', () => {
    const pose = parseTourLocalPose(
      { position: [-0, 1.5, 2], rotation: [0, 0, 0, 1.0004] },
      'p',
      fail
    );
    expect(Object.is(pose.position[0], 0)).toBe(true);
    expect(pose.position).toEqual([0, 1.5, 2]);
    expect(pose.rotation).toEqual([0, 0, 0, 1]);
  });

  it.each([
    ['no object', null, /"p" must be an object/],
    [
      'two offsets',
      { position: [1, 2], rotation: [0, 0, 0, 1] },
      /p\.position/,
    ],
    [
      'a non-finite offset',
      { position: [1, Number.NaN, 2], rotation: [0, 0, 0, 1] },
      /p\.position/,
    ],
    [
      'an offset beyond the sanity bound',
      { position: [TOUR_ITEM_MAX_OFFSET_M + 1, 0, 0], rotation: [0, 0, 0, 1] },
      /p\.position/,
    ],
    [
      'a rotation far from unit length',
      { position: [0, 0, 0], rotation: [0, 0, 0, 3] },
      /p\.rotation/,
    ],
    [
      'a rotation of three numbers',
      { position: [0, 0, 0], rotation: [0, 0, 1] },
      /p\.rotation/,
    ],
  ])('refuses %s', (_name, value, message) => {
    expect(() => parseTourLocalPose(value, 'p', fail)).toThrow(message);
  });
});
