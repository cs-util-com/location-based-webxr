/**
 * The packed depth sample (scan pass S2): what the recording writes for a
 * depth sample, and what every reader gets back. The format is a
 * recording format - once a phone has written it, every later reader must
 * decode it - so the round trip is held exactly, and every sample the
 * packed form cannot hold exactly must be written as it was.
 */

import { describe, expect, it } from 'vitest';
import type { DepthPoint, DepthSample } from '../types/ar-types';
import {
  DEPTH_SAMPLE_ACTION_TYPE,
  MAX_PACKED_GRID_SIZE,
  packDepthAction,
  unpackDepthAction,
} from './depth-sample-codec';

/** A full g x g grid at the sampler's positions (`depth-sampler.ts`). */
function grid(
  g: number,
  depth: (i: number) => number,
  rgb?: (i: number) => readonly [number, number, number]
): DepthPoint[] {
  const points: DepthPoint[] = [];
  for (let row = 0; row < g; row++) {
    for (let col = 0; col < g; col++) {
      const i = row * g + col;
      points.push({
        screenX: (col + 1) / (g + 1),
        screenY: (row + 1) / (g + 1),
        depthM: depth(i),
        ...(rgb ? { rgb: rgb(i) } : {}),
      });
    }
  }
  return points;
}

function sample(points: DepthPoint[]): DepthSample {
  return {
    timestamp: 1_759_900_000_123.25,
    cameraPos: [0.123456789, 1.5, -2.000000001],
    cameraRot: [0.1, 0.2, 0.3, 0.9273618495495703],
    points,
    projectionMatrix: [
      1.8, 0, 0, 0, 0, 2.4, 0, 0, 0, 0, -1.0000200271606445, -1, 0, 0,
      -0.020000200718641281, 0,
    ].map((v) => Math.fround(v)),
  } as unknown as DepthSample;
}

const depthAction = (s: DepthSample) => ({
  type: DEPTH_SAMPLE_ACTION_TYPE,
  payload: s,
});

/** What a reader of the old JSON form got: the action through JSON. */
const asJson = (action: unknown): unknown => JSON.parse(JSON.stringify(action));

/** Write as the recording does, then read as the loader does. */
function roundTrip(action: unknown): unknown {
  const written = JSON.parse(JSON.stringify(packDepthAction(action)));
  const read = unpackDepthAction(written);
  if (!read.ok) throw new Error(read.reason);
  return read.action;
}

const f32 = (i: number) => Math.fround(0.25 + i * 0.0173);

