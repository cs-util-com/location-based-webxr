# Sun Lighting Real Data Adapter

Status: revised proposal after critical LLM review; repository inspected on 2026-09-15. This task revises documentation only. Commit, prototypes, production TDD and the standalone demo are subsequent stages. Task 1 recordings are not prerequisites for implementation.

## 1. Findings and GPS source

Paths below are relative to the repository root.

| Existing code | Relevant contract and consequence |
| --- | --- |
| `GpsPlusSlamJs_AppFramework/src/geo/sun-position.ts` | `calculateSunPosition(date, latitudeDeg, longitudeDeg): SunPositionResult` validates inputs and owns the SunCalc call and NUE conversion. Reuse it unchanged. |
| `GpsPlusSlamJs_AppFramework/src/visualization/visible-sun-disc.ts` | `update(directionNue, camera)` handles camera-relative placement, billboarding and visibility. Camera updates remain independent of astronomical updates. |
| `GpsPlusSlamJs_AppFramework/src/geo/sun-altitude-lighting.ts` | Pure `sunAltitudeToLighting(altitudeRad)` returns intensity, color and ambient level. This stays a downstream consumer. |
| `GpsPlusSlamJs_AppFramework/src/visualization/sun-shadow-rig.ts` | `update(directionNue, contentBounds?, lighting?)` accepts the core direction and optional lighting result. No adapter-specific rendering API is needed. |
| `GpsPlusSlamJs_AppFramework/src/sensors/gps.ts` | `GpsPosition` carries `lat`, `lon`, `timestamp`, accuracy and nullable auxiliary readings. `startGpsWatch` maps browser coordinates to this shape. It stops an existing module-level watch before starting another. |
| `GpsPlusSlamJs_AppFramework/src/ar/enable-gps-ar.ts` | `createEnableGpsArController().enable({ onGpsPosition, ... })` owns sensor startup/cleanup. Its state subscription reports lifecycle status, not GPS coordinates. |
| `GpsPlusSlamJs_MinimalExample/src/main.ts` | `onGpsPosition` fans out the same fix to local state and `gpsHandler`. Extend this composition pattern when integrating the adapter later. |
| `GpsPlusSlamJs_AnchorStarter/src/main.ts` | Similarly maintains `lastGps` from sensor callbacks; also has a cached-location path. A cached fallback should not silently become the adapter's live source. |
| `GpsPlusSlamJs_AppFramework/src/state/gps-event-coordinator.ts` | `createGpsPositionHandler` handles GPS/AR recording; `buildRawGpsPoint` maps `lat/lon` to `latitude/longitude` and preserves fix time. This recording pipeline is not required to calculate sunlight. |
| `GpsPlusSlamJs_AppFramework/src/state/tracking-slice.ts` | Holds AR pose/orientation and tracking lifecycle, not a general current geographic-location service. |

Use the real `GpsPosition` callback already obtained by the application through
the framework. Feed that same fix to the adapter, alongside existing handlers.
Do not call `navigator.geolocation` or start/stop a second GPS watch inside the
adapter. A GPS-only host may use framework `startGpsWatch` itself, with ownership
and permission handling kept at the host boundary.

### Demo inspection

- `GpsPlusSlamJs_SunPositionDemo/src/main.ts` passes form coordinates and a
  parsed date directly to the core.
- `GpsPlusSlamJs_VisibleSunDiscDemo/src/main.ts` calculates from a simulated
  date derived from a fixed epoch, then passes the direction to the disc.
- `GpsPlusSlamJs_SunShadowRigDemo/src/main.ts` uses editable coordinates/time
  and simulated advancement, then updates the rig.
- `GpsPlusSlamJs_SunAltitudeLightingDemo/src/main.ts` calculates the core state,
  derives lighting and passes direction plus lighting to the rig.

These establish the reusable interfaces, but their manual controls and local
date/time offset conversions are not a live clock implementation to copy.

## 2. Module location and boundaries

Proposed files:

