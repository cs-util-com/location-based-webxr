# nearby-targets.ts

## Purpose

The "nearby targets" kernel: which trackable targets (QR codes today; 2D
images, 3D objects and keyframes of another session later) are near enough
to be worth searching for, given the app's position series, its precision,
the AR pose series and the clock. A tracker that costs camera frames (the QR
detector, later an image or object tracker) asks it before each capture, so
far-away targets cost nothing.

Pure and stateless. The hysteresis is a scan back over the look-back H,
never a stored flag, so the consumer calls it per cadence tick and keeps
nothing between calls.

Deep import only: `gps-plus-slam-app-framework/ar/targets/nearby-targets`
(built per-file by `config/tsdown.config.ts`, a knip entry).

## Public API

- `nearbyTargets(input: NearbyInput): NearbyResult`
  - `input.targets`: `Target[]` with `key`, `kind`, `north`/`east`
    (GPS-world NUE, m), `accM` (null: `defaultTargetAccM`), `reachM` (how
    close counts as "at" it), an optional `alignmentGpsExtentM` (set for a
    heading-uncertain mint) and an optional `sighting`: where the DEVICE
    stood (the camera's odom-NUE position) when its tracker last saw the
    target in the current AR frame, never the target's own solved pose.
    The AR gate's radius is around that point.
  - `input.fixes`: `Fix[]` (`t`, `north`, `east`, `accM`), device fixes
    only, oldest first.
  - `input.newestFixAtMs`: the newest device fix time, or null.
  - `input.arPoses`: `ArPose[]` (`t`, `pos` odom-NUE, `device?`), oldest
    first.
  - `input.live`: `LivePose | null` (`t`, `north`, `east`, `ar` odom-NUE,
    `accM`).
  - `input.nowMs`, `input.params`.
  - Result: `{ state: 'gps' | 'dr' | 'unknown', open }`; `open` is
    `OpenTarget[]` (`key`, `distM`, `by: 'gps' | 'ar'`) sorted by distance,
    ties by key.
  - `RangeError` on bad params or a non-finite `nowMs` (caller bugs).
    Targets with a non-string key or a negative or non-finite `reachM` are
    skipped. A target with a non-finite position is not skipped: the GPS
    gate never opens it, its sighting still can. A non-positive or
    non-finite target accuracy reads as `defaultTargetAccM`.
- `timeSlot(nowMs, periodMs, n)`: which of `n` slots the clock is in,
  constant within a period; the period count is mixed (murmur3's 32-bit
  finaliser) before `mod n`, so a caller seeing only every m-th period
  still reaches every slot. A non-finite time gives 0; negative times stay
  in range. The price of having no cursor: a slot's revisit wait is
  geometric, mean n periods, P(wait > w) = (1 - 1/n)^w (n 3: more than 10
  periods about 1.7 % of the time), not a strict a, b, c turn.
- `firstIndexAtOrAfter(series, fromMs)`: binary search on a series sorted by
  `t` (no shared helper existed).
- `checkNearbyParams(p)`, `DEFAULT_NEARBY_PARAMS` (frozen).
- Types: `TargetKind`, `Target`, `Fix`, `ArPose`, `LivePose`,
  `NearbyParams`, `NearbyInput`, `OpenTarget`, `NearbyResult`.

## The rule

- **State.**
  - `'gps'`: the newest fix is within F of `nowMs` (either side: a stamp
    more than F ahead of the clock is not fresh) and `acc_fix` is at most
    the ceiling.
  - `'dr'`: otherwise, when a live pose with a finite AR position is
    present and a device AR sample exists at or before `newestFixAtMs` and
    within H (the dead-reckoning anchor: the newest such sample, the last
    stored of several at one time, not an exact time match, so a fix whose
    own odometry sample was gated out still anchors). A vote sample never
    anchors.
  - `'unknown'`: anything else, and whenever `acc_fix` is null or above the
    ceiling.
- **acc_fix**: the live pose's `accM` when positive and finite, else the
  newest fix's within H (an older fix is outside the kernel's memory).
- **The GPS gate** (states `'gps'` and `'dr'`): `s = hypot(acc, accTarget)`;
  the live sample adds `alpha x` the AR drift from the anchor to `live.ar`
  (none without an anchor or a finite `live.ar`).
  `R_enter = reachM + c x s`, `R_leave = f x R_enter + L`. Scanning the live
  sample first, then the fixes newest first within `nowMs - H`, the first
  decisive sample decides: inside its R_enter opens, outside its R_leave
  closes, the band between continues; reaching the end closes. `distM` is
  the distance of the newest judged sample.
