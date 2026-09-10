/**
 * Why this test matters: this parser is shared by the level file and the
 * tour manifest, so a message must name the DOCUMENT PATH the caller
 * passed (a creator reading `"qr.geo.lat"` for a pin would look in the
 * wrong file) and must throw the caller's error type. The rules
 * themselves are pinned by `qr-level.test.ts` and
 * `qr-level.property.test.ts`, which exercise this module through the
 * level's wrapper; this file pins only what the extraction added.
 */

import { describe, expect, it } from 'vitest';

import { parseGeoPose } from './geo-pose';

class MyError extends Error {}
const fail = (message: string): never => {
  throw new MyError(message);
};

describe('parseGeoPose', () => {
  it('names the caller-supplied path in every message and throws the caller-supplied error', () => {
    expect(() =>
      parseGeoPose(
        { lat: 100, lon: 0, alt: 0, headingDeg: 0 },
        { path: 'objects[2].geo', fail }
      )
    ).toThrow(MyError);
    expect(() =>
      parseGeoPose(
        { lat: 100, lon: 0, alt: 0, headingDeg: 0 },
        { path: 'objects[2].geo', fail }
      )
    ).toThrow('"objects[2].geo.lat" must be a number in [-90, 90]');
    expect(() => parseGeoPose(42, { path: 'x', fail })).toThrow(
      '"x" must be an object'
    );
    expect(() =>
      parseGeoPose({ lat: 0, lon: 0, alt: 0 }, { path: 'x', fail })
    ).toThrow('"x" must carry "headingDeg" and/or "rotation"');
  });

  it('returns the normalised pose for a valid input', () => {
    expect(
      parseGeoPose(
        { lat: 1, lon: 2, alt: 3, headingDeg: -90, rotation: undefined },
        { path: 'x', fail }
      )
    ).toEqual({ lat: 1, lon: 2, alt: 3, headingDeg: 270 });
  });
});
