/**
 * Properties of the packed depth sample (scan pass S2): whatever the
 * recording is handed, writing it and reading it back gives what the JSON
 * form gave - packed where it can be, written as it was where it cannot.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEPTH_SAMPLE_ACTION_TYPE,
  packDepthAction,
  unpackDepthAction,
} from './depth-sample-codec';

const channel = fc.integer({ min: 0, max: 255 });
const rgb = fc.tuple(channel, channel, channel);

/** A sampler grid: g x g at the sampler's positions, float32 depths, and
 *  colour on every point or on none. */
const samplerGrid = fc
  .record({
    g: fc.integer({ min: 1, max: 24 }),
    withRgb: fc.boolean(),
    seed: fc.array(fc.tuple(fc.float(), rgb), {
      minLength: 576,
      maxLength: 576,
    }),
  })
  .map(({ g, withRgb, seed }) => {
    const points = [];
    for (let row = 0; row < g; row++) {
      for (let col = 0; col < g; col++) {
        const [depthM, colour] = seed[row * g + col]!;
        points.push({
          screenX: (col + 1) / (g + 1),
          screenY: (row + 1) / (g + 1),
          depthM,
          ...(withRgb ? { rgb: colour } : {}),
        });
      }
    }
    return points;
  });

/** Anything a point list might hold: double depths, partial colour, odd
 *  positions - the packer must write these as they are. */
const anyPoints = fc.array(
  fc.record(
    {
      screenX: fc.double({ noNaN: true }),
      screenY: fc.double({ noNaN: true }),
      depthM: fc.oneof(fc.double(), fc.float()),
      rgb: fc.tuple(fc.integer(), fc.integer(), fc.integer()),
    },
    { requiredKeys: ['screenX', 'screenY', 'depthM'] }
  ),
  { maxLength: 40 }
);

const action = (points: unknown[]) => ({
  type: DEPTH_SAMPLE_ACTION_TYPE,
  payload: {
    timestamp: 1_759_900_000_123.25,
    cameraPos: [0.1, 1.2, -3.4],
    cameraRot: [0, 0, 0, 1],
    points,
  },
});

function writtenAndRead(written: unknown): unknown {
  const read = unpackDepthAction(
    JSON.parse(JSON.stringify(packDepthAction(written)))
  );
  if (!read.ok) throw new Error(read.reason);
  return read.action;
}

describe('the packed depth sample, as properties', () => {
  // Why: the format is lossless - a recording read back after S2 is the
  // recording the JSON form would have given, for every sampler grid.
  it('reads every sampler grid back as its JSON form', () => {
    fc.assert(
      fc.property(samplerGrid, (points) => {
        const a = action(points);
        expect(writtenAndRead(a)).toEqual(JSON.parse(JSON.stringify(a)));
      })
    );
  });

  // Why: the packed form is used for every grid without NaN or infinity -
  // the gain does not quietly fall back to JSON.
  it('packs every finite sampler grid', () => {
    fc.assert(
      fc.property(samplerGrid, (points) => {
        fc.pre(points.every((p) => Number.isFinite(p.depthM)));
        const packed = packDepthAction(action(points)) as {
          payload: { grid?: unknown };
        };
        expect(packed.payload.grid).toBeDefined();
      })
    );
  });

  // Why: whatever is handed to the writer comes back as JSON would have
  // given it - packed or not.
  it('reads any point list back as its JSON form', () => {
    fc.assert(
      fc.property(anyPoints, (points) => {
        const a = action(points);
        expect(writtenAndRead(a)).toEqual(JSON.parse(JSON.stringify(a)));
      })
    );
  });
});
