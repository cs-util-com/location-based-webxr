# `scene-anchor.ts` — where the ENU origin sits, and when it moves

**Purpose.** Decide the origin of the scene's ENU frame, given where the scene
is anchored now and where the user is.

## Why this exists

The demo derived its ENU origin from the user's **current position on every
publish**, so every vertex in the scene moved whenever the user did. The AR
framework's origin is the opposite: `setZeroPos` sets `zero` once per session
and never again (`GpsPlusSlamJs/src/state/gpsDataSlice.ts`), and every GPS
observation is stored relative to it.

Those two cannot share a scene. OSM geometry dropped into AR would shift
wholesale on every refresh while the AR content stayed put — not a rendering
artefact, but the two subsystems disagreeing about what the numbers mean.

So the origin became a property of the **scene**, not of the current position.

## Two rules, because two things move the user

- **A declared place change re-anchors unconditionally.** Choosing a site is a
  discontinuity, not travel. The picker spans Cologne to Tokyo — ~9 000 km —
  where the frame's fixed longitude scale is wrong by ~29 % (`cos 50.94° = 0.630`
  against `cos 35.69° = 0.812`), so the city would be **sheared into
  unrecognisable geometry**, not merely offset.
- **Ordinary navigation re-anchors only past `REANCHOR_THRESHOLD_M`.** A step, a
  drag or a locate keeps the origin, which is the entire point of the change.

A re-anchor means the caller rebuilds the scene wholesale — which is exactly the
pre-existing behaviour, and therefore already known to work.

## Public API

- `REANCHOR_THRESHOLD_M = 5_000`
- `AnchorDecision` — `{ origin, reanchored }`
- `AnchorOptions` — `{ declared?, frozen? }`
- `nextAnchor(current, position, options?) => AnchorDecision` — the rule, pure.
- `AnchorHolder` — `{ origin, advance(position, options?) }`
- `createAnchorHolder(start) => AnchorHolder` — the rule, held for a session.

## Why there is a holder as well as a pure rule

A position change drives **three** consumers of the frame — the camera pivot, the
terrain load and the refresh — and the refresh runs **last**. While the refresh
owned the anchor decision, the other two necessarily read the **outgoing** value
whenever the anchor moved:

- After a Cologne → Tokyo pick the camera pivoted on a frame ~9 000 km from the
  scene it was looking at.
- A terrain load threaded through the same value would have sampled the ground in
  a frame the buildings no longer used.

Ordering the statements in `main.ts` carefully fixes that once. **One decision
point that every consumer reads afterwards fixes it structurally** — and this
codebase has now watched the "consumers of the frame move together" constraint be
violated three times by being written into a plan rather than enforced by a seam.

So `main.ts` calls `advance` exactly once, at the top of the position subscriber,
and everything downstream reads `origin`.

## The threshold, and which error it actually bounds (DEC-R11-7)

**5 km** — the conservative end of the owner's ~5–10 km range. It never fires
during a walk or a normal map drag, and halves the worst-case distortion against
the 10 km end.

**The bounded error is NOT float32.** That term is negligible: spacing is about
`magnitude × 1.2e-7`, so a fraction of a millimetre across the demo's whole
2.4 km extent. The binding term is the **equirectangular approximation** in
`enuFrameAt`, which fixes the longitude scale at the origin's latitude — the
easting error grows as roughly `tan(φ₀)·Δφ`:

- 2.4 km → ~1 m
- 10 km → ~19 m
- 100 km → ~1.9 km

**That figure is against true geodesy, not against the AR content.** The
framework's own `calcRelativeCoordsInMeters` makes the _identical_
approximation with the same fixed cosine, so both subsystems are wrong in
precisely the same way — which is what makes them agree with each other, the
entire point of sharing an origin. Locally the residual is a scale error of
~0.2 % at a 10 km offset: roughly half a metre across a city block, against OSM
data accurate to about a metre.

What the figure _does_ still bind is registration against the real world through
SLAM, which is a separate concern.

## Invariants

- **`undefined` current adopts the position**, reporting `reanchored: true`.
  That is the first call of a session, and it must produce an anchor rather than
  compare against nothing.
- **`declared` ignores the distance entirely.** It is a statement about the kind
  of change, not its size.
- **Under AR, pass `frozen: true` — and that is NOT the same as leaving
  `declared` unset** (plan §2.4, AR milestone 3). AR never sets `declared`, so
  the origin looks safe already; but `nextAnchor` re-anchors on **distance**
  independently past `REANCHOR_THRESHOLD_M`, so a long walk or one wild fix
  moves the frame under a live session with nothing in AR's code having asked
  for it. The framework's `zero` is immutable, so a scene frame that moves and a
  GPS frame that does not are two disagreeing origins — the exact disagreement
  this module removes — and the city jumps by kilometres.
  - **`frozen` beats `declared`.** The site picker stays reachable while AR runs
    (DEC-12 keeps the map), and honouring a picker jump would move the scene
    frame away from a `zero` that cannot follow. The user's route to a new
    origin is to RELOAD the page there — leaving AR and re-entering does not do
    it, because `setZeroPos` is a no-op once set and a new session re-reads the
    same `zero` (r509 review corrected the opposite claim here).
  - **It does not suppress the FIRST anchor.** `current === undefined` is a
    seed, not a re-anchor, and the holder is constructed before AR ever starts.
  - The suppression is decided in `nextAnchor` rather than at the call site,
    because a call site that has to remember is the failure mode this module
    exists to remove.
- **The holder is seeded, never empty.** `createAnchorHolder(start)` takes the
  resolved start position, because the demo has no GPS path and something — the
  initial terrain load — reads `origin` before any `advance` has happened.
- **A throw leaves the holder untouched.** `advance` assigns only after
  `nextAnchor` returns, so a non-finite position cannot produce a half-updated
  holder whose `origin` is `NaN`.

## Defensive behaviour

**A non-finite position throws.** `greatCircleDistance` returns `NaN` rather
than throwing, and `NaN > threshold` is false — so a plain comparison would keep
the old anchor while the bad value flowed on to become the basis of every vertex
in the scene. Failing loudly is the only visible option.

## Tests

`scene-anchor.test.ts` — steps and long walks keeping the anchor, the threshold
crossing, declared changes at any distance, the picker's real Cologne→Tokyo
span, an undeclared continent-scale move, the first call, and the non-finite
guard.

For `frozen`: the distance re-anchor refused, `declared` overruled, the first
anchor still adopted, and — the counterweight — ordinary behaviour unchanged
when it is absent or false, since a `frozen` that defaulted to true would
silently freeze the desktop map, where re-anchoring is correct and load-bearing.
That `main.ts` actually passes it is pinned by `ar-walk-wiring.test.ts`.

**Mutation-checked**, six of seven caught.

`createAnchorHolder` is covered separately: a declared advance is visible to
every later read (the ordering guarantee), a step leaves `origin` alone, the seed
is readable before any advance, the threshold still fires undeclared, and a
non-finite position throws without disturbing the held origin.

**What is NOT covered — the surviving mutation:** `>` against `>=` at exactly
`REANCHOR_THRESHOLD_M`. A great-circle distance never lands exactly on
5 000.000 m, so the two operators are indistinguishable and the boundary is
**unobservable**. An earlier test claimed to pin it and could not; it was
replaced by one that pins the threshold's _value_ (the crossing happens between
4 900 m and 5 100 m), which is what a unit mix-up or a silent rescale would
break.
