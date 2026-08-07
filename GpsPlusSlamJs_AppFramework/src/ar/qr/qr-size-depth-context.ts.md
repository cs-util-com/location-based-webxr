# `qr-size-depth-context.ts` — shared `DepthSample` → `QrSizeDepthContext` factory

## Purpose

Single source for building the per-frame depth-access object the QR size measurer
needs (`QrSizeDepthContext` = `{ unprojector, depthAt }`) from one `DepthSample`.
Both the QR-tracking demo and the Recorder live-QR path used to wire this
identically by hand — this factory de-duplicates that so the two cannot drift
(e.g. one switching the grid lookup from bilinear to nearest would silently make
the two apps measure different QR sizes).

## Public API

- `createQrSizeDepthContext(sample: DepthSample): QrSizeDepthContext | null`
  - **Returns** a context with `unprojector` (`createDepthUnprojector`) and a
    `depthAt(screenX, screenY)` closure over a **bilinear** `createDepthGridLookup`.
  - **Returns `null`** when the sample has no `projectionMatrix` or a singular one
    (the unprojector cannot be built). Best-effort — never throws.
- Re-exports the `QrSizeDepthContext` type (defined in `qr-size-measurer.ts`) so a
  consumer can import the value + its type from this one subpath.

## Invariants & assumptions

- `depthAt` is **bilinear** over the sampler grid — depth varies smoothly across a
  small QR face rather than snapping to one nearest node (WS-A decision).
- Pure composition of `createDepthUnprojector` + `createDepthGridLookup`; it adds
  no state. Callers that need more (e.g. the demo's `cameraPose` +
  `projectionMatrix` for PnP intrinsics) compose it on top: `{ ...base, … }`.
- Import via the deep subpath `…/ar/qr/qr-size-depth-context`, NOT the `…/ar` barrel —
  the barrel eagerly pulls heavy transitive deps into the Recorder's
  partially-mocked wiring tests (same rationale as `qr-depth-resolver` /
  `qr-debug-view`).

## Examples

```ts
import { createQrSizeDepthContext } from 'gps-plus-slam-app-framework/ar/qr/qr-size-depth-context';

// Recorder (as-of resolver): time-address, then build the context.
const ctx = createQrSizeDepthContext(asOfSample); // QrSizeDepthContext | null

// Demo (live latest sample): compose the PnP extras on top.
const base = createQrSizeDepthContext(latestSample);
const depthContext = base && {
  ...base,
  cameraPose: {
    position: latestSample.cameraPos,
    rotation: latestSample.cameraRot,
  },
  projectionMatrix: latestSample.projectionMatrix,
};
```

## Consumers

- `GpsPlusSlamJs_RecorderApp/src/qr/qr-depth-resolver.ts` — `resolveDepthAt` calls
  it on the as-of-selected sample.
- `GpsPlusSlamJs_QrTrackingDemo/src/seams.ts` — `getDepthContext` calls it on the
  latest sample and adds `cameraPose` + `projectionMatrix`.

## Tests

`qr-size-depth-context.test.ts` (colocated): `null` on missing/singular
projection; a usable unprojector + `depthAt` for a valid sample; and that
`depthAt` reads the grid via **bilinear** interpolation (ramp grid → midpoint
returns the average, not a constant node).
