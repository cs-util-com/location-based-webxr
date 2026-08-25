/**
 * Frame texture decoder — F3.5b of
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).
 *
 * Decodes a JPEG blob into a `THREE.Texture` via `createImageBitmap`.
 * Compatible with the `decodeTexture` slot of
 * [`wireFrameTileSubscribers`](./wire-frame-tile-subscribers.ts).
 *
 * **Orientation contract (2026-06-13 fix,
 * [frame-tile-rendering-bugs-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-1311-frame-tile-rendering-bugs-user-feedback.md)
 * Finding 2 / D2):** the returned texture is **upright** — the same way the
 * source JPEG looks in an `<img>`. three.js cannot apply its default
 * `texture.flipY` to an `ImageBitmap` source (the WebGL `UNPACK_FLIP_Y_WEBGL`
 * flip does not affect `ImageBitmap` uploads), so wrapping a default
 * `createImageBitmap(blob)` in a `THREE.Texture` renders **vertically flipped**.
 * We therefore ask the browser for a pre-flipped bitmap via
 * `{ imageOrientation: 'flipY' }` and set `texture.flipY = false` so three.js
 * does not also try (and only warn) — the bitmap is already correctly oriented.
 * The geometry/basis path is proven flip-free (see the D2 elimination test in
 * `frame-tile-visualizer.test.ts`), so this decode-time flip is the complete fix.
 *
 * **Display-resolution downscale (D7-resolution, 2026-06-16 user feedback):**
 * an optional `divisor` (>1) re-samples the decoded bitmap to `1/divisor` of
 * each dimension before wrapping it in a `THREE.Texture`. This cuts per-tile GPU
 * texture memory (a partial mitigation for the OOM/crash track) without touching
 * the **captured** JPEG — it only affects the in-AR/replay display texture, so
 * it is distinct from the capture `images.resolutionDivisor`. The divisor is
 * sourced from the `frameTileDisplay.divisor` recording option (default 2). The
 * resize re-uses `createImageBitmap` with `resizeWidth/Height`, so the
 * orientation contract is preserved (the full bitmap is already upright; the
 * resize pass does NOT re-apply `imageOrientation`, which would re-flip it).
 *
 * Returns `null` (never throws) when:
 *   - `createImageBitmap` is unavailable in the runtime
 *   - the blob cannot be decoded as an image
 *
 * Soft-failure semantics let the wirer drop broken frames in the
 * field-recording corpus without surfacing errors to the user.
 */

import * as THREE from 'three';

export async function decodeFrameTexture(
  blob: Blob,
  divisor: number = 1
): Promise<THREE.Texture | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    // Pre-flip at decode: an ImageBitmap ignores THREE.Texture.flipY on upload,
    // so the browser must hand us an already-upright bitmap.
    const full = await createImageBitmap(blob, { imageOrientation: 'flipY' });

    // Optional display-resolution downscale. Guard the divisor defensively
    // (the recording-option validator already clamps to an integer ≥1, but a
    // direct caller might not) and only re-sample when it actually shrinks the
    // image to a non-zero target.
    const safeDivisor =
      Number.isFinite(divisor) && divisor > 1 ? Math.floor(divisor) : 1;
    const targetW = Math.max(1, Math.round(full.width / safeDivisor));
    const targetH = Math.max(1, Math.round(full.height / safeDivisor));

    let source: ImageBitmap = full;
    if (safeDivisor > 1 && (targetW < full.width || targetH < full.height)) {
      // Re-sample the already-upright bitmap. No `imageOrientation` here — the
      // pixels are already flipped, so a second 'flipY' would undo it.
      const resized = await createImageBitmap(full, {
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'medium',
      });
      // The full-res bitmap is no longer referenced; free it promptly.
      full.close();
      source = resized;
    }

    const texture = new THREE.Texture(source);
    // The bitmap is already upright; disable three's (ineffective for
    // ImageBitmap, warning-emitting) flip so intent is explicit.
    texture.flipY = false;
    texture.needsUpdate = true;
    return texture;
  } catch {
    return null;
  }
}
