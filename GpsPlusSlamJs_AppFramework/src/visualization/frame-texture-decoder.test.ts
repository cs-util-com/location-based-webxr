/**
 * Tests for `decodeFrameTexture` — F3.5b.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeFrameTexture } from './frame-texture-decoder';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('decodeFrameTexture', () => {
  // Why: a healthy JPEG blob must yield a THREE.Texture whose source
  // image is the decoded ImageBitmap and that has `needsUpdate = true`.
  it('returns a THREE.Texture wrapping the decoded ImageBitmap', async () => {
    const fakeBitmap = {
      width: 4,
      height: 4,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(fakeBitmap));

    const blob = new Blob(['fake'], { type: 'image/jpeg' });
    const texture = await decodeFrameTexture(blob);

    expect(texture).not.toBeNull();
    expect(texture).toBeInstanceOf(THREE.Texture);
    expect(texture?.image).toBe(fakeBitmap);
    // `needsUpdate` is a write-only setter on THREE.Texture that bumps
    // `version`; verify the setter fired by checking `version > 0`.
    expect((texture?.version ?? 0) > 0).toBe(true);
  });

  // Why (D2 fix — 2026-06-13 upside-down report): an `ImageBitmap` wrapped in a
  // `THREE.Texture` renders VERTICALLY FLIPPED because three.js cannot apply the
  // WebGL `UNPACK_FLIP_Y_WEBGL` flip to an `ImageBitmap` source on upload. The
  // documented remedy is to flip at decode by asking the browser for a
  // pre-flipped bitmap: `createImageBitmap(blob, { imageOrientation: 'flipY' })`.
  // The geometry path is proven upright (see the D2 elimination test in
  // frame-tile-visualizer.test.ts), so this decode-time flip is the correct and
  // sufficient fix. We assert the OPTION is passed (the only thing observable in
  // headless jsdom — the GPU flip itself cannot be rasterised here).
  it('requests a vertically pre-flipped bitmap (imageOrientation: flipY) to fix the upside-down upload', async () => {
    const fakeBitmap = {
      width: 4,
      height: 4,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createImageBitmapSpy = vi.fn().mockResolvedValue(fakeBitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapSpy);

    const blob = new Blob(['fake'], { type: 'image/jpeg' });
    await decodeFrameTexture(blob);

    expect(createImageBitmapSpy).toHaveBeenCalledWith(
      blob,
      expect.objectContaining({ imageOrientation: 'flipY' })
    );
  });

  // Why (D7-resolution, 2026-06-16 user feedback): a divisor > 1 must
  // re-sample the decoded bitmap to 1/divisor of each dimension before building
  // the texture, cutting per-tile GPU memory. We assert the resize createImage-
  // Bitmap call targets width/height = source / divisor, that the full-res
  // bitmap is closed (memory freed), and that the texture wraps the RESIZED
  // bitmap — not the full one.
  it('downscales the display texture by the divisor (resizeWidth/Height = source / divisor)', async () => {
    const fullBitmap = {
      width: 800,
      height: 600,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const resizedBitmap = {
      width: 400,
      height: 300,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createImageBitmapSpy = vi
      .fn()
      .mockResolvedValueOnce(fullBitmap) // first decode (flipY)
      .mockResolvedValueOnce(resizedBitmap); // resize pass
    vi.stubGlobal('createImageBitmap', createImageBitmapSpy);

    const blob = new Blob(['fake'], { type: 'image/jpeg' });
    const texture = await decodeFrameTexture(blob, 2);

    // Second call resizes the already-upright bitmap to half each dimension,
    // WITHOUT re-applying imageOrientation (that would re-flip it).
    expect(createImageBitmapSpy).toHaveBeenNthCalledWith(
      2,
      fullBitmap,
      expect.objectContaining({ resizeWidth: 400, resizeHeight: 300 })
    );
    const secondCallOpts = createImageBitmapSpy.mock.calls[1]?.[1] as Record<
      string,
      unknown
    >;
    expect(secondCallOpts).not.toHaveProperty('imageOrientation');
    // The full-res bitmap is freed once the resized copy exists.
    expect(
      (fullBitmap as unknown as { close: ReturnType<typeof vi.fn> }).close
    ).toHaveBeenCalled();
    expect(texture?.image).toBe(resizedBitmap);
  });

  // Why: divisor 1 (full resolution) must NOT trigger a second resize pass — the
  // texture wraps the originally decoded bitmap directly.
  it('does not re-sample when divisor is 1 (full resolution)', async () => {
    const fullBitmap = {
      width: 800,
      height: 600,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createImageBitmapSpy = vi.fn().mockResolvedValue(fullBitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapSpy);

    const blob = new Blob(['fake'], { type: 'image/jpeg' });
    const texture = await decodeFrameTexture(blob, 1);

    expect(createImageBitmapSpy).toHaveBeenCalledTimes(1);
    expect(texture?.image).toBe(fullBitmap);
  });

  // Why: a corrupt blob (createImageBitmap rejects) must surface as
  // `null` so the wirer can drop the frame without unhandled errors.
  it('returns null when createImageBitmap rejects', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('decode failure'))
    );

    const blob = new Blob(['bad'], { type: 'image/jpeg' });
    const texture = await decodeFrameTexture(blob);

    expect(texture).toBeNull();
  });

  // Why: environments lacking `createImageBitmap` (older test runners,
  // unusual SSR contexts) must fail soft rather than throw.
  it('returns null when createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined);

    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const texture = await decodeFrameTexture(blob);

    expect(texture).toBeNull();
  });
});

/** A PNG signature plus IHDR stating `width` x `height` (no pixels). */
function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

describe('decodeFrameTexture - the pixel cap (tour kit K4 review R2)', () => {
  // Why: the decoder decodes at the size the file states, so a crafted
  // header makes it allocate gigabytes before any resize. With a cap it
  // reads the header first and never decodes what is over it, or what
  // it cannot measure.
  it('never decodes an image over the cap, or one whose size it cannot read', async () => {
    const decode = vi.fn().mockResolvedValue({
      width: 4,
      height: 4,
      close: vi.fn(),
    });
    vi.stubGlobal('createImageBitmap', decode);
    const cap = { maxPixels: 4096 * 4096 };
    expect(
      await decodeFrameTexture(new Blob([pngHeader(8192, 8192)]), 1, cap)
    ).toBeNull();
    expect(
      await decodeFrameTexture(new Blob(['not an image']), 1, cap)
    ).toBeNull();
    expect(decode).not.toHaveBeenCalled();
    expect(
      await decodeFrameTexture(new Blob([pngHeader(2048, 2048)]), 1, cap)
    ).not.toBeNull();
    expect(decode).toHaveBeenCalledTimes(1);
  });
});
