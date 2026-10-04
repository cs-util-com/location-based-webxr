/**
 * Tests for CameraFrameSource — the throttled RGBA capturer.
 *
 * Why these tests matter:
 * - The whole point of B2 is that the camera-frame blit runs at the DETECTION
 *   cadence, not per render frame. The "performance regression" test below pins
 *   that: it would fail loudly if a change reverted to per-frame capturing.
 * - The throttle must be deterministic (driven by the injected frame timestamp)
 *   and a capture failure must degrade gracefully, never throw into the frame
 *   loop.
 */

import { describe, it, expect, vi } from 'vitest';
import { CameraFrameSource } from './camera-frame-source';
import type { RgbaImage } from './qr/qr-frontend';

function fakeImage(width = 4, height = 4): RgbaImage {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

describe('CameraFrameSource', () => {
  it('does nothing until started', () => {
    const capture = vi.fn(() => fakeImage());
    const onCapture = vi.fn();
    const src = new CameraFrameSource({ capture, onCapture });

    src.onFrame(0);
    src.onFrame(1000);

    expect(capture).not.toHaveBeenCalled();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('captures on the first frame after start, then throttles by intervalMs', () => {
    const capture = vi.fn(() => fakeImage());
    const onCapture = vi.fn();
    const src = new CameraFrameSource(
      { capture, onCapture },
      { intervalMs: 125 }
    );
    src.start();

    src.onFrame(0); // first tick → capture
    src.onFrame(50); // < 125 since last → skip
    src.onFrame(100); // < 125 → skip
    src.onFrame(130); // ≥ 125 → capture

    expect(capture).toHaveBeenCalledTimes(2);
    expect(onCapture).toHaveBeenCalledTimes(2);
    expect(src.getFrameCount()).toBe(2);
  });

  /**
   * Why this test matters (performance regression — §A.4):
   * On a 60 fps device a render frame arrives ~every 16.7 ms. With the blit
   * gated to a 125 ms (~8 Hz) cadence, ~1 s of frames must produce ≈ 8
   * captures, NOT one per frame (~60). If someone wires the blit per-frame
   * again, this count blows past the bound and the test fails.
   */
  it('caps captures at the detection cadence, not the frame rate (perf regression)', () => {
    const capture = vi.fn(() => fakeImage());
    const onCapture = vi.fn();
    const src = new CameraFrameSource(
      { capture, onCapture },
      { intervalMs: 125 }
    );
    src.start();

    const FRAME_MS = 1000 / 60; // ~16.67 ms — a 60 fps render loop
    const frames = 60; // ~1 s of rendering
    for (let i = 0; i < frames; i++) {
      src.onFrame(i * FRAME_MS);
    }

    // ~8 Hz over ~1 s ⇒ 8–9 captures; assert it stays an order of magnitude
    // below the 60 render frames.
    expect(capture.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(capture.mock.calls.length).toBeLessThanOrEqual(9);
    expect(onCapture.mock.calls.length).toBe(capture.mock.calls.length);
  });

  it('does not consume the interval slot when capture returns null (retries next frame)', () => {
    // First capture attempt fails (no texture yet); the next frame should
    // retry immediately rather than waiting a full interval.
    const capture = vi
      .fn<() => RgbaImage | null>()
      .mockReturnValueOnce(null)
      .mockReturnValue(fakeImage());
    const onCapture = vi.fn();
    const src = new CameraFrameSource(
      { capture, onCapture },
      { intervalMs: 125 }
    );
    src.start();

    src.onFrame(0); // attempt → null, slot NOT consumed
    src.onFrame(16); // < 125 but slot free → retry → success

    expect(capture).toHaveBeenCalledTimes(2);
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(src.getFrameCount()).toBe(1);
  });

  it('swallows a capture throw and treats it as no frame', () => {
    const capture = vi.fn(() => {
      throw new Error('GL context lost');
    });
    const onCapture = vi.fn();
    const src = new CameraFrameSource(
      { capture, onCapture },
      { intervalMs: 125 }
    );
    src.start();

    expect(() => src.onFrame(0)).not.toThrow();
    expect(onCapture).not.toHaveBeenCalled();
    expect(src.getFrameCount()).toBe(0);
  });

  it('stops capturing after stop()', () => {
    const capture = vi.fn(() => fakeImage());
    const onCapture = vi.fn();
    const src = new CameraFrameSource(
      { capture, onCapture },
      { intervalMs: 125 }
    );
    src.start();
    src.onFrame(0);
    src.stop();
    src.onFrame(1000);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(src.isRunning()).toBe(false);
  });

  it('start() resets the cadence so the next tick captures', () => {
    const capture = vi.fn(() => fakeImage());
    const onCapture = vi.fn();
    const src = new CameraFrameSource(
      { capture, onCapture },
      { intervalMs: 125 }
    );
    src.start();
    src.onFrame(1000);
    expect(capture).toHaveBeenCalledTimes(1);

    // Restart at a LATER-but-sub-interval timestamp; the reset must let it
    // capture again immediately rather than carrying the previous lastCapture.
    src.start();
    src.onFrame(1050);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(src.getFrameCount()).toBe(1); // reset zeroed the counter
  });

  describe('constructor config validation', () => {
    /**
     * Why this test matters: `updateConfig` already validates `intervalMs`
     * (see the block below), but the constructor is a second entry point for
     * the SAME config. It must apply the SAME guard — otherwise an invalid
     * value passed at construction silently bypasses validation. `intervalMs`
     * is typed `number`, so `0`, a negative, `NaN` or `Infinity` are all
     * type-valid inputs that need no cast to reach this path.
     */
    it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
      'ignores an invalid constructor intervalMs (%s) and keeps the default',
      (bad) => {
        const src = new CameraFrameSource(
          { capture: () => null, onCapture: vi.fn() },
          { intervalMs: bad }
        );
        expect(src.getConfig().intervalMs).toBe(125);
      }
    );

    /**
     * The concrete harm of the missing guard (regression): a `NaN` interval
     * makes the throttle check `timestamp - lastCaptureTime < NaN` always
     * false, so EVERY frame captures — exactly the per-frame blit the whole
     * throttle exists to prevent. With validation, the default 125 ms cadence
     * is restored and ~1 s of 60 fps frames yields ≈ 8 captures, not 60.
     */
    it('does not let an invalid constructor intervalMs bypass the throttle', () => {
      const capture = vi.fn(() => fakeImage());
      const onCapture = vi.fn();
      const src = new CameraFrameSource(
        { capture, onCapture },
        { intervalMs: Number.NaN }
      );
      src.start();

      const FRAME_MS = 1000 / 60;
      for (let i = 0; i < 60; i++) {
        src.onFrame(i * FRAME_MS);
      }

      expect(capture.mock.calls.length).toBeLessThanOrEqual(9);
    });
  });

  describe('updateConfig', () => {
    it('applies a valid intervalMs', () => {
      const src = new CameraFrameSource({
        capture: () => null,
        onCapture: vi.fn(),
      });
      src.updateConfig({ intervalMs: 250 });
      expect(src.getConfig().intervalMs).toBe(250);
    });

    it('ignores non-finite or non-positive intervalMs', () => {
      const src = new CameraFrameSource(
        { capture: () => null, onCapture: vi.fn() },
        { intervalMs: 125 }
      );
      src.updateConfig({ intervalMs: 0 });
      src.updateConfig({ intervalMs: -5 });
      src.updateConfig({ intervalMs: Number.NaN });
      expect(src.getConfig().intervalMs).toBe(125);
    });
  });

  /**
   * Why these tests matter (QR perf plan 2026-09-23, M3): a frame captured
   * while the detector is still busy is read back from the GPU, copied and then
   * thrown away by the scheduler. The consumer's wantsFrame predicate lets the
   * source skip that work - and because a skip does NOT consume the interval,
   * the first frame after the detector frees up is captured at once instead of
   * waiting out the rest of the slot.
   */
  describe('wantsFrame', () => {
    function source(wants: () => boolean) {
      const capture = vi.fn(() => fakeImage());
      const onCapture = vi.fn();
      const src = new CameraFrameSource(
        { capture, onCapture },
        { intervalMs: 125 }
      );
      src.setWantsFrame(wants);
      src.start();
      return { src, capture, onCapture };
    }

    it('skips the capture entirely while the consumer does not want a frame', () => {
      const { src, capture, onCapture } = source(() => false);
      src.onFrame(0);
      src.onFrame(200);
      expect(capture).not.toHaveBeenCalled();
      expect(onCapture).not.toHaveBeenCalled();
      expect(src.getFrameCount()).toBe(0);
    });

    it('does not consume the interval, so the first frame after busy is captured at once', () => {
      let busy = false;
      const { src, capture } = source(() => !busy);
      src.onFrame(0); // captured
      busy = true;
      src.onFrame(130); // due, but busy -> skipped, slot NOT consumed
      busy = false;
      src.onFrame(146); // 16 ms later: still due -> captured now
      expect(capture).toHaveBeenCalledTimes(2);
    });

    it('never captures more often than the interval, whatever the predicate says', () => {
      const { src, capture } = source(() => true);
      for (let t = 0; t < 1000; t += 16) src.onFrame(t);
      expect(capture.mock.calls.length).toBeLessThanOrEqual(9);
    });

    it('treats a throwing predicate as wanting a frame (never throws into the XR loop)', () => {
      const { src, capture } = source(() => {
        throw new Error('app bug');
      });
      expect(() => src.onFrame(0)).not.toThrow();
      expect(capture).toHaveBeenCalledTimes(1);
    });

    it('goes back to capturing every interval when the predicate is cleared', () => {
      const { src, capture } = source(() => false);
      src.onFrame(0);
      src.setWantsFrame(null);
      src.onFrame(16);
      expect(capture).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Why this test matters (QR perf plan 2026-09-23, M4): the session stamps each
 * captured frame with the XR frame time it was captured in, so `capture`
 * receives that timestamp - and a source can carry any frame type (the session
 * delivers a pose-paired `CapturedCameraFrame`, not a bare image).
 */
describe('CameraFrameSource frame timestamp', () => {
  it('passes the XR frame timestamp to capture and delivers whatever capture built', () => {
    const seen: number[] = [];
    const delivered: { at: number }[] = [];
    const src = new CameraFrameSource<{ at: number }>(
      {
        capture: (timestamp) => {
          seen.push(timestamp);
          return { at: timestamp };
        },
        onCapture: (frame) => delivered.push(frame),
      },
      { intervalMs: 125 }
    );
    src.start();
    src.onFrame(1000);
    expect(seen).toEqual([1000]);
    expect(delivered).toEqual([{ at: 1000 }]);
  });
});
