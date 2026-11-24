# tracker-capture-gate.ts

## Purpose

The generic tracker capture gate: per camera frame, whether any registered
tracker wants the frame, and for which of its targets. QR codes are the
first tracker; 2D images, 3D objects and keyframes of another session
register the same way once their trackers exist, without a change here.

A tracker searches at its in-gate rate while one of its targets is open
(the [nearby-targets kernel](nearby-targets.ts.md)), at its outside rate
while none is open, at its unknown rate while the kernel's state is
`'unknown'`, at its burst rate for a while after a hit, and at its in-gate
rate whenever it forces itself on. Named apart from `ar/capture-motion-gate`,
which judges blur, not nearness.

Deep import only: `gps-plus-slam-app-framework/ar/targets/tracker-capture-gate`
(built per-file by `config/tsdown.config.ts`, a knip entry).

## Public API

- `createTrackerCaptureGate(options): TrackerCaptureGate`
  - `options.position(nowMs)`: the kernel's position inputs within H
    (`createNearbyPositionSource(...).position`).
  - `options.params`: `NearbyParams`, default `DEFAULT_NEARBY_PARAMS`.
  - `options.captureIntervalMs`: the camera source's capture interval;
    each rate's slot is one interval wide.
  - `options.k`: the budget per route, default `DEFAULT_TRACKER_BUDGET_K`
    (3).
  - `RangeError` on a bad interval, `k` or params.
- `TrackerCaptureGate`
  - `register(tracker)`: returns its unregister (idempotent: a stale
    handle called again never removes a later registration of the same
    tracker); `RangeError`
    on a cadence value that is not finite and >= 0.
  - `wantsFrame(nowMs)`: true exactly when `kindsFor(nowMs)` is non-empty.
    Pass it as `startCameraFrameCapture`'s `wantsFrame`.
  - `kindsFor(nowMs)`: `FrameRoute[]` (`kind`, `targetIds`); `RangeError`
    on a non-finite `nowMs`.
- `TrackerRegistration`: `kind`, `targets()`, `cadence`, `isBusy()`,
  `lastHitAtMs()` (epoch ms, the gate's clock), `forceOn()`.
- `TrackerCadence`: `inGateHz`, `outsideHz`, `unknownHz`, `burstHz`
  (0 = off), `burstMs`.
- Types: `TrackerGateOptions`, `FrameRoute`; `DEFAULT_TRACKER_BUDGET_K`.

## The rule

- A busy tracker is skipped. With every tracker busy the call returns at
  once, before `position()` and the kernel.
- Per active tracker, one kernel call over its own targets; its rate is any
  of these that wants the frame:
  - the base rate: `inGateHz` when a target is open, else `unknownHz` in
    the kernel's `'unknown'` state, else `outsideHz`;
  - `burstHz` while `0 <= nowMs - lastHitAtMs() < burstMs` (a hit in the
    future opens nothing);
  - `inGateHz` while `forceOn()`.
  - When several want the frame, the fastest of them is the route's rate:
    its period drives the turn below, so a burst inside the slow rate's
    slot still turns per capture.
- **The slot:** a rate of `hz` wants the frame when
  `nowMs mod (1000 / hz) < captureIntervalMs`. A period at most one interval
  long wants every frame; 0 Hz never. The camera's veto does not consume
  its interval, so the first frame of a slot is captured at once and a
  1 Hz rate gives one capture per second. The slot is one capture
  interval wide: a frame source asking less often than once per interval
  (below 8 fps at 125 ms) can step over a slow rate's slot and skip that
  period.
- **The route's targets:** the open targets by distance, capped at k: the
  nearest `ceil(k / 2)` always, the rest of the budget in turn over the
  others (`timeSlot` over the route's rate's period). With none open, one
  target in turn by key order (none without targets). `timeSlot` mixes
  the period count before `mod n`, so captures of every second slot (a
  busy tracker, a slow camera) still reach every target; the turn is
  spread, not a strict a, b, c order.

## Invariants and defensive measures

- Stateless per call: the burst comes from the tracker's own last hit, so
  the gate holds no timer. Its one state is the registration list.
- Order-free over trackers: each tracker's decision reads only its own
  registration and the shared position, so a second kind never changes the
  first kind's routes.
- Costs: the position source is memoised per `gpsEvents` reference and
  hands over only the samples within H; its `alignment()` and `zero()`
  must return stable references (store selectors do), or it rebuilds per
  call.

## Parameters

- k 3, the budget (swept later with the image tracker: 1 / 3 / 5).
- The cadence is each tracker's own. QR in the Tour Viewer: in gate at the
  capture interval (8 Hz), outside 1 Hz, unknown 1 Hz, burst 8 Hz for
  10 s.

## Examples

```ts
const gate = createTrackerCaptureGate({
  position: (nowMs) => positionSource.position(nowMs),
  captureIntervalMs: 125,
});
const off = gate.register({
  kind: 'qr',
  targets: () => codeTargets(),
  cadence: {
    inGateHz: 8,
    outsideHz: 1,
    unknownHz: 1,
    burstHz: 8,
    burstMs: 10_000,
  },
  isBusy: () => controller.isBusy(),
  lastHitAtMs: () => newestDetectionMs(),
  forceOn: () => false,
});
startCameraFrameCapture({
  intervalMs: 125,
  wantsFrame: () => gate.wantsFrame(Date.now()),
});
```

## Tests

- `tracker-capture-gate.test.ts`: captures per state (in gate every
  interval, about 1 Hz outside and when unknown, through a simulated
  camera source), the routes (open codes, one code per slot in turn, every
  code reached when only every second slot is captured),
  the burst and a future hit, a burst in the slow rate's slot turning on
  the burst period, `forceOn()`, busy vetoes, unregister and a stale
  unregister after a re-register, 0 Hz
  and fast rates, validation; a fake `image` tracker (2 Hz in gate, off
  outside) beside QR: its own cadence and capped targets, QR's routes
  unchanged; the clock-free cost tests (every tracker busy: neither the
  position nor the kernel runs, a spy; one series read per `gpsEvents`
  reference; only the 61 samples within H of a 3 600-fix session reach
  the kernel).
- `tracker-capture-gate.property.test.ts`: `wantsFrame` is true exactly
  when `kindsFor` is non-empty; a busy tracker never gets a route; no
  route exceeds k.
- `tracker-capture-gate.bench.ts` (opt-in, `pnpm bench`): prints the
  `wantsFrame` median for 100 targets and a 1 h session; asserts nothing
  (read against 0.1 ms).
- See also [nearby-position.ts.md](nearby-position.ts.md).
