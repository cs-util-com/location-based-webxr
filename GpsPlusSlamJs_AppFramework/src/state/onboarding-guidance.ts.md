# `onboarding-guidance.ts` — onboarding coaching seam

## Purpose

Turns a `TrackingQualityReport` (or `null` when none exists yet) into a
compact, user-facing "what should I do next?" instruction for first-time
AR+GPS users. It is the onboarding-flavoured sibling of the recorder's
expert tracking-quality HUD.

Companion of [tracking-quality.ts.md](./tracking-quality.ts.md) (the report producer).

## Public API

- `computeOnboardingGuidance(report: TrackingQualityReport | null): OnboardingGuidance`
  — pure function. Never throws; a `null` or unknown state degrades to the
  `initializing` phase.
- `selectOnboardingGuidance(state: CombinedRootState): OnboardingGuidance`
  — thin store-bound wrapper = `computeOnboardingGuidance(selectTrackingQuality(state))`.
- `OnboardingPhase` = `'initializing' | 'ar-lost' | 'move-around' | 'almost-ready' | 'ready'`.
- `OnboardingGuidance` = `{ phase, percentReady, hint }`.

### State → guidance mapping

- `null` report → `initializing`, `percentReady = 0`.
- `ar-lost` → `ar-lost`, `percentReady = 0`.
- `warming-up` → `move-around`, `percentReady = clamp01(coverage) * 0.6`.
- `degraded` → `almost-ready`, `percentReady = 0.6 + clamp01(confidence) * 0.3`.
- `ok` → `ready`, `percentReady = 1`.

### The hints (copy)

One `HINTS` entry per phase, shown verbatim by the apps that coach through
this seam (the Tour Viewer's coach card for `initializing`, `move-around`,
`almost-ready` and `ar-lost`; the Anchor Starter). The copy uses a plain
spaced hyphen, never an em dash (2026-10-21), e.g.
`Tracking lost - slowly look around to let it recover.`

## Invariants & assumptions

- `percentReady` is always in `[0, 1]` (inputs are clamped; `NaN` → 0).
- Strictly ordered across phases: `initializing` = `ar-lost` ≤ `move-around`
  (≤ 0.6) ≤ `almost-ready` (0.6..0.9) ≤ `ready` (1.0). A progress meter
  driven by `percentReady` therefore never regresses as alignment advances.
- Within `move-around` it is monotonic in `subScores.coverage`; within
  `almost-ready` it is monotonic in `confidence`.
- Reads only `state`, `confidence`, and `subScores.coverage` from the report.

## Examples

```ts
import {
  computeOnboardingGuidance,
  selectTrackingQuality,
} from 'gps-plus-slam-app-framework/state';

const guidance = computeOnboardingGuidance(
  selectTrackingQuality(store.getState())
);
// guidance.phase === 'move-around', guidance.percentReady ∈ [0, 0.6], guidance.hint = "Walk around …"
```

## Tests

- [onboarding-guidance.test.ts](./onboarding-guidance.test.ts) — per-state
  mapping, null handling, clamping, cross-state ordering, distinct hints,
  no em dash in any phase's hint, the starting and the lost hints pinned.
- [onboarding-guidance.property.test.ts](./onboarding-guidance.property.test.ts)
  — `percentReady ∈ [0,1]` for arbitrary inputs, warm-up never reaches the
  degraded band, monotonicity in coverage/confidence, `ready` always 1.