- `GpsPlusSlamJs_AppFramework/src/geo/real-sun-data-adapter.ts`
- `GpsPlusSlamJs_AppFramework/src/geo/real-sun-data-adapter.test.ts`
- `GpsPlusSlamJs_AppFramework/src/geo/real-sun-data-adapter.ts.md`

Export the public factory/types from `src/geo/index.ts`; the root entry already
re-exports that barrel. Add the module to the explicit entry list in
`config/tsdown.config.ts` so the existing `./geo/*` package export actually has a
built file and declarations. No new dependency is needed.

Keep runtime dependencies limited to the core and, for subscriptions, existing
`createIsolatedRegistry`/logging utilities. Import `GpsPosition` as a type only.
No Three.js, Redux store, AR session, DOM, browser permission or sensor ownership.

## 3. Critical review and proposed public interface

The repository boundaries above remain justified. The original plan had three
material gaps: manual modes were reduced to test injection, paired replay inputs
could produce intermediate mismatched samples, and TDD skipped prototype
comparison. This revision addresses these without adding sensor or rendering
ownership.

The following is a candidate API for prototype evaluation. All prototypes share
the behavioral requirements; method spelling can change after comparison.

~~~ts
import type { GpsPosition } from '../sensors/gps.js';
import type { SunPositionResult } from './sun-position.js';

export type SunLocationSource =
  | { readonly mode: 'live' }
  | { readonly mode: 'fixed';
      readonly latitudeDeg: number;
      readonly longitudeDeg: number;
      readonly recordedAtMs?: number };

export type SunTimeSource =
  | { readonly mode: 'real' }
  | { readonly mode: 'fixed'; readonly instant: Date };

export interface SunInputSelection {
  readonly location: SunLocationSource;
  readonly time: SunTimeSource;
}

export interface RealSunSample {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly locationSource: 'live' | 'fixed';
  readonly timeSource: 'real' | 'fixed';
  /** Live/recorded location time; null for a manual location. */
  readonly locationTimestampMs: number | null;
  /** Absolute instant passed to the core, not publication wall time. */
  readonly sunTimeMs: number;
  readonly sun: SunPositionResult;
}

export type RealSunDataState =
  | { readonly status: 'waiting-for-location' }
  | { readonly status: 'ready'; readonly sample: RealSunSample }
  | { readonly status: 'invalid-input';
      readonly reason: 'location' | 'time' }
  | { readonly status: 'disposed' };

export interface RealSunDataAdapterOptions {
  /** Real-clock dependency; default: () => Date.now(). */
  readonly now?: () => number;
}

export interface RealSunDataAdapter {
  setGpsPosition(position: GpsPosition): RealSunDataState;
  /** Replace both source selections atomically; evaluate/publish once. */
  setInputs(selection: SunInputSelection): RealSunDataState;
  /** Change one source, preserving the other selection. */
  setLocationSource(source: SunLocationSource): RealSunDataState;
  setTimeSource(source: SunTimeSource): RealSunDataState;
  refresh(): RealSunDataState;
  getState(): RealSunDataState;
  /** Defensive copy, including a fresh Date for fixed time. */
  getInputs(): SunInputSelection;
  subscribe(listener: (state: RealSunDataState) => void): () => void;
  /** Clear cached live GPS only; preserve source selections. */
  clearLiveLocation(): void;
  dispose(): void;
}

export function createRealSunDataAdapter(
  options?: RealSunDataAdapterOptions,
): RealSunDataAdapter;
~~~

### Independent source selection

Defaults are live location and real time. Fixed modes are intentional public
features, usable without replacing dependencies or reconstructing the adapter.

| Location | Time | Effective input |
| --- | --- | --- |
| live | real | Latest framework GPS fix + current wall-clock instant |
| fixed | real | Explicit coordinates + current wall-clock instant |
| live | fixed | Latest framework GPS fix + explicit absolute instant |
| fixed | fixed | Explicit coordinates + explicit absolute instant; no GPS/clock needed |

- Setting either fixed source preserves the other source selection. Switching
  explicitly to live/real removes that override. Missing or invalid fixed input
  never silently falls back to live/real.
- Live fixes are cached while fixed location is selected, but do not recalculate
  or publish the fixed-location sample. Returning to live uses the newest cached
  valid fix, or reports waiting/invalid if none is usable.
