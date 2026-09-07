/**
 * QR detection front-ends — unit tests.
 *
 * Why this test matters: the BarcodeDetector front-end must emit a uniform
 * {@link QrDetection} (4 finite corner pixels + non-empty text), reject
 * malformed detector output, and the factory must degrade to `null` when no
 * `BarcodeDetector` exists. The native detector is injected so no DOM is needed.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  BarcodeDetectorFrontEnd,
  createBarcodeDetectorFrontEnd,
  type RgbaImage,
  type DetectedBarcodeLike,
} from './qr-frontend';

const image: RgbaImage = {
  data: new Uint8ClampedArray(2 * 2 * 4),
  width: 2,
  height: 2,
};

const fourCorners = [
  { x: 10, y: 10 },
  { x: 90, y: 12 },
  { x: 88, y: 92 },
  { x: 11, y: 90 },
];

describe('BarcodeDetectorFrontEnd', () => {
  const passthrough = (img: RgbaImage) => img; // avoid needing DOM ImageData

  it('returns the first decoded QR with its 4 corners and text', async () => {
    const detector = {
      detect: vi.fn((): Promise<DetectedBarcodeLike[]> =>
        Promise.resolve([
          {
            rawValue: 'https://lvl/1',
            cornerPoints: fourCorners,
            format: 'qr_code',
          },
        ])
      ),
    };
    const fe = new BarcodeDetectorFrontEnd(detector, passthrough);
    const det = await fe.detect(image);
    expect(det).not.toBeNull();
    expect(det!.text).toBe('https://lvl/1');
    expect(det!.corners).toHaveLength(4);
    expect(det!.corners[1]).toEqual({ x: 90, y: 12 });
    expect(detector.detect).toHaveBeenCalledWith(image);
  });

  it('returns null when nothing is detected', async () => {
    const fe = new BarcodeDetectorFrontEnd(
      { detect: () => Promise.resolve([]) },
      passthrough
    );
    expect(await fe.detect(image)).toBeNull();
  });

  it('skips results with the wrong corner count or empty text', async () => {
    const fe = new BarcodeDetectorFrontEnd(
      {
        detect: () =>
          Promise.resolve([
            { rawValue: '', cornerPoints: fourCorners },
            { rawValue: 'x', cornerPoints: fourCorners.slice(0, 3) },
          ]),
      },
      passthrough
    );
    expect(await fe.detect(image)).toBeNull();
  });
});

describe('createBarcodeDetectorFrontEnd', () => {
  it('returns null when no BarcodeDetector constructor exists', () => {
    expect(createBarcodeDetectorFrontEnd(undefined)).toBeNull();
  });

  it('constructs a front-end with the qr_code format when a ctor is provided', () => {
    let capturedOpts: { formats: string[] } | undefined;
    class FakeBarcodeDetector {
      constructor(opts: { formats: string[] }) {
        capturedOpts = opts;
      }
      detect() {
        return Promise.resolve([]);
      }
    }
    const fe = createBarcodeDetectorFrontEnd(FakeBarcodeDetector);
    expect(fe).not.toBeNull();
    expect(capturedOpts).toEqual({ formats: ['qr_code'] });
  });
});
