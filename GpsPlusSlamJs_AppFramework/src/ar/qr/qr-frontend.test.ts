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
import {
  perspectiveProjection,
  qrPoseFacingCamera,
  renderQrFrame,
} from '../../test-utils/synthetic-qr-frame';

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
    // No finder patterns in this image: the detector's own order.
    expect(det!.orderSource).toBe('native');
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

/**
 * Why these tests matter (QR perf plan 2026-09-23, M3): the frame handed to
 * `detect` is already an owned buffer (`captureToRgba` returns a fresh copy),
 * so wrapping it in `ImageData` must not copy ~3 MB a second time. Node has no
 * `ImageData`, so a stub stands in: these tests prove the SAME array is handed
 * over (not the browser's adopt-without-copy behaviour, which the platform
 * guarantees for a plain-ArrayBuffer-backed array of the right length).
 */
describe('default ImageData conversion', () => {
  class ImageDataStub {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number
    ) {}
  }

  function capturingDetector() {
    const seen: unknown[] = [];
    const detector = {
      detect: (source: unknown) => {
        seen.push(source);
        return Promise.resolve([]);
      },
    };
    return { detector, seen };
  }

  it('hands the owned pixel buffer over without copying it', async () => {
    vi.stubGlobal('ImageData', ImageDataStub);
    try {
      const { detector, seen } = capturingDetector();
      const image = {
        data: new Uint8ClampedArray(2 * 2 * 4),
        width: 2,
        height: 2,
      };
      await new BarcodeDetectorFrontEnd(detector).detect(image);
      expect((seen[0] as ImageDataStub).data).toBe(image.data);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('copies a buffer that ImageData cannot adopt (shared memory)', async () => {
    vi.stubGlobal('ImageData', ImageDataStub);
    try {
      const { detector, seen } = capturingDetector();
      const image = {
        data: new Uint8ClampedArray(new SharedArrayBuffer(2 * 2 * 4)),
        width: 2,
        height: 2,
      };
      await new BarcodeDetectorFrontEnd(detector).detect(image);
      const handed = (seen[0] as ImageDataStub).data;
      expect(handed).not.toBe(image.data);
      expect(handed.buffer).toBeInstanceOf(ArrayBuffer);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * Why this test matters: the QR demo's `?qrperf=1&baseline=1` A/B run builds
 * its pre-fix (copying, timed) front end through this factory rather than
 * re-implementing the BarcodeDetector lookup (DEC-H3), so the override must
 * actually reach the detector.
 */
describe('createBarcodeDetectorFrontEnd toSource override', () => {
  it('passes each frame through the given conversion', async () => {
    const seen: unknown[] = [];
    const ctor = class {
      detect(source: unknown) {
        seen.push(source);
        return Promise.resolve([]);
      }
    };
    const marker = { converted: true };
    const fe = createBarcodeDetectorFrontEnd(ctor, () => marker);
    await fe!.detect(image);
    expect(seen).toEqual([marker]);
  });
});

describe('corner order (QR near-frontal pose plan 2026-09-23-2314, M1c)', () => {
  // Why this test matters: the owner's phone reports corners in IMAGE order,
  // which turned every solved pose by 90 or 180 deg (QR summary §4b runs
  // 3-6). The front end is the one path every app's detections take, so it
  // must hand out corners in SYMBOL order (TL, TR, BR, BL).
  it('hands out symbol-ordered corners when the detector reports image order', async () => {
    const f = renderQrFrame({
      text: 'https://example.com/level/7',
      sizeM: 0.16,
      qrPoseInCamera: qrPoseFacingCamera({ distanceM: 0.45, rollDeg: 200 }),
      projection: perspectiveProjection({ fovYDeg: 50, aspect: 1024 / 768 }),
      width: 1024,
      height: 768,
      supersample: 2,
    });
    const truth = f.truthCorners.map((p) => ({
      x: Math.round(p.x),
      y: Math.round(p.y),
    }));
    // Image order: start at the top-left-most corner, as the phone does.
    let start = 0;
    truth.forEach((p, i) => {
      if (p.x + p.y < truth[start]!.x + truth[start]!.y) start = i;
    });
    const reported = [0, 1, 2, 3].map((k) => truth[(start + k) % 4]!);
    expect(start).not.toBe(0); // the scenario really is out of symbol order
    const frontEnd = new BarcodeDetectorFrontEnd(
      {
        detect: () =>
          Promise.resolve([
            { rawValue: 'https://example.com/level/7', cornerPoints: reported },
          ]),
      },
      (img: RgbaImage) => img
    );
    const hit = await frontEnd.detect(f.image);
    expect(hit?.corners).toEqual(truth);
    // Plan §39 F0a: the detection says where its order came from.
    expect(hit?.orderSource).toBe('finder');
    // Plan §42 S4: a second finder frame of the same code is audited
    // against the chain the first one started.
    const again = await frontEnd.detect(f.image);
    expect(again?.orderAudit).toBe('agree');
  });
});
