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
    close counts as "at" it) and an optional `sighting` (an AR pose in the
    current AR frame where it was last seen).
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
    Targets with a non-string key, non-finite position or a negative or
    non-finite `reachM` are skipped; a non-positive or non-finite target
    accuracy reads as `defaultTargetAccM`.
- `timeSlot(nowMs, periodMs, n)`: which of `n` rotating slots the clock is
  in; a non-finite time gives 0, negative times wrap.
- `firstIndexAtOrAfter(series, fromMs)`: binary search on a series sorted by
  `t` (no shared helper existed).
- `checkNearbyParams(p)`, `DEFAULT_NEARBY_PARAMS` (frozen).
- Types: `TargetKind`, `Target`, `Fix`, `ArPose`, `LivePose`,
  `NearbyParams`, `NearbyInput`, `OpenTarget`, `NearbyResult`.

## The rule

- **State.**
  - `'gps'`: the newest fix is at most F old and `acc_fix` is at most the
    ceiling.
  - `'dr'`: otherwise, when a live pose is present and a device AR sample
    exists at or before `newestFixAtMs` (the dead-reckoning anchor: the
    newest such sample, not an exact time match, so a fix whose own
    odometry sample was gated out, and several samples sharing one time,
    still anchor).
  - `'unknown'`: anything else, and whenever `acc_fix` is null or above the
    ceiling.
- **acc_fix**: the live pose's `accM` when positive and finite, else the
  newest fix's.
- **The GPS gate** (states `'gps'` and `'dr'`): `s = hypot(acc, accTarget)`;
  the live sample adds `alpha x` the AR drift from the anchor to `live.ar`.
  `R_enter = reachM + c x s`, `R_leave = f x R_enter + L`. Scanning the live
  sample first, then the fixes newest first within `nowMs - H`, the first
  decisive sample decides: inside its R_enter opens, outside its R_leave
  closes, the band between continues; reaching the end closes. `distM` is
  the distance of the newest judged sample.
- **The AR gate** (any state): a target with a sighting opens while the live
  AR pose is within `reachM + arMarginM + alpha x path`, where the path runs
  sighting, first AR sample after it, the samples on, then `live.ar`.
- GPS gate first (`by: 'gps'`), else AR gate (`by: 'ar'`).

## Parameters (`DEFAULT_NEARBY_PARAMS`)

- `c` 1.5, `f` 1.3, `L` 5 m, `H` 60 000 ms, `F` 5 000 ms, `alpha` 0.03,
  `arMarginM` 1 m, `defaultTargetAccM` 5 m, `ceilingM` 25 m
  (`POSITION_PRECISION_CEILING_M`).
- `headingUncertainExtentFactor` 1: the widening for a target minted while
  its heading was uncertain, as the factor on the mint's GPS extent
  (`accM + factor x alignmentGpsExtentM`). 1 is the design's stated value
  ("plus the alignment GPS extent"); 0 and 0.5 are the cheaper settings
  worth sweeping. The kernel never reads it: the caller that builds the
  `Target` list applies it, so every target kind widens the same way.

## Invariants and defensive measures

- **The H trim.** The position source hands the kernel only the samples
  within H, and the kernel scans no further. Two consequences, both pinned
  in `nearby-position.test.ts`:
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

- `nearby-targets.test.ts`: the three states (including the codes-only
  input: four vote samples per time plus a live pose and no device fix read
  `'unknown'`), the anchor cases (a gated-out fix sample, votes sharing a
  time), the ceiling, `acc_fix` per source, dead reckoning, the hysteresis
  band, H expiry, bad accuracies, ordering, the AR gate, `timeSlot`,
  `firstIndexAtOrAfter`, parameter validation.
- `nearby-targets.property.test.ts`: enter then band stays open, leave then
  band stays closed, band longer than H closes, monotone in both
  accuracies, never `'gps'` with fixes older than F, invariant to target
  order.
- See also [nearby-position.ts.md](nearby-position.ts.md) and the gate on
  top, [tracker-capture-gate.ts.md](tracker-capture-gate.ts.md).
