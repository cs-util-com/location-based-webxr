# `ar-descent.ts`

## Purpose

The AR entry fly-down (H5, round four Q5): the session starts at the height the
user was already looking from in the 3D view, holds, then eases to ground while
the camera feed fades in.

## Public API

- `descentOffsetM({ elapsedS, startM }): number` — the descent's contribution to
  the elevation composition, metres.
- `cameraFadeAlpha({ elapsedS, startM }): number` — the camera feed's opacity,
  `[0,1]`; 0 = passthrough hidden, 1 = fully visible.
- `descentComplete({ elapsedS, startM }): boolean` — the end-state signal.
- `DESCENT_HOLD_S = 2`, `DESCENT_FALL_S = 4`, `DESCENT_MAX_START_M = 100`.

## Invariants & assumptions

- **The descent is a THIRD TERM in `composeElevationM`, never its own write.**
  `applyElevation` SETS rather than accumulates, and the frame loop re-applies
  the composition whenever the eased auto value moves — so a descent written the
  obvious way is **clobbered** within a frame or two rather than merely
  contended with.
- **It lands at exactly 0**, not approximately: this term is added to the applied
  elevation for the rest of the session, so a residual millimetre is a permanent
  offset on the whole city.
- **Zero slope at both ends** (smoothstep). A linear ramp starts and stops
  abruptly, which at arm's length looks like the scene was dropped.
- **`DESCENT_MAX_START_M` is at or below `NUDGE_LIMIT_M`, and that is a real
  constraint** — it was 120 against a nudge reach of 100 until a test caught it.
  If the descent may begin above what the manual nudge can reach, an
  **interrupted** descent leaves the user unable to walk the scene back down by
  hand: the unrecoverable state the nudge's limit exists to prevent, arriving by
  a route that limit was not written for. Asserted in `elevation-nudge.test.ts`.
- **An automatic move gets the tighter bound**, deliberately: the user did not
  ask for this height and has not been given a reason to expect it.
- **Every non-finite or negative input collapses to 0** — "no descent" — rather
  than propagating. This value is added to the position the city is drawn at, and
  a `NaN` there raises no error anywhere; the failure reads as "AR is empty",
  indistinguishable from several other causes.
- **A zero start is no descent at all**, not a zero-length animation: AR entered
  from a ground-level 3D view behaves exactly as it did before this feature,
  camera visible at once.

## The clock, and the trap in it

`ar-mode` starts the descent on the **first frame**, not at `startArMode`.
`elapsed` is PAGE-relative — a session entered thirty seconds after load sees its
first frame at `elapsed ≈ 30` — so anchoring to 0 would make the hold and the
fall both already over before a single frame ran, and the feature would silently
do nothing on any page that had been open a while.

## The camera fade

Driven by the same clock as the descent, so the two cannot drift apart: a camera
that finished fading before the city landed would show the real world with a city
still floating above it, which is the datum-bug picture.

Rendered via `renderer.setClearAlpha` rather than a backdrop mesh (DEC-Y3): AR
entry sets `scene.background = null`, and on that path the clear uses the
renderer's own `clearColor`/`clearAlpha`, both animatable, with the framework's
renderer already built `alpha: true`. One number, no geometry, no render-order
discipline, no backdrop that could occlude content. A backdrop mesh is the
fallback if this does not composite as expected on device; both fail identically
on an additive-blend display, so that caveat does not choose between them.

## Tests

`ar-descent.test.ts` — the curve: the hold, the exact landing, zero slope at both
ends, monotonicity, the cap, the all-inputs finiteness property, and the
zero-start contract. Plus `cameraFadeAlpha`'s endpoints and its `[0,1]` bound.

`ar-mode.test.ts` → "the AR entry fly-down (H5, Q5)" — the wiring: that the term
reaches `attachContentTo` composed, that a ground-level view changes nothing,
that the fade is driven, and that the landing is announced exactly once.

Both blocks are **mutation-verified**: a descent that never lands fails three
wiring tests including the landing signal, and one that never lifts fails three
others.

One note for anyone tightening `descentOffsetM`: given the smoothstep curve and
a 1/60 s step, `if (t >= 1) return 0;` is **unreachable from the frame loop** —
`1 - smoothstep(t)` underflows to exactly 0 a frame earlier, so the descent
reports complete first. The branch is still correct and still needed for a
caller that skips frames, and `ar-descent.test.ts` covers it directly. Do not
read a surviving mutation on that line as a coverage gap; see
`GpsPlusSlamJs_Docs/docs/2026-08-20-1055-descent-wiring-test-survives-a-stall-mutation-followup.md`.