- Fixed location works before GPS permission/acquisition. Live location waits
  for a fix; actual zero coordinates are valid and never used as a fallback.
- Changing a selected source or calling refresh evaluates once and publishes once
  when ready, even if values are unchanged. A live fix evaluates immediately only
  when live location is selected.
- Fixed time stays exactly fixed across refreshes; the real clock is not read.
  Returning to real time reads the clock immediately.
- setInputs replaces both selections before evaluating: one recorded
  location/instant pair produces one sample with no old/new intermediate mixture.
- clearLiveLocation clears the live cache and live-input error. In live mode it
  publishes waiting; in fixed mode it leaves the effective sample alone.
  Full session reset disposes and recreates the adapter with defaults.
- Fixed values are retained only while selected. Remembering UI drafts across
  switches belongs to the host.

### Validation, snapshots and lifecycle

- Validate finite coordinates in the core's geographic ranges. Validate live
  timestamps and optional recordedAtMs as finite, Date-representable epoch
  milliseconds. Manual coordinates require no invented GPS timestamp.
- Invalid live input clears its cache and records a live-location error. Publish
  invalid location only if live is selected; fixed output is unaffected.
  A valid subsequent fix or clear recovers the live cache.
- Invalid fixed location/time is an explicitly invalid selected source until
  replaced. Do not reuse a previous ready sample or repair it through refresh.
- Invalid real-clock values publish invalid time without discarding location;
  a later valid clock recovers. With no live fix, report waiting without reading
  the clock. Location invalidity takes precedence over time invalidity.
- Missing altitude/heading/speed and accuracy do not gate sunlight. Guard expected
  invalid inputs before calling the core; do not disguise programming errors as
  sensor failures.
- Copy input fields and capture Date.getTime() on input. Store fixed time as
  milliseconds: freezing a Date does not prevent setTime mutation. getInputs
  returns a fresh Date. Freeze published nested sample/sun snapshots.
- Subscribe follows the controller pattern: future publications only; getState
  provides initial state. Use createIsolatedRegistry for idempotent unsubscribe
  and listener exception isolation.
- Dispose publishes disposed once and clears listeners/live cache. Later
  mutators/refresh return disposed; clear/subscribe are no-ops. Retain only the
  last source selection for defensive getInputs inspection.
  Disposal never stops the host's shared GPS watch.
- No movement threshold, smoothing, hidden timer or new Redux slice.

## 4. Absolute time, UTC and host-owned refresh

The inspected framework uses Date.now() for absolute sensor/log timestamps
(sensors/absolute-orientation.ts, utils/logger.ts). No general injectable
calendar-clock service was found. state/replay-engine.ts distinguishes recorded
epoch timestamps from monotonic playback pacing.

Real mode reads now once per evaluation. Fixed mode snapshots the supplied Date's
epoch milliseconds. Both pass new Date(selectedInstantMs) directly to the core.
sunTimeMs records that instant. Location sample time is separate metadata and
never implicitly selects astronomical time.

Manual input boundary:

- Prefer explicitly labelled UTC ISO 8601 input, e.g. 2026-06-21T12:00:00Z.
  Numeric-offset ISO strings also represent absolute instants; equivalent
  instants must produce identical results.
- The adapter accepts Date, not ambiguous strings. The demo validates/parses at
  its boundary and rejects ISO text lacking a timezone offset.
- Do not parse datetime-local text as UTC or add/subtract getTimezoneOffset.
  Any future local-time editor needs an explicit timezone and daylight-saving
  ambiguity policy before adoption.
- A slider uses a defined UTC starting instant plus elapsed milliseconds and
  submits a fixed Date. Range and step are demo settings. Display timezone
  changes presentation only.
- Never use performance.now(), frame deltas or replay pacing time as epoch time.
  Real mode uses device wall time, without a network/GNSS synchronization promise.

The host calls refresh on a proposed 30-second interval in real mode and on
resume. It owns cancellation and sensor lifecycle. Fixed mode needs no periodic
refresh; manual edits publish immediately. Camera updates remain independent.

