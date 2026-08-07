# `nue-webxr-conversions.ts`

## Purpose

Re-exports the library's canonical NUE↔WebXR component conversions so consumer
apps can reach them through the framework instead of depending on
`gps-plus-slam-js` directly.

## Public API

Both are re-exports of `gps-plus-slam-js`; the framework adds no behaviour.

- `nueToWebXR(v: Vector3): Vector3` — NUE `[north, up, east]` → WebXR
  `[east, up, -north]`.
- `nueQuaternionToWebXR(q: Quaternion): Quaternion` — vector part swizzles as
  the position does (`[z, y, -x]`); `w` is invariant under basis change.

`Vector3` and `Quaternion` are the library's `readonly` tuples
(`readonly [number, number, number]` / `readonly [number, number, number, number]`).
Neither function has an error mode — they are total, pure swizzles.

## Invariants & assumptions

- **This is a pass-through, never a wrapper.** Nothing here may widen, validate,
  or adapt the library's signatures.
  - The predecessors it replaced (`nuePositionToWebXR` /
    `nueQuaternionToWebXR`, formerly in `webxr-session.ts`) took
    `readonly number[]` and `as`-cast it back to a tuple. That cast was
    unchecked: a 2-element array would have passed the type system and produced
    `undefined` components at runtime.
  - The widening was never necessary. Callers already hold tuples —
    `StoreSubscriberDeps.onNewOdomPose` is typed
    `(odomPosition: Vector3, odomRotation: Quaternion) => void`. The one caller
    that appeared to need it had widened its own callback annotation by hand.
- **Why the module exists at all** rather than letting consumers import the
  library: the recorder declares only `gps-plus-slam-app-framework` and has no
  other direct `gps-plus-slam-js` import. Routing these two functions through
  the framework keeps that single-dependency boundary intact.
- **Why not `webxr-nue-basis.ts`**, which owns the matrix form of the same basis
  change: that module documents itself as depending on `three` alone so light
  consumers (`visualization/hit-test-reticle.ts`) do not inherit heavy import
  graphs in unit tests. `gps-plus-slam-js` pulls in Redux Toolkit and h3-js, so
  a re-export there would quietly break that promise.

## Examples

```ts
import {
  nueToWebXR,
  nueQuaternionToWebXR,
} from 'gps-plus-slam-app-framework/ar/nue-webxr-conversions';

// Replay: drive `arpose`, which lives in WebXR space below basisChangeNode,
// from a recorded NUE odometry pose.
onNewOdomPose: (odomPosition, odomRotation) => {
  arpose.position.fromArray(nueToWebXR(odomPosition));
  arpose.quaternion.fromArray(nueQuaternionToWebXR(odomRotation));
};
```

## Tests

No dedicated spec — the module contains no logic, and adding one would test the
library's implementation from the wrong package.

- Conversion behaviour is pinned in the library:
  `GpsPlusSlamJs/src/state/serializableTypes.test.ts` — `describe('nueToWebXR')`
  and `describe('webxrToNUE / nueToWebXR round-trip')`.
- The framework-side composition that actually matters —
  `(alignment × WEBXR_TO_NUE) × arpose_WebXR = alignment × odom_NUE` — is pinned
  in `webxr-session.alignment.test.ts`.
- Consumer wiring is covered by `state/replay-session.test.ts` and the
  recorder's `replay/replay-mode.test.ts`.

## Related

- [webxr-nue-basis.ts](webxr-nue-basis.ts.md) — matrix form of the same basis change.
- [replay-scene.ts](replay-scene.ts.md) / `state/replay-session.ts` — the replay path that consumes these.
