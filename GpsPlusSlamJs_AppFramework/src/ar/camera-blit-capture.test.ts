/**
 * Tests for camera-blit-capture module
 *
 * Why these tests matter:
 * - The blit technique is the fix for black frames when reading WebXR opaque textures
 * - The GPU pipeline (render target → blit scene → readPixels → blob) must work correctly
 * - Resource lifecycle (creation, disposal) must be verified to avoid GPU memory leaks
 * - The conversion from raw pixel data to JPEG blob is critical for image storage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CameraBlitCapture,
  DEFAULT_BLIT_CONFIG,
  computeCaptureSize,
  computeAspectFitSize,
  type CameraBlitCaptureConfig,
} from './camera-blit-capture';

let originalOffscreenCanvas: typeof globalThis.OffscreenCanvas | undefined;

// --- Three.js mock types (minimal for testing) ---

/** Minimal mock for THREE.Texture (camera texture from WebXR) */
function createMockTexture() {
  return { isTexture: true };
}

/**
 * Minimal mock for THREE.WebGLRenderer.
 * Simulates the render pipeline: setRenderTarget → render → readRenderTargetPixels.
 */
function createMockRenderer(options?: {
  /** If true, readRenderTargetPixels fills buffer with non-zero data */
  hasPixelData?: boolean;
  /** Custom pixel fill value (0-255) */
  pixelFillValue?: number;
}) {
  const opts = { hasPixelData: true, pixelFillValue: 128, ...options };
  return {
    xr: {
      enabled: true,
    },
    getRenderTarget: vi.fn().mockReturnValue(null),
    setRenderTarget: vi.fn(),
    render: vi.fn(),
    readRenderTargetPixels: vi.fn(
      (
        _rt: unknown,
        _x: number,
        _y: number,
        width: number,
        height: number,
        buffer: Uint8Array
      ) => {
        if (opts.hasPixelData) {
          // Fill buffer with non-zero data to simulate real camera pixels
          for (let i = 0; i < width * height * 4; i++) {
            buffer[i] = opts.pixelFillValue;
          }
        }
        // else: buffer stays all-zeros (simulates black frame)
      }
    ),
  };
}