describe('packDepthAction', () => {
  // Why: the gain S2 exists for - the Tour Viewer's 16 x 16 sample without
  // colour, as the phone writes it.
  it('packs a full grid without colour, and reads it back exactly', () => {
    const action = depthAction(sample(grid(16, f32)));
    const packed = packDepthAction(action) as {
      payload: { points: unknown[]; grid: { size: number; rgb?: string } };
    };
    expect(packed.payload.points).toEqual([]);
    expect(packed.payload.grid.size).toBe(16);
    expect(packed.payload.grid.rgb).toBeUndefined();
    expect(roundTrip(action)).toEqual(asJson(action));
    expect(JSON.stringify(packed).length).toBeLessThan(
      JSON.stringify(action, null, 2).length / 12
    );
  });

  // Why: the Recorder's 24 x 24 sample carries a colour per point.
  it('packs a full grid with colour, and reads it back exactly', () => {
    const action = depthAction(
      sample(grid(24, f32, (i) => [i % 256, (i * 7) % 256, 255 - (i % 256)]))
    );
    expect(
      (packDepthAction(action) as { payload: { grid: { rgb?: string } } })
        .payload.grid.rgb
    ).toEqual(expect.any(String));
    expect(roundTrip(action)).toEqual(asJson(action));
  });

  // Why: the e2e fake and the smallest sampler grid - one point at 0.5.
  it('packs a one-point grid', () => {
    const action = depthAction(sample(grid(1, () => 1.5)));
    expect(roundTrip(action)).toEqual(asJson(action));
  });

  // Why: only the depth sample's type is packed - another action that
  // happens to carry a point grid is written as it is.
  it('packs no other action type, whatever its payload', () => {
    const other = {
      type: 'recording/somethingElse',
      payload: sample(grid(4, f32)),
    };
    expect(packDepthAction(other)).toBe(other);
  });

  // Why: everything but a depth sample - and every field of the sample
  // but its points - is written exactly as before.
  it('leaves every other action, and the sample fields, as they are', () => {
    const gps = { type: 'gpsData/recordGpsEvent', payload: { lat: 47.5 } };
    expect(packDepthAction(gps)).toBe(gps);
    const action = depthAction(sample(grid(4, f32)));
    const {
      points: _p,
      grid: _g,
      ...rest
    } = (packDepthAction(action) as { payload: Record<string, unknown> })
      .payload;
    const { points: _q, ...expected } = action.payload;
    expect(rest).toEqual(expected);
  });

  // Why (the S2 cold review's #6c): the store holds the payload by
  // reference and freezes it; the writer only reads it.
  it('does not change a frozen action', () => {
    const action = depthAction(sample(grid(4, f32)));
    const before = JSON.stringify(action);
    Object.freeze(action);
    Object.freeze(action.payload);
    expect(() => packDepthAction(action)).not.toThrow();
    expect(JSON.stringify(action)).toBe(before);
  });

  // Why (the S2 plan §2, the cold review's #2): the packed form holds only
  // float32 depths, byte colours and the sampler's layout; anything else
  // is written in the JSON form, never changed on the way.
  describe('writes the JSON form when the packed one cannot hold the sample', () => {
    const cases: [string, DepthPoint[]][] = [
      ['an empty sample', []],
      ['a grid that is not square', grid(4, f32).slice(0, 15)],
      [
        'a point off the sampler column',
        grid(4, f32).map((p, i) => (i === 5 ? { ...p, screenX: 0.33 } : p)),
      ],
      [
        'a point off the sampler row',
        grid(4, f32).map((p, i) => (i === 5 ? { ...p, screenY: 0.33 } : p)),
      ],
      ['points in another order', [...grid(4, f32)].reverse()],
      ['a depth that is not float32', grid(4, (i) => (i === 3 ? 1.1 : f32(i)))],
      ['a NaN depth', grid(4, (i) => (i === 3 ? Number.NaN : f32(i)))],
      ['an infinite depth', grid(4, (i) => (i === 3 ? Infinity : f32(i)))],
      [
        'colour on some points only',
        grid(4, f32).map((p, i) => (i === 2 ? { ...p, rgb: [1, 2, 3] } : p)),
      ],
      ['a colour channel of 256', grid(2, f32, () => [0, 256, 0])],
      ['a colour channel of 1.5', grid(2, f32, () => [0, 1.5, 0])],
      ['a colour channel below 0', grid(2, f32, () => [-1, 0, 0])],
      [
        'a point with a field the packed form has no place for',
        grid(2, f32).map((p) => ({ ...p, confidence: 0.5 }) as DepthPoint),
      ],
    ];
    it.each(cases)('%s', (_name, points) => {
      const action = depthAction(sample(points));
      expect(packDepthAction(action)).toBe(action);
    });

    it('a grid larger than the reader accepts', () => {
      const g = MAX_PACKED_GRID_SIZE + 1;
      const action = depthAction(sample(grid(g, () => 1)));
      expect(packDepthAction(action)).toBe(action);
    });
  });

  // Why (the S2 cold review's #6b): a throw inside the recording's write
  // would fail every depth sample; the packer gives the action back.
  it('never throws, whatever the payload', () => {
    const hostile: unknown[] = [
      null,
      undefined,
      42,
      'text',
      { type: DEPTH_SAMPLE_ACTION_TYPE },
      { type: DEPTH_SAMPLE_ACTION_TYPE, payload: null },
      { type: DEPTH_SAMPLE_ACTION_TYPE, payload: { points: 'x' } },
      { type: DEPTH_SAMPLE_ACTION_TYPE, payload: { points: [null] } },
      {
        type: DEPTH_SAMPLE_ACTION_TYPE,
        payload: { points: [{ screenX: 0.5, screenY: 0.5, depthM: '1' }] },
      },
      {
        type: DEPTH_SAMPLE_ACTION_TYPE,
        get payload(): never {
          throw new Error('a getter that throws');
        },
      },
    ];
    for (const action of hostile) {
      expect(() => packDepthAction(action)).not.toThrow();
      expect(packDepthAction(action)).toBe(action);
    }
  });

  // Why: JSON writes -0 as 0, so the packed form must read back what the
  // JSON form would have.
  it('reads a depth of -0 back as JSON would have written it', () => {
    const action = depthAction(sample(grid(2, (i) => (i === 1 ? -0 : 1))));
    const read = roundTrip(action) as { payload: { points: DepthPoint[] } };
    expect(Object.is(read.payload.points[1]!.depthM, 0)).toBe(true);
  });
});