## 5. Core connection and future consumers

~~~text
framework GPS callback -> cached live fix ----+
explicit location selection ----------------+-> selected coordinates
real clock / explicit fixed Date -----------+-> selected absolute instant
    -> calculateSunPosition(new Date(instantMs), latitudeDeg, longitudeDeg)
    -> ready sample with source metadata and SunPositionResult
~~~

Call the existing core exactly once per ready evaluation. Do not import SunCalc
directly, reproduce angle math, normalize direction again or change axes.
Preserve negative altitude and isAboveHorizon; the adapter has no night policy.

Consumers use sample.sun.directionNue for the disc/rig and sample.sun.altitudeRad
for sunAltitudeToLighting. Camera placement and GPS-world NUE alignment remain
renderer concerns (+X North, +Y Up, +Z East). The adapter has no Three.js
dependency. Existing core/rendering components need no changes for this seam.

## 6. Required project workflow and decision gates

Production TDD must not start immediately after plan approval.

| Stage | Work/evidence required before moving on |
| --- | --- |
| A. Detailed plan | This existing PLAN.md defines behavior, boundaries, tests and prototype scope. |
| B. Critical LLM review and revision | Review API complexity, transitions, UTC and lifecycle; record findings and revise this same plan. This revision addresses the first review; resolve outstanding contract issues before prototypes. |
| C. Commit meaningful plan revisions | Commit the reviewed plan separately and record the baseline commit used by every prototype. Exclude unrelated workspace changes. |
| D. Independent throwaway prototypes | Generate 2–3 isolated variants from that same approved plan commit and shared scenarios. Each starts independently; no copying sibling implementations. |
| E. Run and compare | Execute shared scenarios and interact with each UI. Record code-quality/usability evidence, failures, tradeoffs and run commands; static review alone is insufficient. |
| F. Select reference | Choose a preferred prototype with reasons; record any resulting contract clarification here. The prototype remains reference only. |
| G. Separate production TDD | Implement the reusable framework module afresh through RED -> GREEN. Never rename, promote or copy a prototype into production. |
| H. Production unit validation | Complete the behavior matrix, typechecks, lint/cycle checks, unit suite and build/export verification. |
| I. Standalone demo | Build a dedicated adapter demo against the production public API; verify four modes and host cleanup. |
| J. Later replay e2e | When Task 1 outdoor recordings exist, validate recorded GPS/absolute time through production adapter and relevant consumers. |

This task performs review/revision only. Stage C remains a subsequent workflow
step; no commit, prototype or implementation is claimed in this revision.

## 7. Dedicated prototype strategy

Use separate disposable directories/checkouts outside production module paths,
with one folder per variant. Each receives the same approved plan, small
synthetic GPS/time fixture and scenario checklist. Reuse the existing core;
implement only the input seam and a tiny browser panel. Avoid the full AR stack,
shadow scene, recording loader and production packaging/infrastructure.

Each panel needs coordinates, UTC input/slider, independent source selectors and
effective coordinates, modes, UTC instant, angles/status readouts. A host harness
can forward the existing framework GPS callback for live runs. A clearly labelled
synthetic feed makes comparison repeatable without hardware; never label it GPS.

### Variants

1. **Explicit commands, immediate controls.** Explore the candidate stateful
   factory, per-source setters and atomic setInputs. Independent toggles apply
   immediately. Assess clarity and predictable validation during editing.
2. **Atomic configuration, draft/apply controls.** Expose complete selection
   updates plus GPS ingestion/refresh. Edit drafts and apply both sources at once.
   Assess smaller API surface against extra clicks and unapplied-state confusion.
3. **Pure resolution, thin host wrapper.** Resolve complete selected snapshots
   in a pure function; the wrapper owns caching/subscriptions. Use the same
   four-mode panel plus fixture stepping. Assess replay simplicity against extra
   host wiring, and demonstrate a reusable facade with consistent lifecycle
   rather than undocumented host responsibilities.

Build at least two; use the third if state/cache placement remains disputed.
These explore input ownership and interaction, not different solar calculations.

### Shared runs and comparison

