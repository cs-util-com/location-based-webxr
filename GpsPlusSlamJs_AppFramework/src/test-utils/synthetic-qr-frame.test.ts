/**
 * Why these tests matter: the synthetic QR renderer is the ground truth for
 * every real-image QR test (the zxing oracle and the end-to-end pose tests).
 * A renderer bug would make those tests confirm the bug instead of catching
 * it, so the renderer is checked here against ANALYTIC geometry that does not
 * go through zxing or `qr-pose.ts`: where a frontal code's corners must land,
 * which pixels must be dark (finder-pattern centres) or light (separator,
 * quiet zone), and what lies outside the code.
 */

import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import {
  perspectiveProjection,
  qrPoseFacingCamera,
  renderQrFrame,
} from './synthetic-qr-frame';

const W = 640;
const H = 480;
const FOV_Y_DEG = 60;
const PROJECTION = perspectiveProjection({ fovYDeg: FOV_Y_DEG, aspect: W / H });
/** Focal length in pixels for the vertical FOV above (GL definition). */
const F_PX = H / 2 / Math.tan(((FOV_Y_DEG / 2) * Math.PI) / 180);

function grayAt(
  image: { data: Uint8ClampedArray; width: number },
  x: number,
  y: number
): number {
  const i = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return image.data[i] ?? Number.NaN;
}

describe('perspectiveProjection', () => {
  it('builds the column-major GL matrix with the principal-point offsets in slots 8 and 9', () => {
    const p = perspectiveProjection({
      fovYDeg: 90,
      aspect: 2,
      near: 0.1,
      far: 100,
      offsetX: 0.1,
      offsetY: -0.2,
    });
    expect(p).toHaveLength(16);
    expect(p[0]).toBeCloseTo(0.5, 12); // f / aspect, f = 1 at 90 deg
    expect(p[5]).toBeCloseTo(1, 12);
    expect(p[8]).toBe(0.1);
    expect(p[9]).toBe(-0.2);
    expect(p[11]).toBe(-1);
  });
});

describe('renderQrFrame', () => {
  it('places a frontal, upright code as an axis-aligned square of side f*size/d about the image centre', () => {
    const sizeM = 0.2;
    const distanceM = 1;
    const frame = renderQrFrame({
      text: 'https://example.com/a',
      sizeM,
      qrPoseInCamera: qrPoseFacingCamera({ distanceM }),
      projection: PROJECTION,
      width: W,
      height: H,
    });
    const half = (F_PX * sizeM) / distanceM / 2;
    const [tl, tr, br, bl] = frame.truthCorners;
    expect(tl.x).toBeCloseTo(W / 2 - half, 9);
    expect(tl.y).toBeCloseTo(H / 2 - half, 9);
    expect(tr.x).toBeCloseTo(W / 2 + half, 9);
    expect(tr.y).toBeCloseTo(H / 2 - half, 9);
    expect(br.x).toBeCloseTo(W / 2 + half, 9);
    expect(br.y).toBeCloseTo(H / 2 + half, 9);
    expect(bl.x).toBeCloseTo(W / 2 - half, 9);
    expect(bl.y).toBeCloseTo(H / 2 + half, 9);
    expect(frame.modulePx).toBeCloseTo((2 * half) / frame.moduleCount, 9);
  });

  it('paints finder-pattern centres dark, the separator light, the quiet zone light and the rest background', () => {
    const text = 'finder-check';
    const frame = renderQrFrame({
      text,
      sizeM: 0.3,
      qrPoseInCamera: qrPoseFacingCamera({ distanceM: 0.8 }),
      projection: PROJECTION,
      width: W,
      height: H,
      supersample: 1,
    });
    const n = QRCode.create(text, { errorCorrectionLevel: 'Q' }).modules.size;
    expect(frame.moduleCount).toBe(n);
    const [tl] = frame.truthCorners;
    const m = frame.modulePx;
    const at = (col: number, row: number): number =>
      grayAt(frame.image, tl.x + col * m, tl.y + row * m);

    // Centre module of each finder pattern (module 3,3 from its outer corner).
    expect(at(3.5, 3.5)).toBeLessThan(64); // top-left finder
    expect(at(n - 3.5, 3.5)).toBeLessThan(64); // top-right finder
    expect(at(3.5, n - 3.5)).toBeLessThan(64); // bottom-left finder
    // The separator ring (module 7) around the top-left finder is light.
    expect(at(7.5, 3.5)).toBeGreaterThan(192);
    // Quiet zone just outside the symbol edge is light.
    expect(at(-0.5 * frame.quietZoneModules, n / 2)).toBeGreaterThan(192);
    // Image corner is far outside the code: background grey.
    expect(grayAt(frame.image, 2, 2)).toBe(128);
  });

  it('reports the rolled corners in symbol order, rotating the TL corner around the centre', () => {
    const frame = renderQrFrame({
      text: 'roll',
      sizeM: 0.2,
      qrPoseInCamera: qrPoseFacingCamera({ distanceM: 1, rollDeg: 90 }),
      projection: PROJECTION,
      width: W,
      height: H,
    });
    const half = (F_PX * 0.2) / 1 / 2;
    // Rolling the code +90 deg about its own normal (counter-clockwise as seen
    // by the camera) moves the symbol's TL corner to the image's bottom-left.
    const [tl] = frame.truthCorners;
    expect(tl.x).toBeCloseTo(W / 2 - half, 6);
    expect(tl.y).toBeCloseTo(H / 2 + half, 6);
  });

  it('is deterministic for a seed, and noise changes the pixels', () => {
    const base = {
      text: 'seeded',
      sizeM: 0.2,
      qrPoseInCamera: qrPoseFacingCamera({ distanceM: 1 }),
      projection: PROJECTION,
      width: 160,
      height: 120,
      noiseSigma: 6,
    };
    const a = renderQrFrame({ ...base, seed: 7 });
    const b = renderQrFrame({ ...base, seed: 7 });
    const c = renderQrFrame({ ...base, seed: 8 });
    expect(a.image.data).toEqual(b.image.data);
    expect(a.image.data).not.toEqual(c.image.data);
  });

  it('returns an owned RGBA buffer of exactly width x height x 4 with opaque alpha', () => {
    const frame = renderQrFrame({
      text: 'shape',
      sizeM: 0.2,
      qrPoseInCamera: qrPoseFacingCamera({ distanceM: 1 }),
      projection: PROJECTION,
      width: 100,
      height: 50,
    });
    expect(frame.image.data).toHaveLength(100 * 50 * 4);
    expect(frame.image.data[3]).toBe(255);
  });

  it('rejects invalid sizes and a code placed behind the camera', () => {
    const common = {
      text: 'bad',
      projection: PROJECTION,
      width: W,
      height: H,
    };
    expect(() =>
      renderQrFrame({
        ...common,
        sizeM: 0,
        qrPoseInCamera: qrPoseFacingCamera({ distanceM: 1 }),
      })
    ).toThrow(RangeError);
    expect(() =>
      renderQrFrame({
        ...common,
        sizeM: 0.2,
        width: 0,
        qrPoseInCamera: qrPoseFacingCamera({ distanceM: 1 }),
      })
    ).toThrow(RangeError);
    expect(() =>
      renderQrFrame({
        ...common,
        sizeM: 0.2,
        qrPoseInCamera: { position: [0, 0, 1], rotation: [0, 0, 0, 1] },
      })
    ).toThrow(RangeError);
  });
});
