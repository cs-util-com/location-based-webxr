/**
 * Why these tests matter: the live and replay scenes used to wire the frame
 * tiles in two copies. The one behavioural difference between them is the
 * tile cap, and the replay side's contract is "NO cap, constructed with no
 * options at all" (full-path coverage). These pin that construction, the
 * divisor reaching the decoder, the decode-failure log, and the teardown
 * order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, mockCtor, mockDecode, mockWarn } = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    mockCtor: vi.fn(function (
      this: { dispose: () => void },
      ..._args: unknown[]
    ) {
      this.dispose = vi.fn(() => {
        calls.push('visualizer.dispose');
      });
    }),
    mockDecode: vi.fn(() => Promise.resolve(null)),
    mockWarn: vi.fn(),
  };
});

vi.mock('./frame-tile-visualizer', () => ({ FrameTileVisualizer: mockCtor }));
vi.mock('./wire-frame-tile-subscribers', () => ({
  wireFrameTileSubscribers: vi.fn(() =>
    vi.fn(() => {
      calls.push('unsubscribe');
    })
  ),
}));
vi.mock(
  'gps-plus-slam-app-framework/visualization/frame-texture-decoder',
  () => ({ decodeFrameTexture: mockDecode })
);
vi.mock('gps-plus-slam-app-framework/utils/logger', () => ({
  createLogger: () => ({
    warn: mockWarn,
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import { wireFrameTileSubscribers } from './wire-frame-tile-subscribers';
import {
  wireFrameTileStack,
  type FrameTileStackDeps,
} from './frame-tile-stack';

const arWorldGroup = { name: 'arWorldGroup' } as unknown as never;
const storeRef = {
  get: () => null,
} as unknown as FrameTileStackDeps['storeRef'];
const blobSource = (): Promise<Blob | null> => Promise.resolve(null);

function wirerOptions() {
  return vi.mocked(wireFrameTileSubscribers).mock.calls.at(-1)?.[0] as {
    visualizer: unknown;
    blobSource: unknown;
    decodeTexture: (blob: Blob) => Promise<unknown>;
    onError: (err: unknown, imageFile: string) => void;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
});

describe('wireFrameTileStack', () => {
  it('capped (live): constructs the visualizer on arWorldGroup with the cap and feeds it', () => {
    wireFrameTileStack({
      arWorldGroup,
      storeRef,
      blobSource,
      divisor: 2,
      maxTiles: 50,
    });
    expect(mockCtor).toHaveBeenCalledWith(arWorldGroup, { maxTiles: 50 });
    const opts = wirerOptions();
    expect(opts.visualizer).toBe(mockCtor.mock.instances[0]);
    expect(opts.blobSource).toBe(blobSource);
  });

  it('uncapped (replay): constructs the visualizer with NO options object', () => {
    wireFrameTileStack({ arWorldGroup, storeRef, blobSource, divisor: 2 });
    expect(mockCtor).toHaveBeenCalledTimes(1);
    expect(mockCtor.mock.calls[0]).toHaveLength(1);
  });

  it('decodes with the display divisor and logs a decode failure by file name', async () => {
    wireFrameTileStack({ arWorldGroup, storeRef, blobSource, divisor: 4 });
    const blob = new Blob(['x']);
    await wirerOptions().decodeTexture(blob);
    expect(mockDecode).toHaveBeenCalledWith(blob, 4);

    const err = new Error('bad jpeg');
    wirerOptions().onError(err, 'frame-000007.jpg');
    expect(mockWarn).toHaveBeenCalledWith(
      'Frame tile decode failed for "frame-000007.jpg"',
      err
    );
  });

  it('disposes the visualizer and rethrows when the subscriber wiring throws', () => {
    // Why this matters: both call sites wrap the wiring in a best-effort
    // try/catch that only logs. Before this, a throw from the wiring step left
    // the already-constructed visualizer (and its GPU resources) unreachable,
    // because the disposer is only returned on success (PR #412 review).
    vi.mocked(wireFrameTileSubscribers).mockImplementationOnce(() => {
      throw new Error('wiring failed');
    });
    expect(() =>
      wireFrameTileStack({ arWorldGroup, storeRef, blobSource, divisor: 2 })
    ).toThrow('wiring failed');
    expect(calls).toEqual(['visualizer.dispose']);
  });

  it('teardown unsubscribes before disposing the visualizer', () => {
    const dispose = wireFrameTileStack({
      arWorldGroup,
      storeRef,
      blobSource,
      divisor: 2,
    });
    dispose();
    expect(calls).toEqual(['unsubscribe', 'visualizer.dispose']);
  });
});
