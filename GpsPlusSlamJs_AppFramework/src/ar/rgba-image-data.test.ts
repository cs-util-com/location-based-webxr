/**
 * Why these tests matter: `ImageData` refuses a view over shared memory, and
 * the capture path hands out plain-ArrayBuffer-backed frames that are already
 * owned copies. One rule decides "adopt or copy" for every place that wraps a
 * frame (the JPEG encoder and the QR front end, DEC-H3); a regression either
 * reintroduces a full-frame copy per call or makes ImageData throw. Node has
 * no ImageData, so a stub records which array it was given.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { rgbaToImageData } from './rgba-image-data';

class ImageDataStub {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number
  ) {}
}

describe('rgbaToImageData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adopts a plain-ArrayBuffer-backed array without copying', () => {
    vi.stubGlobal('ImageData', ImageDataStub);
    const data = new Uint8ClampedArray(2 * 2 * 4);
    const out = rgbaToImageData({
      data,
      width: 2,
      height: 2,
    }) as unknown as ImageDataStub;
    expect(out.data).toBe(data);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
  });

  it('copies a shared-memory view into a plain buffer', () => {
    vi.stubGlobal('ImageData', ImageDataStub);
    const data = new Uint8ClampedArray(new SharedArrayBuffer(2 * 2 * 4));
    data[5] = 77;
    const out = rgbaToImageData({
      data,
      width: 2,
      height: 2,
    }) as unknown as ImageDataStub;
    expect(out.data).not.toBe(data);
    expect(out.data.buffer).toBeInstanceOf(ArrayBuffer);
    expect(out.data[5]).toBe(77);
  });
});
