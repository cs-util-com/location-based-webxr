# `src/agent-follower.ts`

## Purpose

Moves the agent as a body with mass rather than as a point glued to the
polyline (DEC-R13-3 … DEC-R13-5, DEC-R13-14). The path stays exact; the motion
is smoothed.

## Public API

- `Follower` — `{ position: ScenePoint, velocity: ScenePoint }`.
- `followerAt(position) → Follower` — standing still.
- `stepFollower(follower, target, dtS, smoothTimeS?) → Follower`.
- `followerSettled(follower, target) → boolean`.
- `FOLLOWER_SMOOTH_TIME_S = 0.25` — **the tunable**.
- `FOLLOWER_MAX_DEVIATION_M = 3.54` — the corridor half-width.

## What the session asked for

The drawn route is exact and should stay exact ("den exakten Pfad … finde ich
sehr gut"), but the figure sliding exactly along it makes every hex vertex a
hard direction change. The path should be a **reference curve**, with the
movement led smoothly along an averaged one — "vielleicht sogar mit so einem
typischen, physikbasierten, inertiabasierten Lerping … da hat er dann quasi so
eine Masse und eine Geschwindigkeit".

So the path position is a moving target and the agent accelerates towards it.
The zigzag lives in the drawn line and not in the motion (DEC-R13-3: drawing the
smoothed curve instead would look finished and destroy the view of what the
planner actually chose, which is the thing the session was diagnosing).

## Invariants & assumptions

- **Critically damped, not clamped** (DEC-R13-5). The rejected alternative was
  clamping the smoothed position back inside the routed cells: guaranteed by
  construction, and visible as the agent hugging a wall at a tight corner. Tuning
  carries the invariant instead, so the invariant is a property test rather than
  a comment.
- **The corridor claim is bounded at the shipped speed** (DEC-R13-14). Critical
  damping bounds overshoot past a **stationary** target; against a **moving** one
  a lagging follower always cuts the inside of a corner, and the cut grows
  without bound with speed. "At any speed" would be false by construction rather
  than untuned, so speed is held and named while corner angle, corner count,
  segment length and step size are all quantified.
- **Stable at any step size.** The integration is the closed-form critically
  damped step, not `velocity += (target - position) * k * dt` — the naive form
  explodes when `dt` is large, which is exactly what a backgrounded tab hands
  back on its first frame. Here a large `dt` simply arrives, which is the right
  answer for "the tab was hidden for two seconds", and it is what makes the
  corridor property frame-rate independent rather than true at 60 Hz.
- **`dt <= 0` or non-finite returns the follower unchanged.** A clock that goes
  backwards is not hypothetical (bfcache, a paused and resumed rAF, a test that
  rewinds), and it is the same defence `route-path.ts` makes on its own side.
- **A non-finite target is refused, not chased.** The target comes from
  `pointAlong` over worker-supplied geometry, and one `NaN` reaching the
  integrator poisons the velocity permanently: the agent would never move again,
  with nothing on screen to say why.
- **Arrival needs BOTH halves.** `pointAlong` reports `done` when the path is
  consumed, but the body is ~2.4 m behind at that moment — that gap is the
  smoothing. `building-view.ts` keeps requesting frames until `followerSettled`
  as well, or the agent would freeze short of its destination with the drawn line
  ending somewhere it never reached. The velocity term in `followerSettled` is
  what stops a near-miss position reading as arrival while the body still moves.
  - This preserves DEC-R11-15: `advanceWalk` returning `false` still means
    "nothing is moving", which is the only thing that lets the scene go quiet.
    A follower that approached asymptotically and never settled would be a
    permanent rAF loop — measured at ~6x slower e2e with one test into a timeout.

## The two numbers, and why there are two tests for them

Measured at `FOLLOWER_SMOOTH_TIME_S = 0.25` and `AGENT_SPEED_MPS = 10`, on a long
approach into a 60° hex corner: **2.42 m of along-track lag, 0.56 m of corner
cut**.

`FOLLOWER_MAX_DEVIATION_M` is a res-13 cell's inradius (edge 4.09 m →
4.09·√3/2 = 3.54 m). A point within one inradius of the line joining two adjacent
cell centres is inside one of the two cells the planner actually cleared — so it
expresses "the corridor the route was planned through" as a distance a test can
evaluate, which nothing in the codebase had an object for.

**That safety bound is six times the shipped cut, so the property stays green
through a four-fold mis-tuning.** That is correct for a safety invariant and
useless as a guard on the number, which is why the tuning gets its own unit case
bracketing both figures. Mutation-checked: doubling `FOLLOWER_SMOOTH_TIME_S`
fails the tuning test (1.15 m > 0.8 m) while the property still passes.

Raising `FOLLOWER_SMOOTH_TIME_S` means re-running both, not just watching the
demo.

## Examples

```ts
// Per frame, in building-view.ts:
const at = pointAlong(walk.path, walkedM); // unchanged, still the exact path
walk.follower = stepFollower(walk.follower, at.point, (now - last) / 1000);
agent.position.set(walk.follower.position.x /* … */);
if (at.done && followerSettled(walk.follower, at.point)) endWalk();
```

## Tests

`agent-follower.test.ts`: monotone convergence to a stationary target and never
crossing to its far side (the two halves of "no overshoot"); on the line itself
along a straight run, stated as perpendicular distance because a follower always
lags ALONG the path and that lag is what buys the corner smoothing; the corner
cut is shorter than the polyline but longer than the chord, so it rounds the
corner rather than skipping it; **the shipped lag and cut bracketed**; the same
resting place at 144 Hz and at 20 Hz; `dt <= 0` and non-finite `dt` and target
ignored; `followerSettled` false while approaching, true on arrival, and prompt.

`agent-follower.property.test.ts`: **the one that decides whether DEC-R13-5
survives** — over generated hex-corner polylines and step sizes from 1/240 s to
1/15 s, the follower never strays further than `FOLLOWER_MAX_DEVIATION_M`, and it
does reach the end. Committed at 1 000 runs; the loop accumulates the worst deviation and asserts once, because an `expect` per step made it pass alone and time out under full-suite load.

Note when reading a failure: fast-check reports the **shrunk minimal**
counterexample, not the worst case. A reported deviation of 1.6 mm against a
1 mm bound does not mean the real maximum is 1.6 mm — it means the smallest
failing case is. Measure the maximum directly if that is the question.