describe('camera-blit-capture', () => {
  describe('DEFAULT_BLIT_CONFIG', () => {
    /**
     * Why this test matters:
     * Default resolution must be reasonable for mobile performance.
     * Too high = GPU stall from readPixels; too low = useless images.
     */
    it('has reasonable default dimensions', () => {
      expect(DEFAULT_BLIT_CONFIG.width).toBeGreaterThanOrEqual(256);
      expect(DEFAULT_BLIT_CONFIG.width).toBeLessThanOrEqual(1920);
      expect(DEFAULT_BLIT_CONFIG.height).toBeGreaterThanOrEqual(256);
      expect(DEFAULT_BLIT_CONFIG.height).toBeLessThanOrEqual(1920);
    });
  });

  describe('CameraBlitCapture', () => {
    let blitCapture: CameraBlitCapture;
    let mockRenderer: ReturnType<typeof createMockRenderer>;
    let mockTexture: ReturnType<typeof createMockTexture>;

    beforeEach(() => {
      mockRenderer = createMockRenderer();
      mockTexture = createMockTexture();

      // Mock ImageData and OffscreenCanvas in node test environment.
      originalOffscreenCanvas = globalThis.OffscreenCanvas;

      if (typeof globalThis.ImageData === 'undefined') {
        // Minimal ImageData mock for node
        (globalThis as Record<string, unknown>).ImageData =
          class MockImageData {
            data: Uint8ClampedArray;
            width: number;
            height: number;
            constructor(
              data: Uint8ClampedArray,
              width: number,
              height: number
            ) {
              this.data = data;
              this.width = width;
              this.height = height;
            }
          };
      }

      globalThis.OffscreenCanvas = class MockOffscreenCanvas {
        width: number;
        height: number;
        constructor(w: number, h: number) {
          this.width = w;
          this.height = h;
        }
        getContext() {
          return { putImageData: vi.fn() };
        }
        convertToBlob() {
          return Promise.resolve(
            new Blob(['fake jpeg data'], { type: 'image/jpeg' })
          );
        }
      } as unknown as typeof OffscreenCanvas;
    });

    afterEach(() => {
      // Restore original OffscreenCanvas
      if (originalOffscreenCanvas !== undefined) {
        globalThis.OffscreenCanvas = originalOffscreenCanvas;
      } else {
        delete (globalThis as Record<string, unknown>).OffscreenCanvas;
      }
    });

    describe('construction', () => {
      /**
       * Why this test matters:
       * Construction must succeed and allocate GPU resources (render target,
       * blit scene, material). If construction fails, the entire capture
       * pipeline is broken.
       */
      it('creates instance with default config', () => {
        blitCapture = new CameraBlitCapture();
        expect(blitCapture).toBeDefined();
      });

      it('creates instance with custom config', () => {
        const config: CameraBlitCaptureConfig = { width: 256, height: 256 };
        blitCapture = new CameraBlitCapture(config);
        expect(blitCapture).toBeDefined();
      });
    });

    describe('captureToBlob', () => {
      beforeEach(() => {
        blitCapture = new CameraBlitCapture({ width: 64, height: 64 });
      });

      /**
       * Why this test matters:
       * The core blit pipeline must produce a non-null JPEG Blob when the
       * renderer provides valid pixel data. This verifies the entire chain:
       * set texture → render to RT → readPixels → encode to JPEG.
       */
      it('returns a JPEG blob when renderer provides pixel data', async () => {
        const blob = await blitCapture.captureToBlob(
          mockRenderer as never,
          mockTexture as never,
          0.7
        );

        expect(blob).not.toBeNull();
        expect(blob).toBeInstanceOf(Blob);
        expect(blob!.type).toBe('image/jpeg');
      });

      /**
       * Why this test matters:
       * The blit must temporarily disable XR and set the custom render target,
       * then restore the original state. If not restored, the main render
       * loop breaks.
       */
      it('temporarily disables XR and restores state after capture', async () => {
        await blitCapture.captureToBlob(
          mockRenderer as never,
          mockTexture as never,
          0.7
        );

        // Should have saved and restored XR enabled state
        expect(mockRenderer.xr.enabled).toBe(true);

        // Should have set render target to our RT, then restored to original
        expect(mockRenderer.setRenderTarget).toHaveBeenCalledTimes(2);
        // First call: set our render target
        expect(mockRenderer.setRenderTarget.mock.calls[0]?.[0]).not.toBeNull();
        // Second call: restore original (null)
        expect(mockRenderer.setRenderTarget.mock.calls[1]?.[0]).toBeNull();
      });

      /**
       * Why this test matters:
       * The blit scene must actually be rendered to convert the opaque texture
       * to a standard one. Without this render call, readPixels returns zeros.
       */
      it('renders the blit scene to the render target', async () => {
        await blitCapture.captureToBlob(
          mockRenderer as never,
          mockTexture as never,
          0.7
        );

        expect(mockRenderer.render).toHaveBeenCalledTimes(1);
      });

      /**
       * Why this test matters:
       * readRenderTargetPixels must be called with the correct render target
       * and dimensions to get actual pixel data.
       */
      it('reads pixels from the render target', async () => {
        await blitCapture.captureToBlob(
          mockRenderer as never,
          mockTexture as never,
          0.7
        );

        expect(mockRenderer.readRenderTargetPixels).toHaveBeenCalledTimes(1);
        const callArgs = mockRenderer.readRenderTargetPixels.mock.calls[0];
        // Args: renderTarget, x, y, width, height, buffer
        expect(callArgs[1]).toBe(0); // x
        expect(callArgs[2]).toBe(0); // y
        expect(callArgs[3]).toBe(64); // width
        expect(callArgs[4]).toBe(64); // height
        expect(callArgs[5]).toBeInstanceOf(Uint8Array); // buffer
      });

      /**
       * Why this test matters:
       * When readPixels returns all zeros (black), the blob might still be
       * created (JPEG headers exist). We should still return it since
       * ImageCaptureManager handles suspicious image detection.
       */
      it('returns a blob even when pixels are all black', async () => {
        const blackRenderer = createMockRenderer({ hasPixelData: false });
        const blob = await blitCapture.captureToBlob(
          blackRenderer as never,
          mockTexture as never,
          0.7
        );

        // Blob is still created (JPEG encoding of black pixels)
        expect(blob).not.toBeNull();
      });
    });

    describe('captureToPixels', () => {
      beforeEach(() => {
        blitCapture = new CameraBlitCapture({ width: 8, height: 4 });
      });

      /**
       * Why this test matters (occupancy-grid port plan Iter 8):
       * The RGB voxel-coloring path needs the raw readback buffer without
       * the JPEG encode. captureToPixels must run the same blit pipeline
       * (set texture → render to RT → readPixels) and hand back the buffer
       * with its dimensions so `createRgbLookup` can address it.
       */
      it('returns the readback buffer with its dimensions', () => {
        const result = blitCapture.captureToPixels(
          mockRenderer as never,
          mockTexture as never
        );

        expect(result).not.toBeNull();
        expect(result!.width).toBe(8);
        expect(result!.height).toBe(4);
        expect(result!.pixels).toBeInstanceOf(Uint8Array);
        expect(result!.pixels.length).toBe(8 * 4 * 4);
        // Mock renderer fills with 128
        expect(result!.pixels[0]).toBe(128);
        expect(mockRenderer.render).toHaveBeenCalledTimes(1);
      });

      /**
       * Why this test matters:
       * Like captureToBlob, the pixel path must restore the renderer state
       * (render target + xr.enabled) or the main XR render loop breaks.
       */
      it('restores renderer state after the blit', () => {
        blitCapture.captureToPixels(
          mockRenderer as never,
          mockTexture as never
        );

        expect(mockRenderer.xr.enabled).toBe(true);
        expect(mockRenderer.setRenderTarget).toHaveBeenCalledTimes(2);
        expect(mockRenderer.setRenderTarget.mock.calls[1]?.[0]).toBeNull();
      });

      /**
       * Why this test matters:
       * The capture path is best-effort — a renderer failure must yield
       * null (point stays color-less), never an exception into the XR frame
       * loop.
       */
      it('returns null when the renderer throws', () => {
        mockRenderer.render.mockImplementationOnce(() => {
          throw new Error('GL context lost');
        });
        const result = blitCapture.captureToPixels(
          mockRenderer as never,
          mockTexture as never
        );
        expect(result).toBeNull();
      });

      it('returns null after dispose', () => {
        blitCapture.dispose();
        const result = blitCapture.captureToPixels(
          mockRenderer as never,
          mockTexture as never
        );
        expect(result).toBeNull();
      });
    });

    describe('captureToRgba', () => {
      /**
       * Why this test matters (B2 / QR detection):
       * QR detection needs top-left-origin RGBA without the lossy JPEG
       * round-trip. captureToRgba must run the blit, then apply the SAME
       * vertical flip the JPEG encoder uses (readPixels is bottom-row-first),
       * and return an OWNED copy (not the internal y-flipped buffer).
       */
      it('returns a flipped (top-left) owned RGBA copy', () => {
        const renderer = createMockRenderer();
        renderer.readRenderTargetPixels.mockImplementation(
          (
            _rt: unknown,
            _x: number,
            _y: number,
            _w: number,
            _h: number,
            buffer: Uint8Array
          ) => {
            // 2×2, bottom-row-first:
            //  row0(bottom): [10,20,30,255, 40,50,60,255]
            //  row1(top):    [70,80,90,255, 100,110,120,255]
            buffer.set([
              10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120,
              255,
            ]);
          }
        );

        blitCapture = new CameraBlitCapture({ width: 2, height: 2 });
        const rgba = blitCapture.captureToRgba(
          renderer as never,
          mockTexture as never
        );

        expect(rgba).not.toBeNull();
        expect(rgba!.width).toBe(2);
        expect(rgba!.height).toBe(2);
        expect(rgba!.data).toBeInstanceOf(Uint8ClampedArray);
        // Flipped: new row0 = old top row, new row1 = old bottom row.
        expect(Array.from(rgba!.data)).toEqual([
          70, 80, 90, 255, 100, 110, 120, 255, 10, 20, 30, 255, 40, 50, 60, 255,
        ]);
      });

      it('returns null after dispose', () => {
        blitCapture = new CameraBlitCapture({ width: 4, height: 4 });
        blitCapture.dispose();
        expect(
          blitCapture.captureToRgba(mockRenderer as never, mockTexture as never)
        ).toBeNull();
      });

      it('returns an independent copy that survives the next capture', () => {
        blitCapture = new CameraBlitCapture({ width: 2, height: 2 });
        const first = blitCapture.captureToRgba(
          mockRenderer as never,
          mockTexture as never
        );
        expect(first).not.toBeNull();
        const snapshot = Array.from(first!.data);
        // A second capture must not mutate the first result's buffer.
        blitCapture.captureToRgba(mockRenderer as never, mockTexture as never);
        expect(Array.from(first!.data)).toEqual(snapshot);
      });
    });

    describe('isBlack helper', () => {
      beforeEach(() => {
        blitCapture = new CameraBlitCapture({ width: 4, height: 4 });
      });

      /**
       * Why this test matters:
       * After a blit + readPixels, we need a fast way to check if the result
       * is still all-zero (meaning the blit didn't help). This helps
       * differentiate "blit worked but scene is dark" from "opaque texture
       * still not readable".
       */
      it('detects all-black pixel buffer', () => {
        const blackPixels = new Uint8Array(4 * 4 * 4); // all zeros
        expect(CameraBlitCapture.isBlackFrame(blackPixels)).toBe(true);
      });

      it('returns false for non-black pixel buffer', () => {
        const pixels = new Uint8Array(4 * 4 * 4);
        pixels[0] = 128;
        expect(CameraBlitCapture.isBlackFrame(pixels)).toBe(false);
      });

      it('returns false for mostly-black buffer with some color', () => {
        const pixels = new Uint8Array(4 * 4 * 4);
        // Set a few non-zero values scattered in the buffer
        pixels[40] = 50;
        pixels[41] = 100;
        expect(CameraBlitCapture.isBlackFrame(pixels)).toBe(false);
      });
    });

    describe('captureToBlob after dispose', () => {
      /**
       * Why this test matters:
       * Once disposed, captureToBlob must return null immediately
       * rather than accessing freed GPU resources.
       */
      it('returns null when called after dispose', async () => {
        blitCapture = new CameraBlitCapture({ width: 64, height: 64 });
        blitCapture.dispose();

        const blob = await blitCapture.captureToBlob(
          mockRenderer as never,
          mockTexture as never,
          0.7
        );

        expect(blob).toBeNull();
        // Should NOT have attempted any rendering
        expect(mockRenderer.render).not.toHaveBeenCalled();
      });
    });

    describe('canvas fallback path', () => {
      /**
       * Why this test matters:
       * Some environments (older browsers, some workers) lack OffscreenCanvas.
       * The fallback via document.createElement('canvas') must produce a blob.
       */
      it('falls back to regular canvas when OffscreenCanvas is unavailable', async () => {
        // Remove OffscreenCanvas to force the fallback path
        delete (globalThis as Record<string, unknown>).OffscreenCanvas;

        // Mock document.createElement to return a canvas-like object
        const mockToBlob = vi.fn(
          (cb: BlobCallback, _type?: string, _quality?: number) => {
            cb(new Blob(['fallback jpeg'], { type: 'image/jpeg' }));
          }
        );
        const fakeDocument = {
          createElement: vi.fn((tag: string) => {
            if (tag === 'canvas') {
              return {
                width: 0,
                height: 0,
                getContext: () => ({ putImageData: vi.fn() }),
                toBlob: mockToBlob,
              };
            }
            return {};
          }),
        };
        (globalThis as Record<string, unknown>).document = fakeDocument;

        blitCapture = new CameraBlitCapture({ width: 64, height: 64 });
        const blob = await blitCapture.captureToBlob(
          mockRenderer as never,
          mockTexture as never,
          0.7
        );

        expect(blob).not.toBeNull();
        expect(blob!.type).toBe('image/jpeg');
        expect(mockToBlob).toHaveBeenCalledTimes(1);

        // Clean up
        delete (globalThis as Record<string, unknown>).document;
      });
    });

    describe('pixel buffer isolation', () => {
      /**
       * Why this test matters:
       * getFlippedImageData must create a copy of pixelBuffer so the
       * internal buffer remains y-flipped (bottom-row-first). If it
       * mutated the original, a second capture would double-flip and
       * produce inverted images.
       */
      it('captureToBlob does not mutate internal pixel buffer between calls', async () => {
        blitCapture = new CameraBlitCapture({ width: 4, height: 4 });

        // First capture — fills buffer via readRenderTargetPixels mock
        const blob1 = await blitCapture.captureToBlob(
          mockRenderer as never,
          mockTexture as never,
          0.7
        );
        expect(blob1).not.toBeNull();

        // Second capture should also succeed (buffer not corrupted by flip)
        const blob2 = await blitCapture.captureToBlob(
          mockRenderer as never,
          mockTexture as never,
          0.7
        );
        expect(blob2).not.toBeNull();
      });
    });

    describe('flipImageDataVertically', () => {
      /**
       * Why this test matters:
       * WebGL readPixels returns bottom-row-first data. If rows aren't
       * swapped correctly the JPEG is vertically mirrored, which is a
       * subtle visual bug that's easy to miss.
       */
      it('correctly swaps rows for even-height image', async () => {
        // 2×2 image: row0=[1,2,3,4, 5,6,7,8], row1=[9,10,11,12, 13,14,15,16]
        const renderer = createMockRenderer();
        renderer.readRenderTargetPixels.mockImplementation(
          (
            _rt: unknown,
            _x: number,
            _y: number,
            _w: number,
            _h: number,
            buffer: Uint8Array
          ) => {
            // Bottom-row-first: row0 = "bottom", row1 = "top"
            //  row0: pixel(0,0)=[10,20,30,255], pixel(1,0)=[40,50,60,255]
            //  row1: pixel(0,1)=[70,80,90,255], pixel(1,1)=[100,110,120,255]
            const data = [
              10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120,
              255,
            ];
            buffer.set(data);
          }
        );

        // Use OffscreenCanvas mock that captures the ImageData put onto it
        let capturedData: Uint8ClampedArray | null = null;
        globalThis.OffscreenCanvas = class {
          width: number;
          height: number;
          constructor(w: number, h: number) {
            this.width = w;
            this.height = h;
          }
          getContext() {
            return {
              putImageData: (imageData: ImageData) => {
                capturedData = new Uint8ClampedArray(imageData.data);
              },
            };
          }
          convertToBlob() {
            return Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }));
          }
        } as unknown as typeof OffscreenCanvas;

        blitCapture = new CameraBlitCapture({ width: 2, height: 2 });
        await blitCapture.captureToBlob(
          renderer as never,
          mockTexture as never,
          0.7
        );

        expect(capturedData).not.toBeNull();
        // After flipping, row0 and row1 should be swapped
        // New row0 (was row1): [70,80,90,255, 100,110,120,255]
        // New row1 (was row0): [10,20,30,255, 40,50,60,255]
        expect(Array.from(capturedData!)).toEqual([
          70, 80, 90, 255, 100, 110, 120, 255, 10, 20, 30, 255, 40, 50, 60, 255,
        ]);
      });

      /**
       * Why this test matters:
       * Odd-height images have a middle row that should remain unchanged.
       * Off-by-one errors in the flip loop would corrupt it.
       */
      it('leaves middle row untouched for odd-height image', async () => {
        const renderer = createMockRenderer();
        renderer.readRenderTargetPixels.mockImplementation(
          (
            _rt: unknown,
            _x: number,
            _y: number,
            _w: number,
            _h: number,
            buffer: Uint8Array
          ) => {
            // 1×3 image: 3 rows, 1 pixel each
            // row0=[1,2,3,255], row1=[4,5,6,255], row2=[7,8,9,255]
            buffer.set([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255]);
          }
        );

        let capturedData: Uint8ClampedArray | null = null;
        globalThis.OffscreenCanvas = class {
          width: number;
          height: number;
          constructor(w: number, h: number) {
            this.width = w;
            this.height = h;
          }
          getContext() {
            return {
              putImageData: (imageData: ImageData) => {
                capturedData = new Uint8ClampedArray(imageData.data);
              },
            };
          }
          convertToBlob() {
            return Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }));
          }
        } as unknown as typeof OffscreenCanvas;

        blitCapture = new CameraBlitCapture({ width: 1, height: 3 });
        await blitCapture.captureToBlob(
          renderer as never,
          mockTexture as never,
          0.7
        );

        expect(capturedData).not.toBeNull();
        // After flip: row0↔row2, row1 stays
        expect(Array.from(capturedData!)).toEqual([
          7, 8, 9, 255, 4, 5, 6, 255, 1, 2, 3, 255,
        ]);
      });
    });

    describe('isBlackFrame edge cases', () => {
      /**
       * Why this test matters:
       * Empty buffer is a degenerate input (e.g. 0×0 render target).
       * Must not crash and should be considered "black".
       */
      it('returns true for empty buffer', () => {
        expect(CameraBlitCapture.isBlackFrame(new Uint8Array(0))).toBe(true);
      });

      /**
       * Why this test matters:
       * Pixels with R=G=B=0 but A=255 are visually black and should
       * be detected as such. The check deliberately ignores alpha.
       */
      it('treats pixels with only alpha as black', () => {
        const pixels = new Uint8Array(8); // 2 pixels
        pixels[3] = 255; // pixel 0: RGBA(0,0,0,255)
        pixels[7] = 255; // pixel 1: RGBA(0,0,0,255)
        expect(CameraBlitCapture.isBlackFrame(pixels)).toBe(true);
      });

      /**
       * Why this test matters:
       * A single non-black pixel in the smallest possible buffer must
       * be detected to avoid false positives.
       */
      it('detects non-black in single-pixel buffer', () => {
        const pixels = new Uint8Array([0, 1, 0, 255]);
        expect(CameraBlitCapture.isBlackFrame(pixels)).toBe(false);
      });
    });

    describe('dispose', () => {
      /**
       * Why this test matters:
       * GPU resources (render target, material, geometry) must be freed
       * when the capture pipeline is no longer needed. On mobile devices
       * with limited VRAM, leaked render targets can cause OOM crashes.
       */
      it('can be called without error', () => {
        blitCapture = new CameraBlitCapture({ width: 64, height: 64 });
        expect(() => blitCapture.dispose()).not.toThrow();
      });

      it('can be called multiple times safely', () => {
        blitCapture = new CameraBlitCapture({ width: 64, height: 64 });
        blitCapture.dispose();
        expect(() => blitCapture.dispose()).not.toThrow();
      });
    });

    describe('resizeIfNeeded', () => {
      /**
       * Why this test matters:
       * When the camera resolution changes (or is first known), the render
       * target and pixel buffer must resize to match. A 512×512 target
       * squashes a 1920×1080 camera feed into a distorted square.
       */
      it('resizes render target and pixel buffer to match camera dimensions', async () => {
        blitCapture = new CameraBlitCapture({ width: 64, height: 64 });
        const resized = blitCapture.resizeIfNeeded(160, 90);

        expect(resized).toBe(true);

        // Verify the new dimensions are used by doing a capture
        const renderer = createMockRenderer();
        await blitCapture.captureToBlob(
          renderer as never,
          mockTexture as never,
          0.7
        );

        const callArgs = renderer.readRenderTargetPixels.mock.calls[0];
        expect(callArgs[3]).toBe(160); // width
        expect(callArgs[4]).toBe(90); // height
      });

      /**
       * Why this test matters:
       * Calling resizeIfNeeded with the same dimensions should be a no-op
       * to avoid unnecessary GPU resource reallocation every frame.
       */
      it('returns false when dimensions already match', () => {
        blitCapture = new CameraBlitCapture({ width: 64, height: 64 });
        const resized = blitCapture.resizeIfNeeded(64, 64);
        expect(resized).toBe(false);
      });

      /**
       * Why this test matters:
       * The guard was `newWidth <= 0 || newHeight <= 0`, which is FALSE for
       * NaN — the exact form removed from `computeCaptureSize` in this same
       * file, and missed here (PR #375 review). NaN or Infinity reached
       * `renderTarget.setSize` and `new Uint8Array(w * h * 4)`, the latter
       * throwing or allocating nothing useful. The existing tests pinned
       * only `0`, which is the one invalid value the old guard did catch.
       * This is a PUBLIC method, so hardened in-repo call sites do not
       * cover it.
       */
      /**
       * Why this test matters (PR #379 review):
       * the guard rejected non-finite but not non-INTEGER dimensions.
       * `resizeIfNeeded` is documented to RETURN FALSE when its dimensions
       * are invalid - the one contract a public setter has - but a
       * fractional size was accepted, stored, and forwarded to
       * `renderTarget.setSize` and `new Uint8Array(w * h * 4)`. Whether that
       * allocation throws depends on whether the PRODUCT happens to be a
       * whole number (512.5 x 384 x 4 is), which is precisely why the guard
       * belongs on the dimensions and not on the product.
       *
       * Each case calls `resizeIfNeeded` ONCE: a second call with the same
       * values returns false simply because nothing changed, which would
       * make this pass against the very guard it is meant to pin.
       */
      it('refuses fractional dimensions', () => {
        for (const [w, h] of [
          [512.5, 384],
          [512, 384.25],
          [1.1, 1],
        ] as const) {
          blitCapture = new CameraBlitCapture({ width: 64, height: 64 });
          let result: boolean | undefined;
          expect(() => {
            result = blitCapture.resizeIfNeeded(w, h);
          }, `${w}x${h}`).not.toThrow();
          expect(result, `${w}x${h}`).toBe(false);
        }
      });

      it('refuses NaN and Infinite dimensions, not just zero', () => {
        blitCapture = new CameraBlitCapture({ width: 64, height: 64 });
        for (const [w, h] of [
          [Number.NaN, 64],
          [64, Number.NaN],
          [Number.POSITIVE_INFINITY, 64],
          [64, Number.POSITIVE_INFINITY],
          [0, 64],
        ] as const) {
          expect(blitCapture.resizeIfNeeded(w, h), `${w}x${h}`).toBe(false);
        }
      });

      /**
       * Why this test matters:
       * The JPEG blob from a resized (rectangular) target must still be
       * produced correctly through the full pipeline.
       */
      it('produces valid blob after resize to rectangular dimensions', async () => {
        blitCapture = new CameraBlitCapture({ width: 64, height: 64 });
        blitCapture.resizeIfNeeded(320, 180);

        const blob = await blitCapture.captureToBlob(
          mockRenderer as never,
          mockTexture as never,
          0.7
        );
        expect(blob).not.toBeNull();
        expect(blob!.type).toBe('image/jpeg');
      });

      /**
       * Why this test matters:
       * After dispose, resizeIfNeeded should not throw or attempt to
       * modify freed GPU resources.
       */
      it('returns false after dispose', () => {
        blitCapture = new CameraBlitCapture({ width: 64, height: 64 });
        blitCapture.dispose();
        const resized = blitCapture.resizeIfNeeded(320, 180);
        expect(resized).toBe(false);
      });

      /**
       * Why this test matters:
       * Zero or negative dimensions are invalid and must be rejected
       * to avoid WebGL errors from setSize(0, 0).
       */
      it('returns false for zero dimensions', () => {
        blitCapture = new CameraBlitCapture({ width: 64, height: 64 });
        expect(blitCapture.resizeIfNeeded(0, 100)).toBe(false);
        expect(blitCapture.resizeIfNeeded(100, 0)).toBe(false);
      });
    });

    describe('getWidth / getHeight', () => {
      /**
       * Why this test matters (frame-tile aspect-ratio fix, D1 of
       * 2026-06-13-1311-frame-tile-rendering-bugs-user-feedback.md):
       * the render-target size equals the encoded JPEG's pixel size, so
       * webxr-session reads these getters to persist each captured frame's
       * true width/height for aspect-correct rendering. They must report the
       * construction size and then track resizeIfNeeded.
       */
      it('reports the construction dimensions and tracks resizeIfNeeded', () => {
        blitCapture = new CameraBlitCapture({ width: 320, height: 240 });
        expect(blitCapture.getWidth()).toBe(320);
        expect(blitCapture.getHeight()).toBe(240);

        blitCapture.resizeIfNeeded(160, 90);
        expect(blitCapture.getWidth()).toBe(160);
        expect(blitCapture.getHeight()).toBe(90);
      });
    });
  });

  describe('computeCaptureSize', () => {
    /**
     * Why this test matters:
     * With divisor=1 (full resolution), the output must match the camera
     * dimensions exactly — no scaling at all.
     */
    it('returns full camera dimensions when divisor is 1', () => {
      const result = computeCaptureSize(1920, 1080, 1);
      expect(result).toEqual({ width: 1920, height: 1080 });
    });

    /**
     * Why this test matters:
     * With divisor=2, both dimensions must be halved. This is the most
     * common user setting for balancing quality and performance.
     */
    it('halves dimensions when divisor is 2', () => {
      const result = computeCaptureSize(1920, 1080, 2);
      expect(result).toEqual({ width: 960, height: 540 });
    });

    /**
     * Why this test matters:
     * With divisor=4, dimensions are quartered. Useful for very
     * constrained devices.
     */
    it('quarters dimensions when divisor is 4', () => {
      const result = computeCaptureSize(1920, 1080, 4);
      expect(result).toEqual({ width: 480, height: 270 });
    });

    /**
     * Why this test matters:
     * Portrait-mode cameras (taller than wide) must also be handled
     * correctly. Aspect ratio must be preserved after division.
     */
    it('preserves aspect ratio for portrait dimensions', () => {
      const result = computeCaptureSize(1080, 1920, 2);
      expect(result).toEqual({ width: 540, height: 960 });
    });

    /**
     * Why this test matters:
     * Odd camera dimensions divided by 2 produce fractional values.
     * WebGL render targets require integer pixel dimensions, so
     * results must be floored to integers.
     */
    it('floors fractional results to integers', () => {
      const result = computeCaptureSize(1921, 1081, 2);
      expect(result).toEqual({ width: 960, height: 540 });
      expect(Number.isInteger(result.width)).toBe(true);
      expect(Number.isInteger(result.height)).toBe(true);
    });

    /**
     * Why this test matters:
     * Zero/negative camera dimensions are invalid inputs. The function
     * must return the DEFAULT_BLIT_CONFIG as a safe fallback to avoid
     * creating a 0×0 render target.
     */
    it('returns fallback for zero or negative camera dimensions', () => {
      const result = computeCaptureSize(0, 0, 1);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });

    /**
     * Why this test matters:
     * `computeAspectFitSize`, directly below in the same file, guards NaN and
     * Infinity explicitly and its comment names the consequence — "{NaN, NaN}
     * ... would crash render-target alloc". This function, written earlier,
     * never learned: `cameraWidth <= 0` is FALSE for NaN, so NaN flows through
     * `Math.floor` and survives `Math.max(1, NaN)`, which returns NaN.
     * Infinity likewise passes `<= 0` and yields an infinite edge.
     *
     * The zero case above passed throughout, because zero is the one invalid
     * dimension the original guard actually catches.
     */
    it('returns fallback for NaN or Infinite camera dimensions', () => {
      for (const [w, h] of [
        [Number.NaN, Number.NaN],
        [Number.NaN, 1080],
        [Number.POSITIVE_INFINITY, 1080],
        [1920, Number.POSITIVE_INFINITY],
      ] as const) {
        const result = computeCaptureSize(w, h, 1);
        expect(Number.isFinite(result.width), `width for ${w}x${h}`).toBe(true);
        expect(Number.isFinite(result.height), `height for ${w}x${h}`).toBe(
          true
        );
        expect(result.width).toBeGreaterThan(0);
        expect(result.height).toBeGreaterThan(0);
      }
    });

    /**
     * Why this test matters: a non-finite DIVISOR is the third way in. NaN
     * fails `divisor >= 1` and so already falls back to 1, but Infinity
     * passes it and drives both edges to `Math.floor(x / Infinity) = 0`,
     * which `Math.max(1, ...)` then pins to a 1x1 render target — technically
     * valid, silently useless. Pinned so the guard covers the whole input.
     */
    it('treats a non-finite divisor as full resolution', () => {
      for (const divisor of [Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = computeCaptureSize(1920, 1080, divisor);
        expect(result).toEqual({ width: 1920, height: 1080 });
      }
    });

    /**
     * Why this test matters:
     * A divisor <1 is nonsensical (would upscale). The function must
     * treat it as 1 (full resolution) to avoid generating textures
     * larger than the source.
     */
    it('treats divisor < 1 as 1 (no upscaling)', () => {
      const result = computeCaptureSize(1920, 1080, 0.5);
      expect(result).toEqual({ width: 1920, height: 1080 });
    });

    /**
     * Why this test matters:
     * A divisor of 0 is a degenerate input that must be handled gracefully
     * to avoid division-by-zero.
     */
    it('treats divisor of 0 as 1', () => {
      const result = computeCaptureSize(1920, 1080, 0);
      expect(result).toEqual({ width: 1920, height: 1080 });
    });

    /**
     * Why this test matters:
     * Very large divisors could produce dimensions < 1px. The function
     * must clamp minimum dimensions to at least 1×1.
     */
    it('clamps result to at least 1×1', () => {
      const result = computeCaptureSize(10, 10, 100);
      expect(result.width).toBeGreaterThanOrEqual(1);
      expect(result.height).toBeGreaterThanOrEqual(1);
    });
  });

  describe('computeAspectFitSize', () => {
    /**
     * Why this test matters (B2 Option 1 — aspect-correct QR blit):
     * A 4:3 camera must NOT be squashed into a square (which would stretch the
     * QR for the detector). The longer edge is fixed at maxEdge; the shorter
     * edge scales to preserve aspect.
     */
    it('fits a 4:3 landscape camera to maxEdge on the long (width) edge', () => {
      expect(computeAspectFitSize(640, 480, 512)).toEqual({
        width: 512,
        height: 384,
      });
    });

    it('fits a 16:9 landscape camera', () => {
      expect(computeAspectFitSize(1920, 1080, 512)).toEqual({
        width: 512,
        height: 288,
      });
    });

    /**
     * Why this test matters:
     * Portrait orientation must fix maxEdge on HEIGHT (the longer edge), not
     * width — otherwise a rotated device would over- or under-size the blit.
     */
    it('fits a portrait (3:4) camera to maxEdge on the long (height) edge', () => {
      expect(computeAspectFitSize(480, 640, 512)).toEqual({
        width: 384,
        height: 512,
      });
    });

    it('returns a square for a square camera', () => {
      expect(computeAspectFitSize(1000, 1000, 512)).toEqual({
        width: 512,
        height: 512,
      });
    });

    /**
     * Why this test matters (WS-C detection-resolution sweep):
     * `captureSize` is the QR-detection lever — the longer-edge blit budget the
     * BarcodeDetector sees. The on-device sweep varies it across {512, 768,
     * 1024}; lock that each candidate stays aspect-correct (long edge == size,
     * 4:3 short edge = 3/4·size) so a bigger budget puts more pixels on a small
     * QR without ever stretching it. See the thin-demo/size plan WS-C.
     */
    it('keeps each sweep-candidate capture size aspect-correct (4:3)', () => {
      expect(computeAspectFitSize(640, 480, 512)).toEqual({
        width: 512,
        height: 384,
      });
      expect(computeAspectFitSize(640, 480, 768)).toEqual({
        width: 768,
        height: 576,
      });
      expect(computeAspectFitSize(640, 480, 1024)).toEqual({
        width: 1024,
        height: 768,
      });
    });

    /**
     * Why this test matters:
     * Invalid camera dimensions (texture not ready) must fall back to a safe
     * maxEdge-square rather than producing a 0-sized render target.
     */
    it('falls back to a maxEdge square for invalid camera dimensions', () => {
      expect(computeAspectFitSize(0, 0, 512)).toEqual({
        width: 512,
        height: 512,
      });
      expect(computeAspectFitSize(-10, 480, 512)).toEqual({
        width: 512,
        height: 512,
      });
    });

    /**
     * Why this test matters:
     * `NaN <= 0` is false, so a NaN camera dimension would slip past the
     * `<= 0` guard and produce {NaN, NaN} — which crashes downstream render
     * target allocation. NaN dimensions are "invalid" exactly like ≤ 0, so they
     * must take the same safe-square fallback.
     */
    it('falls back to a maxEdge square for NaN camera dimensions', () => {
      expect(computeAspectFitSize(Number.NaN, 480, 512)).toEqual({
        width: 512,
        height: 512,
      });
      expect(computeAspectFitSize(640, Number.NaN, 512)).toEqual({
        width: 512,
        height: 512,
      });
      expect(computeAspectFitSize(Number.NaN, Number.NaN, 512)).toEqual({
        width: 512,
        height: 512,
      });
    });

    /**
     * Why this test matters:
     * A nonsensical maxEdge must fall back to the default blit EDGE LENGTH (so
     * we never build a 0×0/NaN target) while still preserving the camera aspect
     * — a 4:3 frame stays 4:3 at the default edge, not forced to a square.
     */
    it('falls back to the default edge length (still aspect-fit) when maxEdge is invalid', () => {
      // 640×480 (4:3) at the 512 default edge → 512×384, NOT a 512² square.
      expect(computeAspectFitSize(640, 480, 0)).toEqual({
        width: DEFAULT_BLIT_CONFIG.width,
        height: 384,
      });
      expect(computeAspectFitSize(640, 480, Number.NaN)).toEqual({
        width: DEFAULT_BLIT_CONFIG.width,
        height: 384,
      });
    });

    /**
     * Why this test matters:
     * `Infinity > 0` is true, so an Infinity camera dimension slips past the
     * negated `> 0` guard exactly like NaN once did. With a finite maxEdge that
     * yields `scale = maxEdge / Infinity = 0` → `round(Infinity * 0) = NaN`
     * (and a NaN/0 partner), i.e. a non-finite render-target size that crashes
     * allocation downstream. Infinity is "invalid" exactly like NaN/≤ 0, so it
     * must take the same safe-square fallback.
     */
    it('falls back to a maxEdge square for Infinity camera dimensions', () => {
      expect(computeAspectFitSize(Number.POSITIVE_INFINITY, 480, 512)).toEqual({
        width: 512,
        height: 512,
      });
      expect(computeAspectFitSize(640, Number.POSITIVE_INFINITY, 512)).toEqual({
        width: 512,
        height: 512,
      });
    });

    /**
     * Why this test matters:
     * `Infinity >= 1` is true, so an Infinity maxEdge slips past the edge guard
     * and `Math.floor(Infinity) = Infinity` becomes the long edge — producing
     * {Infinity, Infinity}. An infinite pixel budget is nonsensical, so it must
     * fall back to the default edge length while preserving aspect, exactly like
     * the NaN/0 maxEdge cases.
     */
    it('falls back to the default edge length when maxEdge is Infinity', () => {
      expect(computeAspectFitSize(640, 480, Number.POSITIVE_INFINITY)).toEqual({
        width: DEFAULT_BLIT_CONFIG.width,
        height: 384,
      });
    });

    it('floors the longer edge and clamps the shorter to ≥ 1', () => {
      // Extreme aspect: the short edge rounds below 1 → clamped to 1.
      const r = computeAspectFitSize(1000, 1, 512);
      expect(r.width).toBe(512);
      expect(r.height).toBe(1);
      expect(Number.isInteger(r.width)).toBe(true);
      expect(Number.isInteger(r.height)).toBe(true);
    });
  });
});
