# frame-texture-decoder.ts

## Purpose

Decode an image Blob into an **upright** `THREE.Texture` via
`createImageBitmap` — the shared owner of the ImageBitmap orientation
contract (promoted from the RecorderApp 2026-08-26, DEC-H3, so consumers do
not copy it).

## Public API

- `decodeFrameTexture(blob: Blob, divisor = 1, options?: { maxPixels? }): Promise<THREE.Texture | null>`
  — with `maxPixels` the size is read from the header first
  (`utils/image-header` `imageInfoOfBlob`), and an image over the cap, or
  one whose size cannot be read, is never decoded (`null`): the tour kit
  K4 review R2 decode cap, since `createImageBitmap` decodes at the stated
  size before any resize;
  — `divisor > 1` re-samples the decoded bitmap to `1/divisor` of each
  dimension (display-memory mitigation). Returns `null` — never throws —
  when `createImageBitmap` is unavailable or the blob does not decode.

## Invariants & assumptions

- **Orientation contract**: three.js cannot apply its default
  `texture.flipY` to an `ImageBitmap` source (the WebGL
  `UNPACK_FLIP_Y_WEBGL` flip ignores bitmap uploads), so a naive wrap
  renders vertically flipped. The decoder asks the browser for a
  pre-flipped bitmap (`imageOrientation: 'flipY'`) and sets
  `texture.flipY = false`. The resize pass does NOT re-apply the
  orientation option — that would re-flip.
- Disposal is the CONSUMER's job: the recorder's `FrameTileVisualizer`
  owns its tiles' lifecycle; the TourViewer's `image-planes` disposes the
  texture with each mesh.
- Deep-import as `gps-plus-slam-app-framework/visualization/frame-texture-decoder`
  (a per-file dist entry); it is deliberately not on the `/visualization`
  barrel.

## Examples

```ts
const texture = await decodeFrameTexture(blob, 2); // half-resolution
if (texture) material.map = texture;
```

## Tests

`frame-texture-decoder.test.ts` (colocated) — the flip contract, the
divisor resize, and the null soft-failure paths; the pixel cap (an image
over it, or unmeasurable, never reaches `createImageBitmap`). Consumers:
`GpsPlusSlamJs_RecorderApp` (frame tiles, live + replay) and
`GpsPlusSlamJs_TourViewer` (image planes).
