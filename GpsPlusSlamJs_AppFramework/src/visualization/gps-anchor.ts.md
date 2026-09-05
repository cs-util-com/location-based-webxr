# `gps-anchor.ts`

## Purpose

`createGpsAnchor` is the GPS-anchored placement primitive for a single
`THREE.Object3D`. It owns the object's local transform inside an
`arWorldGroup`. The target is a GPS-world **NUE** point derived from the
stored GPS coordinate and the GPS zero reference. Because the managed
object is parented to `arWorldGroup` — whose local matrix **is** the
alignment matrix (AR-odometry NUE → GPS-world NUE) — the GPS-world target
must be expressed in the group's local frame by pre-multiplying with
`alignment⁻¹`. This conversion is delegated to the
[`nueToArLocal`](frame-conversions.ts) helper. The component then decides
when to commit the new pose using a configurable mode flag.

See the alignment-frame bug doc for why the inverse is required and how
the regression was found:
[2026-05-31-gps-anchor-alignment-frame-bug.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md).

This is the JS port of the C# `GpsAnchor` / `GpsAnchorForNonEcsGos`
sibling pair, merged into one component because in the JS scene-graph
world they only differ by the steady-state commit policy.

For the design rationale, state machine, threshold formulas, and
parenting rules see the dedicated port plan:
[2026-05-13-gps-anchor-port-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-13-gps-anchor-port-plan.md).

## Status

This file currently implements **sub-steps 2 (bootstrap phase),
3 (steady-state `'snap-every-tick'` + distance-scaled threshold gate),
4 (`'snap-when-offscreen'` mode gate, with a one-time initial-placement
exemption for `skipBootstrap` anchors), and 5 (re-bootstrap on external
move)** of the port plan. Floor-Y correction (sub-step 6) is not
implemented. The `floorY`, `angleThresholdInDegrees` and
`heightAboveGround` options that used to be accepted for it were never read
and were removed 2026-09-04 (simplify loop; a MAJOR by semver, shipped in 1.24.0 - a MINOR by
owner decision, in lock-step with `gps-plus-slam-js` 1.24.0): an accepted-but-ignored option is a promise the code does not
keep, and no consumer passed any of the three.

## Public API

- `type GpsAnchorMode = 'snap-when-offscreen' | 'snap-every-tick'` —
  steady-state commit policy. Default `'snap-when-offscreen'`.
- `type GpsAnchorPhase = 'bootstrap' | 'anchored'`.
- `type GpsAnchorSamplePoint = LatLong | LatLongAlt`.
- `interface GpsAnchorOptions` — required: `object3D`, `arWorldGroup`,
  `camera`, `gpsPoint`, `getAlignmentMatrix`, `getGpsZeroRef`,
  `getCurrentGpsPoint`. Optional: `skipBootstrap`, `onBootstrapComplete`,
  `mode`,
  `distanceThreshold` (default 2 m),
  `secondsToAccumulateGpsPose` (default 7 samples at 1 Hz),
  `settlingSeconds` (default 0).
  (The declared-but-never-wired `targetPosRefreshRateInSec` option was
  removed 2026-07-10, quality-review E-3 — the steady-state target is now
  cached on the `(zeroRef, alignmentMatrix, gpsPoint)` reference identities,
  so the geo trig + inversion run only when an input actually changes,
  with no refresh timer needed.)
- `createGpsAnchor(options) → GpsAnchor` — the factory.
- `interface GpsAnchor` — `phase`, `isFullyAnchored`, `gpsPoint`,
  `markMovedExternally()`, `setGpsPoint(point)`, `dispose()`.

The `__tickForTests(dt, elapsed)` method is exposed on the returned
object as an `@internal` testing seam in lieu of pumping the global
`runFrameUpdates`. Production code MUST NOT call it.

## Invariants & assumptions

- **No nested anchors**: a `THREE.Object3D` whose parent chain already
  contains a `GpsAnchor`-managed object cannot be anchored — the
  constructor throws. Mirrors the C# invariant. Implementation: a
  module-level `WeakSet<Object3D>` tracks managed objects.
