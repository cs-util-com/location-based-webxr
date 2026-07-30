# xr-camera-texture.ts

## Purpose

Acquires the current XR frame's camera texture via Three.js's
`renderer.xr.getCameraTexture()` and pairs it with the **native** camera
dimensions, which that API does not return but the blit-capture pipeline needs
in order to size its render target.

One function and three small structural types — the whole module exists to add
`width`/`height` to a Three.js call and to make the failure path total.

## Public API

### `acquireCameraTexture(renderer, xrCamera): CameraTextureResult | null`

Returns `{ texture, width, height }`, or `null` on any of: a null `xrCamera`,
Three.js returning no texture, or a throw inside `getCameraTexture` (logged,
swallowed). **Must be called inside the XR animation-frame callback** — outside
it, Three.js has no current binding.

### `CameraTextureResult`

`{ texture: THREE.Texture; width: number; height: number }`. The texture is
Three.js's `ExternalTexture`; `width`/`height` are the native camera frame size
taken from the `XRCamera`, **not** the texture's own dimensions.

### `XRCameraLike` / `RendererLike`

Deliberately minimal structural types (`{width, height}` and
`{xr: {getCameraTexture}}`) so tests can pass plain objects instead of
constructing a real `WebGLRenderer` or `XRCamera`.

## Invariants & assumptions

- **Total on failure.** Every error path returns `null` rather than throwing —
  a dropped camera frame must never break the frame loop. Only the throw path
  logs.
- **Requires a Three.js version that has `renderer.xr.getCameraTexture()`** —
  the module header names v0.182.0+; it is present in the pinned devDependency
  (0.184.0, `WebXRManager.js`). **Open gap:** the package declares the peer range
  `"three": ">=0.170.0"`, which admits versions without that method. There the
  call throws, the `catch` swallows it, and `acquireCameraTexture` returns `null`
  every frame — camera capture never works and the only signal is a per-frame
  error log. Either raise the peer floor or feature-detect. Filed in the
  simplify-loop findings doc.
- **Do not reintroduce the manual pipeline.** This module used to drive
  `XRWebGLBinding.getCameraImage()` itself and inject `__webglTexture` by hand.
  Three.js now does exactly that internally — creating the binding lazily,
  calling `getCameraImage` per view, wrapping the result in `ExternalTexture`,
  and caching per `xrCamera` — and its `WebGLTextures` handles `ExternalTexture`
  natively, so `ShaderMaterial` uniforms receive it correctly. The hack is
  strictly redundant now; re-adding it would fight the cache.
- **Texture ownership stays with Three.js.** The returned texture is cached and
  reused per `xrCamera`; callers must not dispose it.
- The result is valid only for the frame it was acquired in — do not retain it
  across frames.

## Example

```ts
import { acquireCameraTexture } from 'gps-plus-slam-app-framework/ar/xr-camera-texture';

// inside the XR animation-frame callback:
const cam = view.camera;
const result = acquireCameraTexture(renderer, cam ?? null);
if (result) {
  blitTarget.setSize(result.width, result.height);
  material.uniforms.uCamera.value = result.texture;
}
// result === null → skip this frame, no error handling required
```

## Tests

`xr-camera-texture.test.ts` — 7 tests using plain stand-ins for `RendererLike` /
`XRCameraLike`: dimensions are taken from the `XRCamera` and paired with the
returned texture; `null` is returned for a null camera, for a missing texture,
and when `getCameraTexture` throws (with the throw logged, not propagated).

## References

Both live in the **private repo's** doc set, not in this package's `docs/`
(the module's own `@see` lines read as package-relative and are misleading):

- `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-02-26-bug-camera-frames-black-2.md`
  — the reference tutorial.
- `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-02-26-user-feedback.md` Issue 5
  Phase 2 — why camera access exists.
