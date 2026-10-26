# film-gpu.ts

## Purpose

Decides which renderer the film uses and when a lost context is a real
loss: the 3D scene while WebGL works, the flat drawing for the rest of the
film's life after a real loss, no WebGL at all, or a renderer that will
not start. A scene released on purpose (AR) is not a loss.

## Public API

- `createGpuLifecycle({ webgl }): GpuLifecycle`
  - `kind()`: `"3d" | "floor"`.
  - `initialFallback`: `"no-webgl"` when it starts without WebGL, else null.
  - `wantsScene()`: build a scene now.
  - `created()`: a token for the scene just built.
  - `createFailed()`: the reason to report the first time, else null.
  - `released()`: the live scene was freed on purpose.
  - `contextLost(token)`: the reason to report for the live scene's loss,
    null for a released or older scene.
- `FallbackReason`: `"no-webgl" | "context-lost"`.

## Invariants

- Each fallback is reported once; after it no scene is ever wanted again.
- A late lost-context event of a released scene never touches a newer one.

## Tests

`film-gpu.test.ts`.