- **Self-registers with the frame loop**: the anchor registers via
  `registerFrameUpdate` at construction time and unregisters in
  `dispose()`. Callers do not pump it manually.
- **`elapsed` is monotonic seconds**: tied to `XRFrame.time / 1000`.
  Tests inject controlled values via `__tickForTests`.
- **Bootstrap median is per-coordinate**: `lat`, `lon`, and (if any
  sample carries one) `altitude` are independently medianed. Per-coord
  median is more robust to single-axis spikes than a vector median.
- **Sampling rate is 1 Hz**: at most one sample collected per second
  of wall-clock `elapsed`. The `secondsToAccumulateGpsPose` field is
  the _sample count_ (default 7), not the window length — together
  with 1 Hz sampling this is also the window length in the default
  case.
- **`secondsToAccumulateGpsPose` must be >= 1**: the constructor throws
  for any sub-1 value (e.g. `0`). A `0` would otherwise commit the
  median after the first received sample, silently degrading the
  accumulation phase into a misconfiguration. To intentionally skip
  accumulation, pass `skipBootstrap: true` (the supported bypass).
  The throw cleans up the `WeakSet` registration so a later valid
  anchor on the same object3D is still allowed.
- **`getCurrentGpsPoint` returning null is a non-error**: the tick is
  silently skipped (no sample pushed, `lastSampleAtElapsed` not
  updated, so the next tick will retry). Mirrors "no fix yet".
