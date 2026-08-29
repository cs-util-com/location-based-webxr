# camera-blit-capture.ts

## Purpose

Reads WebXR **opaque** camera textures (protected GPU buffers where plain `readPixels`/`toBlob` return black) by blitting them onto a fullscreen quad into an intermediate `WebGLRenderTarget` and reading that back. Used for the periodic JPEG frame captures and, since Iter 8, for the per-depth-sample RGB voxel colors.

Background: `docs/2026-02-06-bug-camera-frames-black.md`; RGB path: `GpsPlusSlamJs_Docs/docs/2026-06-11-2134-depth-occupancy-grid-port-plan.md` §4 Iter 8.

## Public API

- **`new CameraBlitCapture(config?)`** — `{ width, height }` of the intermediate target (default 512×512). Allocates the render target, shader quad and CPU pixel buffer once.
- **`captureToBlob(renderer, cameraTexture, quality): Promise<Blob | null>`** — blit + readback + JPEG encode (y-flip applied during encode). Null on failure/dispose.
- **`captureToPixels(renderer, cameraTexture): { pixels, width, height } | null`** — blit + readback only (steps A+B, shared with `captureToBlob`), returning the raw RGBA buffer for cheap per-point sampling (Iter 8). The returned `pixels` is the INTERNAL buffer — valid until the next capture or `resizeIfNeeded`; consume synchronously (e.g. `createRgbLookup`) or copy. Buffer is WebGL readback order (bottom-row-first). Null on failure/dispose, never throws.
- **`captureToRgba(renderer, cameraTexture): { data: Uint8ClampedArray, width, height } | null`** — blit + readback + vertical flip, returning a FRESH, **top-left-origin** RGBA copy (safe to retain past the next capture). The efficient, lossless replacement for the QR demo's old JPEG→`OffscreenCanvas`→`getImageData` round-trip (B2). Use this to feed `BarcodeDetector`/OpenCV. Null on failure/dispose.
- **`resizeIfNeeded(width, height): boolean`** — re-sizes target + buffer; no-op when unchanged/invalid/disposed. **"Invalid" means ≤ 0, NaN or ±Infinity** since 2026-08-29: the guard was `<= 0`, which is FALSE for NaN, so NaN and Infinity reached `setSize` and `new Uint8Array(w * h * 4)`. That is the same defect fixed in `computeCaptureSize` one commit earlier and MISSED here (PR #375 review) — one file, two entry points of the same kind, only one hardened, which is the third instance of that shape this branch has found. It matters despite both in-repo call sites now feeding hardened values, because this is a public method and the tests pinned only `0`.
- **`getWidth(): number` / `getHeight(): number`** — current render-target dimensions. These equal the encoded JPEG's pixel size (the encode canvas is sized to the render target), so `webxr-session` reads them after `captureToBlob` to persist each captured frame's true width/height for aspect-correct frame-tile rendering (D1 of `2026-06-13-1311-frame-tile-rendering-bugs-user-feedback.md`) without decoding the blob.
- **`CameraBlitCapture.isBlackFrame(pixels): boolean`** — sampled all-zero check (blit-failed detection vs. dark scene).
- **`computeCaptureSize(cameraWidth, cameraHeight, divisor)`** — capture dimensions from native camera resolution and the user's resolution divisor. Integer, ≥ 1, **finite**, and never larger than the camera's own edges. Invalid camera dimensions (≤ 0 / NaN / ±Infinity) fall back to `DEFAULT_BLIT_CONFIG`; an invalid divisor (< 1 / NaN / Infinity) is treated as 1 (full resolution, no upscale).
  - **The non-finite half of both guards was added 2026-08-29.** The original tested `cameraWidth <= 0`, which is FALSE for `NaN`, so `NaN` reached `Math.max(1, Math.floor(NaN))` — still `NaN` — and out to render-target allocation; `Infinity` likewise passed and produced an infinite edge. An infinite `divisor` drove both edges to 0, which `Math.max(1, …)` pinned to a **1×1** render target: a capture that succeeds and is worthless.
  - Worth noting how it survived: `computeAspectFitSize` directly below guards exactly these cases and its comments name the crash. The older function beside it never learned, and the unit test named "returns fallback for zero or negative camera dimensions" passed throughout, because zero is the one invalid dimension the original guard did catch.
- **`computeAspectFitSize(cameraWidth, cameraHeight, maxEdge)`** — capture dimensions that **preserve the camera aspect** with the **longer edge fixed at `maxEdge`** (e.g. `512` → `512×384` for a 4:3 camera). Unlike `computeCaptureSize` (divide-by-divisor), this fits a fixed pixel budget — used by the QR blit (B2) so the detector sees an undistorted code. Integer, longer edge `== maxEdge`, each axis ≥ 1. For an invalid `maxEdge` (< 1 / NaN / Infinity) the edge length falls back to `DEFAULT_BLIT_CONFIG.width` (still aspect-preserving); for invalid camera dims (≤ 0 / NaN / Infinity) the aspect is unknown → a square at the (possibly defaulted) edge.
- **`DEFAULT_BLIT_CONFIG`** — 512×512.

## Invariants & Assumptions

1. Both capture methods MUST be called inside the XR animation frame callback while the camera texture is valid.
2. Renderer state (render target, `xr.enabled`) is saved and restored around the blit — otherwise the main XR render loop breaks.
3. The opaque-texture uniform is cleared after each capture so the protected texture is never retained.
4. Failures are best-effort: logged and returned as `null`, never thrown into the frame loop.

## Examples

```ts
const blit = new CameraBlitCapture({ width: 256, height: 192 });
// inside the XR frame callback:
const readback = blit.captureToPixels(renderer, cameraTexture);
const jpeg = await blit.captureToBlob(renderer, cameraTexture, 0.7);
blit.dispose(); // on session teardown
```

## Tests

- `camera-blit-capture.test.ts` — blob pipeline (blit → readPixels → JPEG), renderer-state restore, black-frame handling, `captureToPixels` (buffer + dimensions, state restore, throw → null, dispose → null), `captureToRgba` (top-left flip, owned copy survives next capture, dispose → null), resize and dispose paths.
- `camera-blit-capture.property.test.ts` — `isBlackFrame` sampling properties; `computeCaptureSize` invariants (finite integer ≥ 1 for arbitrary input **including NaN/±Infinity dimensions and divisors**, and never upscaling past the camera's edges); `computeAspectFitSize` invariants (long edge == `maxEdge`, bounded, integer ≥ 1, orientation-symmetric). Concrete `computeAspectFitSize` aspect cases (4:3, 16:9, portrait, square, fallbacks, ≥1 clamp) are in `camera-blit-capture.test.ts`.
  - `computeCaptureSize` had **no** property coverage until 2026-08-29 while its neighbour had two, and that gap is exactly where its non-finite bug lived. Its arbitraries mix the degenerate values in deliberately: sane cameras were never the problem.