describe('unpackDepthAction', () => {
  // Why: an action without a packed grid - every recording before S2, and
  // every other action - is read exactly as before.
  it('gives every action without a packed grid back as it is', () => {
    const json = asJson(depthAction(sample(grid(2, f32))));
    const read = unpackDepthAction(json);
    expect(read).toEqual({ ok: true, action: json });
    const gps = { type: 'gpsData/recordGpsEvent', payload: { grid: 1 } };
    expect(unpackDepthAction(gps)).toEqual({ ok: true, action: gps });
  });

  // Why (the S2 cold review's #6a): a visitor's join reads a tour's
  // recording, so the grid is untrusted; a bad one is refused before
  // anything is allocated, and refused - never thrown.
  describe('refuses a damaged grid', () => {
    const good = asJson(packDepthAction(depthAction(sample(grid(4, f32))))) as {
      type: string;
      payload: { grid: Record<string, unknown> };
    };
    const withGrid = (g: Record<string, unknown>) => ({
      ...good,
      payload: { ...good.payload, grid: { ...good.payload.grid, ...g } },
    });
    const cases: [string, unknown][] = [
      ['an unknown version', withGrid({ v: 2 })],
      ['a size of 0', withGrid({ size: 0 })],
      ['a size of 0 with no bytes', withGrid({ size: 0, depthF32: '' })],
      ['a fractional size', withGrid({ size: 2.5 })],
      ['a size above the bound', withGrid({ size: MAX_PACKED_GRID_SIZE + 1 })],
      ['a size that does not match the bytes', withGrid({ size: 5 })],
      ['depths that are not base64url', withGrid({ depthF32: '***' })],
      ['depths that are not text', withGrid({ depthF32: 7 })],
      ['too few depth bytes', withGrid({ depthF32: 'AAAA' })],
      ['colours of the wrong length', withGrid({ rgb: 'AAAA' })],
      ['colours that are not text', withGrid({ rgb: [1, 2, 3] })],
      [
        'a grid that is not an object',
        { ...good, payload: { ...good.payload, grid: 'x' } },
      ],
    ];
    it.each(cases)('%s', (_name, action) => {
      const read = unpackDepthAction(action);
      expect(read.ok).toBe(false);
    });

    // The bound holds on its own, for a grid whose bytes match its size:
    // the size alone decides how much a reader allocates.
    it('a size above the bound, with bytes to match', () => {
      const g = MAX_PACKED_GRID_SIZE + 1;
      const depthF32 = Buffer.alloc(4 * g * g).toString('base64url');
      expect(unpackDepthAction(withGrid({ size: g, depthF32 })).ok).toBe(false);
    });
  });

  // Why: the packer never writes a grid next to points; such a payload is
  // read as written (its points), not merged.
  it('reads a grid written next to points as its points', () => {
    const json = asJson(depthAction(sample(grid(2, f32)))) as {
      type: string;
      payload: Record<string, unknown>;
    };
    const both = {
      ...json,
      payload: {
        ...json.payload,
        grid: (
          asJson(packDepthAction(depthAction(sample(grid(4, f32))))) as {
            payload: { grid: unknown };
          }
        ).payload.grid,
      },
    };
    const read = unpackDepthAction(both);
    expect(read.ok).toBe(true);
    expect(
      (read as { action: { payload: { points: unknown[] } } }).action.payload
        .points
    ).toEqual(json.payload.points);
  });
});