- **`onBootstrapComplete` fires from the median commit only**: invoked with the
  exact committed `gpsPoint` whenever the bootstrap median is committed — once
  after the initial bootstrap and again after every re-bootstrap
  (`markMovedExternally` → re-accumulate → commit). It never fires when
  `skipBootstrap` is true (there is no bootstrap to complete), so a host that
  persists the committed reference (e.g. AnchorStarter's `?show=`) gets a value
  equal to the committed `gpsPoint` by construction.
- **`gpsPoint` getter reflects the committed pose**: during
  `'bootstrap'` it is the seed; after the median is committed it is
  the median. Callers may use it to decide visibility (e.g. ghost the
  object until `isFullyAnchored`).
- **Steady-state commits snap instantly**: when the commit gate accepts a
  correction the object's local pose is set with `object3D.position.copy(target)`
  (no per-anchor easing). Smoothing is done **once** at `arWorldGroup` via
  `enableArWorldGroupAlignment` (the framework default that lerps
  `arWorldGroup.matrix`), so the camera and every anchored child shift together
  and each accepted commit here is only a small off-screen residual. The commit
  **gate** (distance-scaled threshold + `snap-when-offscreen` frustum
  suppression) decides _when_ a correction lands; the snap decides _how_
  (instantly). A previous per-anchor lerp (`lerpCorrections` /
  `correctionLerpRate`, D1′) was removed once alignment was lerped at
  `arWorldGroup` — see
  `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-05-0650-gps-anchor-frame-architecture-bug-and-plan.md`.
- **`snap-when-offscreen` corrections fire only off-screen — except the first
  placement**: a correction is suppressed while the object is inside the camera
  frustum, so the user never sees a jump. The lone exception is the **one-time
  initial placement** of a `skipBootstrap` anchor: it is `anchored` from frame
  one but its `object3D` sits at the AR origin ("inside the user") until its
  first commit, which must land even on-screen so the marker can leave the
  origin (the AnchorStarter `?show=` reveal). That exemption is consumed by the
  first committed correction and **never re-armed** (a re-bootstrap moves an
  already-placed object). The earlier **large-jump bypass** (which overrode the
  frustum gate on a >2°/4 m/20 m alignment-matrix delta) was **removed**: now
  that the whole frame rides one lerped `arWorldGroup.matrix`, a large jump is
  absorbed smoothly for the entire view, so a per-anchor on-screen snap only
  manufactured the AnchorStarter cache-hit hard-jump — see
  `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-06-1210-anchor-starter-cachehit-jump-investigation.md`.

## Examples

```ts
import { createGpsAnchor } from 'gps-plus-slam-app-framework/visualization';

const anchor = createGpsAnchor({
  object3D: myMesh,
  arWorldGroup,
  camera,
  gpsPoint: { lat: 48.0, lon: 11.0 }, // seed
  getAlignmentMatrix: () => store.getState().gpsData.alignmentMatrix,
  getGpsZeroRef: () => store.getState().gpsData.zero,
  getCurrentGpsPoint: () => store.getState().gpsData.latest?.position ?? null,
  mode: 'snap-when-offscreen',
});

// Later, on user drag or re-survey:
anchor.markMovedExternally();
```

## Tests

See [gps-anchor.test.ts](gps-anchor.test.ts). Coverage:

- Bootstrap (sub-step 2):
  - Initial phase + `isFullyAnchored`.
  - `skipBootstrap: true` short-circuit.
  - 1 Hz sampling and median commit at the configured count.
  - Median robustness against a single outlier.
  - `settlingSeconds` window correctly suppresses sampling.
  - `null` GPS reading: tick is skipped, not counted as a sample.
  - `markMovedExternally` resets the buffer and re-bootstraps.
  - `dispose` unregisters from the frame loop.
  - Nested-anchor detection throws.
  - Sub-1 `secondsToAccumulateGpsPose` (`0`, `-1`) throws, and the
    failed construction does not leave the object3D registered.
- Steady state — `'snap-every-tick'` (sub-step 3):
  - NUE target committed on the first tick after bootstrap.
  - No position writes while still in the bootstrap phase.
  - `setGpsPoint` triggers re-commit past the threshold gate.
  - Sub-threshold delta does NOT commit.
  - Distance-scaled threshold: same delta commits up close, skips far
    away.
  - `null` `zeroRef` suppresses the commit.
- Steady state — `'snap-when-offscreen'` (sub-step 4):
  - On-screen object: no commit even when threshold gate would allow
    — including when a large alignment-matrix jump arrives (regression
    for the AnchorStarter `?show=` cache-hit hard-jump).
  - First commit of a `skipBootstrap` anchor places it even while
    on-screen (the one-time initial-placement exemption).
  - Off-screen object: a later steady-state correction commits.
- Re-bootstrap on external move (sub-step 5):
  - No position writes while back in bootstrap; resumes with the
    new median target once re-anchored.
  - The on-screen initial-placement exemption is NOT re-armed after a
    re-bootstrap (the first post-rebootstrap correction is a normal
    frustum-gated snap).

- Alignment-frame correctness (bug doc):
  - Object reaches the correct **world** position under a non-trivial
    (rotated + translated) alignment — the `alignment⁻¹` mapping is
    applied, not skipped or doubled.
  - World position stays fixed as the alignment changes between ticks.
  - `null`/`undefined` alignment skips the commit (no NaN write).
  - The metre-scale distance threshold is preserved under a rigid
    alignment.
- Cross-consumer convention consistency (bug doc, Action item 3):
  - `createGpsAnchor` lands a GPS point at the same world position as a
    scene-root raw-NUE consumer (`sync-gps-anchored-meshes` /
    `gps-event-markers` raw GPS markers).
- Property-based (see
  [`gps-anchor.property.test.ts`](gps-anchor.property.test.ts)):
  - Anchored object world position is invariant under any rigid
    alignment matrix.
  - `inverse(M) ∘ M ≈ identity` for any generated rigid alignment.

## Related docs

- [port plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-13-gps-anchor-port-plan.md) —
  full design, sub-step list, test matrix.
- [`frustum-visibility.ts`](frustum-visibility.ts.md) — supplies
  `isObjectInCameraFrustum` for the upcoming `'snap-when-offscreen'`
  steady state.
- [`ar/frame-loop.ts`](../ar/frame-loop.ts.md) — the registry the
  anchor self-registers with.
- [`sync-gps-anchored-meshes.ts`](../../../GpsPlusSlamJs_RecorderApp/src/visualization/sync-gps-anchored-meshes.ts.md) —
  the bulk counterpart for many-spheres-one-geometry use cases.