Run each against the same script:

1. Start live/real without a fix; deliver a known fix.
2. Exercise four combinations; return to live after background fixes.
3. Edit coordinates and scrub UTC; inspect effective-source labels.
4. Enter invalid location/date and recover; verify no silent fallback.
5. Freeze time and refresh; advance fake real time and return to real.
6. Step synthetic recorded pairs forwards, backwards and repeatedly; verify
   atomic publication and no real-clock reads.
7. Clear live input, dispose/recreate and verify listener/timer cleanup.
8. Where available, test a real framework GPS callback on a suitable device;
   document hardware/permission limitations separately from synthetic passes.

Record commands, pass/fail results, screenshots or interaction notes and a small
comparison table. Code-quality criteria: dependency boundaries, duplicated
state/validation, atomicity, mutation protection, testability, lifecycle complexity
and required host code. Usability criteria: active-source recognition, switching
effort, UTC clarity, slider feedback, validation and recovery.

Correctness/boundary violations disqualify a variant regardless of appearance.
Select among passing variants using observed tradeoffs, not line count or a
preselected winner. Stage F produces a decision record and plan clarification.
Archive/discard scratch prototypes; start separate framework files with newly
written failing tests. Prototype shortcuts never define production acceptance.

## 8. Validation now and Task 1 replay later

Task 1 has not been completed; its recordings are needed only for stage J.

### Unit-testable now

Use colocated Vitest TypeScript tests following geo/sun-position.test.ts:

1. Defaults, waiting, zero/boundary coordinates and exact core delegation
   (date/latitude/longitude order, once per ready evaluation).
2. Four combinations and independent switching in both directions. Returning to
   real reads current time; returning to live uses the newest fix.
3. Background live caching under fixed mode; invalid background fixes cannot
   invalidate fixed output but affect later live selection.
4. Manual location without GPS metadata, selected source metadata, distinct
   locationTimestampMs and sunTimeMs.
5. Date snapshots, equivalent UTC/offset instants, fixed refresh stability and no
   real-clock reads in fixed mode.
6. Atomic pairs and synthetic replay repeated under different wall clocks:
   identical samples, backwards seeks, duplicate timestamps and repeated pairs.
7. Invalid coordinates, live/recorded timestamps and clock/Date values; precedence,
   no fallback, recovery and clear behavior.
8. Mutation protection, subscriptions, isolation, unsubscribe, disposal and
   independent instances without GPS, DOM or WebXR.
9. Fake framework callback fan-out to adapter and existing-handler spy without
   starting another watch.
10. Preserve all core fields including night. One unmocked core comparison,
    separate from delegation spies; no duplicate astronomy equations/tests.
11. Public imports and emitted declarations expose the settled contract.

Demo-boundary tests cover offset parsing, UTC slider conversion and input
feedback; these are separate from adapter unit tests.

### Demonstrable without Task 1

At their scheduled stages, prototypes and then the production standalone demo can
demonstrate four modes, real GPS where available, UTC scrubbing, waiting/invalid
states and synthetic sequence stepping. Synthetic fixtures validate the seam;
they do not constitute outdoor recording e2e evidence.

### Requires Task 1 later

A replay host maps recorded coordinates and epoch timestamps into atomic
fixed/fixed setInputs calls. recordedAtMs carries location sample time; the fixed
Date supplies the chosen recorded simulation instant. No live watch or real
clock participates. The host owns ordering, pause, speed, seek and interpolation;
speed changes pacing, not astronomical instants.

Default replay policy: use the latest recorded location at or before replay time,
without interpolation. Before the first location, reset to default waiting
without a live feed; do not carry a previous seek's fixed location forward.

Verify actual field mappings and timestamp units/domain when Task 1's format
exists; do not assume a schema now. Version real fixtures and expected behavior.
Cover repeat runs, pause/seek, gaps and route/time changes, then later consumer
wiring. Rendering tolerances/devices belong to the later e2e plan. A recording
loader is not part of this adapter.

## 9. Production TDD sequence: only after stages D–F

1. **RED:** default waiting and exact delegation tests.
   **GREEN:** minimal independent factory and framework-fix ingestion.