- **The AR gate** (any state): a target with a sighting (the device's
  position when it saw the target) opens while the live AR pose is
  within `reachM + arMarginM + alpha x path`, where the path runs
  sighting, first AR sample after it, the samples on, then `live.ar`. The
  path counts DEVICE samples within H only: a lock's vote ring and its
  keep-alive's rings (about three per device fix for minutes after a lock)
  sit at the code's corners, and counted they would zig-zag the path
  camera, code, camera and hold a just-scanned code open far away.
- GPS gate first (`by: 'gps'`), else AR gate (`by: 'ar'`).

## Parameters (`DEFAULT_NEARBY_PARAMS`)

- `c` 1.5, `f` 1.3, `L` 5 m, `H` 60 000 ms, `F` 5 000 ms, `alpha` 0.03,
  `arMarginM` 1 m, `defaultTargetAccM` 5 m, `ceilingM` 25 m
  (`POSITION_PRECISION_CEILING_M`).
- `headingWideningK` 1: the widening for a target minted while its
  heading was uncertain (one that carries `alignmentGpsExtentM`). A
  positive widening `K x alignmentGpsExtentM` gives acc_target
  `max(accM, defaultTargetAccM) + widening`; a zero one (K 0 or an extent
  of 0) leaves the target unwidened, its own `accM` (or the default
  without one). 1 is the design's stated value ("plus the alignment GPS
  extent"); 0 and 0.5 are the cheaper settings worth sweeping. An extent
  that is not finite and >= 0 widens nothing. The kernel applies it, so
  every target kind widens the same way.

## Invariants and defensive measures

- **The H trim.** The position source hands the kernel only the samples
  within H, and the kernel caps itself at H whatever it is fed (the
  anchor, the fixes and the AR path all start at `nowMs - H`). Two
  consequences, pinned in `nearby-position.test.ts` and, for a caller
  handing the whole series, in `nearby-targets.test.ts`:
  - `'dr'` lasts at most H after the last fix: once the anchor sample
    leaves the window the state is `'unknown'`, never a stale `'dr'`.
  - The AR gate's path term for a sighting older than H only counts the
    straight step from the sighting to the first sample inside the window,
    so R_AR is narrower than the full walk would make it (a tighter gate,
    never a looser one).
- Order-free: the result depends on the target set, not its order.
- Monotone: a worse `acc_fix` or target accuracy never closes a target a
  better one opened (below the ceiling).
- No dwell rule: one sample inside R_enter opens at once.

## Examples

```ts
import {
  nearbyTargets,
  DEFAULT_NEARBY_PARAMS,
} from 'gps-plus-slam-app-framework/ar/targets/nearby-targets';

const r = nearbyTargets({
  targets,
  ...positionSource.position(Date.now()),
  nowMs: Date.now(),
  params: DEFAULT_NEARBY_PARAMS,
});
if (r.open.length > 0) captureFrame();
```

## Tests

- `nearby-targets.test.ts`:
  - the heading-uncertain widening (K 1, K 0 and an extent of 0 leave the
    target unwidened, a malformed extent at 15 m and 30 m);
  - the three states: F inclusive (exactly F old is `'gps'`), the
    codes-only input (vote samples plus a live pose and no device fix read
    `'unknown'`), the ceiling, a tracking restart;
  - the anchor: a gated-out fix sample, votes sharing a time, a vote at a
    later time, several device samples at one time (the last stored);
  - `acc_fix` per source, dead reckoning, the hysteresis band, H expiry,
    bad accuracies, ordering, the default target accuracy;
  - the AR gate: the path walked, vote rings that add nothing, a target
    without a position, the radius around the sighting point it is given
    (a contract example: the kernel cannot tell a camera position from a
    target pose, so the tracker wiring tests pin which one is passed), no
    live pose;
  - the H cap when handed the whole series ('dr', the AR path and the
    `acc_fix` fallback); a fix stamped more than F ahead of `nowMs` is
    not fresh;
  - no drift without a finite live AR position;
  - `timeSlot` (constant per period, every slot reached at strides 2 and
    3), `firstIndexAtOrAfter`, parameter validation.
- `nearby-targets.property.test.ts`: enter then band stays open, leave then
  band stays closed, band longer than H closes, monotone in both
  accuracies, never `'gps'` from one millisecond past F, invariant to
  target order; `timeSlot`'s revisit wait is geometric (each slot's share
  1/n, mean wait n, P(wait > w) = (1 - 1/n)^w at w 1, n and 10).
- See also [nearby-position.ts.md](nearby-position.ts.md) and the gate on
  top, [tracker-capture-gate.ts.md](tracker-capture-gate.ts.md).
