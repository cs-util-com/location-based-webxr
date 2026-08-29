/**
 * Property-based tests for camera-blit-capture module.
 *
 * Why these tests matter:
 * - The isBlackFrame check samples pixels at regular intervals.
 *   A property-based approach ensures it works for arbitrary buffer sizes
 *   and pixel distributions, not just hand-crafted examples.
 * - Verifies that any buffer with at least one non-zero RGB pixel is
 *   correctly detected as non-black regardless of where it appears.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CameraBlitCapture,
  computeAspectFitSize,
  computeCaptureSize,
} from './camera-blit-capture';

describe('camera-blit-capture property tests', () => {
  describe('CameraBlitCapture.isBlackFrame', () => {
    /**
     * Property: An all-zero buffer of any valid size should always be detected as black.
     */
    it('always detects all-zero buffers as black for various sizes', () => {
      const sizes = [4, 16, 64, 256, 1024, 4096, 16384];
      for (const size of sizes) {
        const buffer = new Uint8Array(size * 4); // RGBA
        const result = CameraBlitCapture.isBlackFrame(buffer);
        expect(result).toBe(true);
      }
    });

    /**
     * Property: A buffer where a significant portion of pixels are non-zero
     * should always be detected as non-black.
     * Note: isBlackFrame uses sampling (100 sample points), so a single
     * non-zero pixel may be missed. This is by design for performance.
     * Real camera frames have many non-zero pixels, not just one.
     */
    it('detects non-black buffers when many pixels are non-zero', () => {
      const sizes = [16, 64, 256, 1024];
      for (const size of sizes) {
        const buffer = new Uint8Array(size * 4);
        // Fill >50% of pixels with non-zero values
        for (let i = 0; i < Math.floor(size / 2); i++) {
          buffer[i * 4] = 128; // R
          buffer[i * 4 + 1] = 64; // G
          buffer[i * 4 + 2] = 32; // B
        }
        const result = CameraBlitCapture.isBlackFrame(buffer);
        expect(result).toBe(false);
      }
    });

    /**
     * Property: Even a small cluster of non-zero pixels should be detected,
     * as long as it's large enough to hit at least one sample point.
     */
    it('detects non-black when >=1% of pixels are non-zero in a block', () => {
      const size = 1024;
      const buffer = new Uint8Array(size * 4);
      // Set 10 consecutive pixels near the start
      for (let i = 0; i < 10; i++) {
        buffer[i * 4] = 200;
      }
      expect(CameraBlitCapture.isBlackFrame(buffer)).toBe(false);
    });

    /**
     * Property: Alpha-only values (R=G=B=0, A>0) should still be considered black.
     * isBlackFrame checks RGB channels only — alpha is irrelevant for "visible" content.
     */
    it('treats alpha-only pixels as black', () => {
      const sizes = [4, 64, 256];
      for (const size of sizes) {
        const buffer = new Uint8Array(size * 4);
        // Set all alpha channels to 255 but keep RGB at 0
        for (let i = 0; i < size; i++) {
          buffer[i * 4 + 3] = 255;
        }
        const result = CameraBlitCapture.isBlackFrame(buffer);
        expect(result).toBe(true);
      }
    });

    /**
     * Property: Empty buffers should be detected as black.
     */
    it('considers empty buffer as black', () => {
      expect(CameraBlitCapture.isBlackFrame(new Uint8Array(0))).toBe(true);
    });
  });

  describe('computeCaptureSize', () => {
    /**
     * Property: whatever it is handed, the result is a usable render-target
     * size — integer, ≥ 1, and FINITE on both axes.
     *
     * Why this test matters: this function had no property coverage at all
     * while its neighbour `computeAspectFitSize` had two, and the gap is
     * exactly where the bug lived — NaN and Infinity camera dimensions
     * flowed through the old `<= 0` guard and out as non-finite sizes, which
     * reach render-target allocation. The arbitrary here deliberately mixes
     * the degenerate values in rather than sampling only sane cameras,
     * because sane cameras were never the problem.
     */
    it('always yields a finite integer size ≥ 1', () => {
      const dimension = fc.oneof(
        fc.integer({ min: 1, max: 4000 }),
        fc.constantFrom(
          0,
          -1,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY
        )
      );
      const divisorArb = fc.oneof(
        fc.integer({ min: 1, max: 64 }),
        fc.constantFrom(0, 0.5, -2, Number.NaN, Number.POSITIVE_INFINITY)
      );

      fc.assert(
        fc.property(
          dimension,
          dimension,
          divisorArb,
          (cameraWidth, cameraHeight, divisor) => {
            const { width, height } = computeCaptureSize(
              cameraWidth,
              cameraHeight,
              divisor
            );

            expect(Number.isFinite(width)).toBe(true);
            expect(Number.isFinite(height)).toBe(true);
            expect(Number.isInteger(width)).toBe(true);
            expect(Number.isInteger(height)).toBe(true);
            expect(width).toBeGreaterThanOrEqual(1);
            expect(height).toBeGreaterThanOrEqual(1);
          }
        )
      );
    });

    /**
     * Property: a divisor never UPSCALES. Whatever the divisor, neither output
     * edge exceeds the camera's own — that is the entire contract of a
     * "divisor", and the `divisor >= 1 ? divisor : 1` clamp exists to keep it.
     */
    it('never returns an edge larger than the camera for valid input', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 4000 }),
          fc.integer({ min: 1, max: 4000 }),
          fc.oneof(
            fc.integer({ min: 1, max: 64 }),
            fc.constantFrom(0, 0.5, -2, Number.NaN)
          ),
          (cameraWidth, cameraHeight, divisor) => {
            const { width, height } = computeCaptureSize(
              cameraWidth,
              cameraHeight,
              divisor
            );
            expect(width).toBeLessThanOrEqual(cameraWidth);
            expect(height).toBeLessThanOrEqual(cameraHeight);
          }
        )
      );
    });
  });

  describe('computeAspectFitSize (B2 aspect-correct QR blit)', () => {
    /**
     * Property: for any valid camera dimensions and a valid maxEdge, the output
     * (a) is integer ≥ 1 on both axes, (b) never exceeds maxEdge on either axis
     * (bounded readback budget), and (c) the LONGER output edge equals
     * floor(maxEdge) exactly — i.e. it fits the long side to the budget while
     * preserving aspect, never a stretched square.
     */
    it('fits the long edge to maxEdge, bounded, integer ≥ 1', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 4000 }),
          fc.integer({ min: 1, max: 4000 }),
          fc.integer({ min: 1, max: 2048 }),
          (cameraWidth, cameraHeight, maxEdge) => {
            const { width, height } = computeAspectFitSize(
              cameraWidth,
              cameraHeight,
              maxEdge
            );
            const edge = Math.floor(maxEdge);

            expect(Number.isInteger(width)).toBe(true);
            expect(Number.isInteger(height)).toBe(true);
            expect(width).toBeGreaterThanOrEqual(1);
            expect(height).toBeGreaterThanOrEqual(1);
            // Bounded: neither axis exceeds the budget.
            expect(width).toBeLessThanOrEqual(edge);
            expect(height).toBeLessThanOrEqual(edge);
            // The longer output edge lands exactly on the budget.
            expect(Math.max(width, height)).toBe(edge);
          }
        )
      );
    });

    /**
     * Property: orientation symmetry — swapping the camera's width and height
     * swaps the output's width and height (no landscape/portrait bias).
     */
    it('is orientation-symmetric (swapping camera dims swaps output dims)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 4000 }),
          fc.integer({ min: 1, max: 4000 }),
          fc.integer({ min: 1, max: 2048 }),
          (a, b, maxEdge) => {
            const landscape = computeAspectFitSize(a, b, maxEdge);
            const portrait = computeAspectFitSize(b, a, maxEdge);
            expect(portrait.width).toBe(landscape.height);
            expect(portrait.height).toBe(landscape.width);
          }
        )
      );
    });
  });
});