2. **RED:** four modes, independent switching, background cache and atomic pairs.
   **GREEN:** implement the settled source-selection contract.
3. **RED:** absolute time/Date snapshots, metadata, fixed refresh and synthetic
   replay determinism. **GREEN:** resolve instants without hidden clock reads or
   timezone adjustment.
4. **RED:** invalid-input precedence, recovery and clear.
   **GREEN:** validation and explicit unavailable states.
5. **RED:** mutation, subscriptions, instances and disposal.
   **GREEN:** immutable publication and existing registry-based lifecycle.
6. **RED:** callback wiring, unmocked core and public import checks.
   **GREEN:** complete wiring contract, geo barrel, explicit tsdown entry and
   module documentation; keep demo construction for stage I.
7. Refactor with tests green. Stage H runs focused tests, framework format check,
   lint, cycles, production/test typechecks, unit suite and build; inspect emitted
   files/declarations. Avoid test:core's broad auto-format side effect.

Write production tests from the settled contract rather than transplanting
prototype suites. No implementation tests need running for this plan revision.

## 10. Standalone demo scope (stage I)

Proposed home: GpsPlusSlamJs_RealSunDataAdapterDemo, confirmed against repository
demo/port conventions when that stage begins. Use the production public API.

- Start live GPS + real time with honest waiting/permission feedback.
- Provide independent live/fixed location and real/fixed time selectors.
- Offer coordinates and labelled UTC entry/slider. Editing time explicitly
  selects fixed mode; returning to real is explicit.
- Display effective sources, coordinates, UTC instant, location sample timestamp
  when available, altitude/azimuth, NUE direction and horizon flag.
- Keep sensor ownership, subscription disposal and real-mode interval cleanup in
  the host. Fixed/fixed works without permissions.
- Use prototype comparison to choose interaction. This standalone demo proves
  the adapter seam; a final combined disc/lighting/shadow demo remains separate.

## 11. Remaining questions and acceptance

Settled: raw framework GPS callback default, no adapter geolocation ownership,
core reuse, independent public overrides, absolute time, no rendering dependency,
host-owned scheduling and prototype comparison before production TDD. Task 1 is
not a prerequisite.

Open choices and proposed defaults:

- **Freshness/accuracy:** retain latest live fix until replacement/clear, without
  an age/accuracy gate; expose its timestamp. Resolve any requirement for a stale
  state before freezing the production API.
- **API/interaction:** compare setters versus atomic configuration and cache
  ownership through prototypes. Atomic paired updates and four modes are required
  regardless of final method names.
- **Refresh/control details:** start with 30 seconds in real mode; choose UTC
  slider range/step and immediate/apply behavior from prototype runs.
- **GPS errors:** stay host-owned. No fix means waiting; a prior fix remains until
  cleared. The enable controller has no GPS-error subscription; do not promise
  one. Richer status UI is a demo-stage decision.
- **Replay:** Task 1 schema, units, gaps and fixture tolerances remain unknown;
  resolve at stage J. Synthetic deterministic replay is available earlier.
- **Combined rendering:** AR parent/lifecycle and visual e2e tolerances remain
  later integration choices, not adapter blockers.

Acceptance: after prototype comparison, the separately TDD-built adapter uses
real GPS/current time by default, supports four independent source combinations
and exposes deterministic core sun state. The standalone demo demonstrates the
seam; Task 1 adds outdoor replay e2e evidence later.

### Revision changelog

- Added public overrides and atomic paired updates because clock injection alone
  did not support manual demos or coherent replay.
- Replaced calculatedAtMs with sunTimeMs and nullable location time metadata to
  distinguish astronomical time from execution time and manual inputs.
- Defined UTC/Date snapshots, switching, background GPS and error behavior to
  avoid timezone, mutation and silent-fallback bugs.
- Inserted the A–J workflow, independent disposable prototypes and run/comparison
  criteria before production TDD.
- Separated unit/synthetic checks, standalone demonstration and Task 1-dependent
  e2e; preserved the repository-grounded sensor/core/rendering boundaries.
