# ar-types.ts

## Purpose

Shared AR type definitions plus the two tiny pose-extraction helpers that belong
with them. Extracted to break a circular dependency between `webxr-session.ts`
and `depth-sampler.ts`.

This is the **canonical** home for these types — several modules (`webxr-session.ts`,
`store.ts`) re-export them for convenience, but the definitions live here and
must not be forked.

## Public API

### Types

- **`ArPoseTuples`** — `{ position: Vector3, rotation: Quaternion }`, tuple-form
  pose for storage/serialization (library readonly tuples from
  `gps-plus-slam-js`). Used where poses are persisted as plain JSON arrays:
  `RefPointObservation`, `ParsedRefPointAction`, `RefPointRecord`.
- **`WebXRVec3` / `WebXRQuaternion`** — object-form `{x,y,z}` / `{x,y,z,w}` as
  the WebXR API returns them (`XRViewerPose`). Deliberately distinct from the
  library's tuple forms; also used by `CapturedImage` and the pose mocks.
- **`ARPose`** — `{ position: WebXRVec3, orientation: WebXRQuaternion }`, the raw
  local-floor device pose (**not** alignment-transformed).
- **`DepthPoint`** — `{ screenX, screenY, depthM, rgb? }`, one normalized-view
  depth read. Optional `rgb` (Iter 8) is the camera colour sampled in the same XR
  frame — an additive persisted field, absent on old recordings or when the rgb
  recording option is off.
- **`RgbTuple`** — `readonly [number, number, number]`, sRGB 0–255 per channel
  (plain ints, for compact persisted JSON).
- **`DepthSample`** — `{ timestamp, cameraPos, cameraRot, points, projectionMatrix? }`,
  the persisted payload of `recording/recordDepthSample`.

### Functions

The file is **not** pure types — it exports two runtime helpers:

- **`extractOdomPosition(arPose: ARPose): Vector3`**
- **`extractOdomRotation(arPose: ARPose): Quaternion`**

Both are plain field-to-tuple reshapes that apply **no coordinate conversion** —
the reducer applies the WebXR→NUE transform on store (raw-storage pattern, see
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-09-raw-storage-convert-on-read.md`
— in the private repo, not this package's `docs/`).

**Why they live here** (quality-review G-8): they used to sit in
`state/gps-event-coordinator.ts`, which forced an `ar/depth-sampler.ts` →
`state/` import. Moving them next to the type they destructure removed that
edge. Do not relocate them back into a state module.

## Invariants & assumptions

1. **Every interface is fully `readonly`** — these are pure data records created
   once and never mutated. Enforced at the type level in `ar-types.test.ts` via
   `expectTypeOf<T>().toEqualTypeOf<Readonly<T>>()` plus `@ts-expect-error`
   mutation attempts, so widening a field fails the build.
2. **`DepthSample.cameraPos`/`cameraRot` are raw WebXR** (local-floor;
   X=East, Y=Up, Z=South) — no NUE conversion anywhere in the depth pipeline.
   Consumers needing NUE must convert themselves.
3. **`DepthSample.timestamp` is epoch ms** (`performance.timeOrigin + xrFrameTime`),
   matching every other persisted action timestamp.
4. **`projectionMatrix` is optional and additive** — a column-major 16-tuple
   (`Matrix4` from `gps-plus-slam-js`, _not_ THREE's class) of the capturing
   `XRView`. Recordings from before 2026-06 lack it; consumers must skip
   unprojection for those samples.
5. All `DepthSample` fields are plain JSON-serializable data, for both Redux
   persistence and replay.
6. Distances are metres (hence `depthM`); screen coordinates are normalized 0–1
   (hence `screenX`/`screenY`); orientations are unit quaternions.

## Example

```ts
import type { DepthSample } from '../types/ar-types';
const sample: DepthSample = {
  timestamp: Date.now(),
  cameraPos: [0, 1.6, 0],
  cameraRot: [0, 0, 0, 1],
  points: [{ screenX: 0.5, screenY: 0.5, depthM: 2 }],
};
```

## Tests

`ar-types.test.ts` — the readonly type-level guards above, and a
**single-source-of-truth** block verifying that `image-capture.ts`'s
`ImageCaptureCallbacks.getCurrentPose` uses the canonical `ARPose` from this file
rather than a structural look-alike.

Runtime behaviour of the persisted shapes is additionally covered by
`depth-sampler.test.ts` (sample shape, `projectionMatrix` copy/absence) and the
RecorderApp's `action-schema.test.ts` (persisted JSON shape).
