# `ar-measurements.ts`

## Purpose

The AR readout's numbers, formatted. Pure.

## Why milestone 4 needs an instrument before a measurement

§4 of the plan makes four predictions and says outright that they are stated so
they can be wrong in public. None can be checked from a desk: they need a phone,
in a street, showing its own numbers.

And the desktop status line's draw cost is the **wrong renderer**. The framework
builds a second `WebGLRenderer` for the session, `renderer.info` is per-renderer,
so the figure visible during AR described a renderer that was not producing the
frames. The plan names it: "Needs a draw-cost readout on the AR renderer, which
does not exist."

## Public API

- `ArMeasurements` — `{ drawCost?, fps?, fixAccuracyM?, metresFromAnchor?,
worldBaselineY? }`, every field optional and independent.
- `describeArMeasurements(m): readonly string[]` — one line per measurement that
  has a value, in a fixed order.

## Invariants & assumptions

- **A missing value is OMITTED, never rendered as zero.** "No fix accuracy yet"
  and "an accuracy of 0 m" are different claims and the second is impossible.
  The plan requires every unreachable figure to be "reported as unmeasured
  rather than estimated", and a readout that prints `0` breaks that rule at the
  last step — the number on the phone is what gets written down.
- **Non-finite is dropped, and it is not hypothetical.** `fps` is computed from
  `dt`, and the framework's frame contract says `dt` is 0 on the first frame
  after a reset, so `1/dt` is `Infinity`.
- **Lines, not a sentence**, unlike the desktop status line. Read at arm's
  length, outdoors, over a camera feed, by someone walking — and the reader is
  looking for one number, not an overview.
- **Fixed order**, so a glance always finds the same number in the same place. A
  readout that reorders as values appear has to be re-read each time.
- **Precision follows what the reader can act on**: a tenth of a metre below
  10 m of fix accuracy and none above (the interesting band is 4.5 versus 8 m;
  at 30 m the tenth is precision the fix does not have); metres under a
  kilometre from the anchor and kilometres above (the far-travel WARNING speaks
  in kilometres because it fires at 2 km — this line is live from the first
  step, where "0.0 km" says nothing).

## Examples

```ts
describeArMeasurements({ drawCost: { calls: 12, triangles: 1000 }, fps: 59.6 });
// ["12 draws / 1,000 tri", "60 fps"]
```

## Tests

`ar-measurements.test.ts` — empty in, empty out; the draw cost; a zero-call
cost omitted; `Infinity` and `NaN` fps dropped; both precision rules; the fixed
order with all four present; the order preserved with two missing; and the
terrain-line source suffix (primary share, fallback-only wording, composed-id
fallback when stats are absent or counted nothing).

The surface is [`ar-hud.ts`](ar-hud.ts.md); that `ar-mode.ts` actually samples
it, from the AR renderer, is pinned in `ar-mode.test.ts`.

## `worldBaselineY` — the axis both open questions live on

`arWorldGroup.matrix[13]`, the alignment's vertical term. §4 predicts "the
Y-baseline jump will be visible" and names this element; §2.5 asks how the DEM
relief and the session's own ground-plane estimate blend. Neither is answerable
from a photograph, and **neither was answerable at all until this number was on
screen** — a milestone called "measure, then choose" that could not see the axis
its own predictions are about would have shipped an instrument with a hole in it
(r510 review).

Two rules differ from the other fields, both deliberate:

- **It is not filtered on `>= 0`.** A negative baseline means the alignment has
  put the world _under_ the user, which is the failure being predicted — the
  sign is the information.
- **Centimetres.** The question is whether it JUMPS. A metre of drift across a
  walk is expected; ten centimetres between two glances is not, and whole metres
  would hide exactly that.

## `fps` is averaged, and the average is the caller's job

A single frame's `1/dt` spikes routinely on a phone — GC, a worker message, the
terrain field landing — so at a 2 Hz readout the reciprocal of one arbitrary
frame out of thirty flickers between plausible and alarming with no way to tell
a sustained drop from a hiccup. Telling those apart is exactly what §4's "is
rendering the constraint?" question needs. `ar-mode.ts` counts frames and
divides by the window `ArHud.sample` reports back; **the docstring here claimed
the averaging before it existed** (r510 review).

## The altitude readout

`altitudeM` and `altitudeAccuracyM` — the last fix's **raw reported** altitude and
vertical accuracy, before any alignment.

**Why it is on screen.** The field report is a ~10 m height offset, repeatable
across reloads. Two filed defects already account for it, one a library defect
where the vertical solve needs a single pair, runs **no outlier rejection** and
weights at `1/accuracy⁵` — so one bad fix owns `worldBaselineY`. With only the
aligned baseline visible, _"the GPS altitude is wrong"_ and _"the solve
mishandled a good altitude"_ look identical on screen. This is the term that
separates them, which is why the findings doc that diagnosed the residual ranked
it **ahead** of the manual offset buttons.

**It does NOT go through `isUsable`**, and that is deliberate. That guard's
`>= 0` is right for an accuracy or a frame rate and wrong for an altitude:
Schiphol, the Dead Sea and any basement are real places below zero, and reusing
it would silently drop the readings most likely to surprise. The accuracy half
still does use it — an accuracy below zero is impossible.

**Half a line beats none.** Vertical accuracy is optional in the Geolocation API
and Android commonly reports `null` even with a good altitude, so the altitude is
shown alone rather than suppressed for want of its error bar. An accuracy without
an altitude shows nothing at all — it would read as a measurement.

## The height decomposition (DEC-H1)

The readout's reason for existing, and the measurement that decides the
altitude-offset question: the ~10 m symptom has **two** candidate causes that
need **opposite** fixes.

- `terrainHeightM` — the DEM height under the user, **ellipsoidal** metres, so
  it is directly comparable to `altitudeM` with no conversion at the call site.
  In AR the field is sampled with `absoluteDatum: { undulationMetres: N }`, so
  `heightAt` returns orthometric + `N` rather than relief.
  - **A proxy for what the buildings stand on, not the same thing.** The
    buildings were extruded against the field the WORKER held at build time,
    baked into vertices; this is the main thread's current field. Normally
    identical, and their divergence is the class `worker/terrain-gate.ts`
    prevents. Labelled `terrain`, never "building ground".
- `demSourceId` — which DEM **composition** produced `terrainHeightM`, rendered
  as a suffix on the terrain line (`terrain 104.0 m · mapterhorn+terrarium`).
  The two composed sources differ by an order of magnitude in resolution
  (national LiDAR against ~30 m SRTM), so "which DEM" changes what counts as a
  residual — a screenshot without it cannot be checked against the right
  upstream. **Composed, never per-sample**: the `ElevationProvider` seam
  carries no per-position provenance, so this names what was asked, not which
  member answered a given post. See
  [`dem-provider.ts.md`](dem-provider.ts.md) for the composition and the
  filed follow-up before inventing per-sample tracking.
- `demStats` — which member of that composition actually **served**, as
  position counts (`{ primaryAnswered, fallbackAnswered, unanswered }`, the
  worker's snapshot of the provider's session-cumulative counters). **This
  exists so a field session can tell which DEM actually served**: on every
  other number a walk served by the ~30 m fallback reads identically to one
  standing on national LiDAR, and the residuals against the two differ by an
  order of magnitude. Rendered on the terrain line as the primary's share of
  answered posts — `terrain 104.0 m · mapterhorn 98%` — with two worded
  states: `· terrarium (fallback)` when the primary answered nothing (the one
  share that changes what the height means, so it must not be skimmable as a
  percentage), and the plain composed id when stats are absent, all-zero, or
  the id lacks the `primary+fallback` shape the names are derived from (the
  pre-stats behaviour, kept). The names come from splitting `demSourceId` at
  its first `+`, never from constants here, so the label can only describe
  the composition that produced the field.
- `terrainHasData` — **the most important flag in the interface.**
  `heightfieldFrom` samples **flat zero** when `hasData` is false, so a failed
  DEM load would otherwise render as a plausible `0.0 m` and a residual against
  it as a confident hundred-metre error. False suppresses both and prints
  `terrain: no DEM` — **and that warning shows even collapsed**, because a
  warning only visible when expanded is a warning nobody sees.
- **The residual, `above terrain ±X m`** — derived here rather than passed in.
  Chest height should read about **+1.5 m**; a steady **+10 m** is the reported
  symptom, stated instead of inferred from a scene that looks wrong. Its sign is
  the information: negative means the camera is under the ground, which is the
  state that makes buildings float overhead.
- **`auto ±X.X m (conf 0.NN[, low][, frozen]) · <dem label>`** — the published
  automatic elevation offset (`ar-elevation-auto.ts`:
  `baseline + robust(floor − DEM)`), shown even collapsed, right under the
  residual it pairs with.
  - **The serving DEM rides on this line too** (cold-review F7), via the same
    `demServingLabel` helper as the terrain line (e.g. `· mapterhorn 98%`):
    the offset is a correction against a SPECIFIC DEM, the terrain line that
    names it is expanded-only, and this line is in the collapsed walking set
    — without the suffix a walking screenshot shows a correction with no way
    to tell LiDAR from ~30 m SRTM. Absent id, absent suffix.
  - **The pair IS the instrument** (plan §2.6): `above terrain` is the RAW
    GPS-vs-DEM residual and is untouched by the offset; `auto` is the
    estimator's correction on the same axis. **Their difference exposes the
    fused-vertical error live** — and once auto engages, the city can look
    right while `above terrain` still reads +7 m, so the M5 field protocol
    must name which line means what.
  - **`low` means PUBLISHED BUT NOT APPLIED** (cold-review F1). The demo gates
    the auto contribution on `autoEngaged`; below the gate the estimator still
    reports a real measurement but the city does not carry it. Without the tag
    the line reads `auto +1.4 m (conf 0.12)` and a field observer hunts for a
    1.4 m correction that was never made, concluding the feature is broken.
    With no confidence to qualify it the tag reads `not applied` instead, and
    an ABSENT `autoEngaged` prints no tag at all — this module never invents a
    state it was not told about.
  - `frozen` names the freeze layer holding the offset while the user climbs
    man-made structure (tower/stairs/bridge) — the state the M5 tower walk
    watches for, visible nowhere else. Independent of `low`: both can show.
  - Absent whenever the estimator publishes nothing (cold start, kill switch
    `?autoElevation=off`, no alignment) — never `+0.0 m`, which would claim
    measured agreement.
- `geoidUndulationM` / `geoidModelId` — a **session constant** (`N` varies about
  1 m per 100 km). On screen only to make the `ZERO_GEOID` trap visible: with
  `N = 0` the whole scene is ~46 m out in central Europe and nothing else would
  say so.
- `position` — **the line that makes a screenshot falsifiable.** Without
  coordinates a screenshot cannot be checked against an external elevation
  service, returned to, or correlated with another. Six decimals ≈ 0.1 m.
- `fixAgeMs` — a stale fix and a fresh one are otherwise indistinguishable, and
  "the alignment drifted" is often "no fix for 40 s". Past `STALE_FIX_MS`
  (15 s) the line is promoted to the collapsed set and marked `— STALE`.
- `fusedBearingDeg` — **wired in `ar-mode.ts`**, from the camera's **world**
  direction. Per DEC-H6 it reads beside the library's compass bearing, because
  either line alone says nothing; the pair differing by tens of degrees is the
  diagnostic. ⚠️ Its caller must take the direction in **WORLD SPACE**. The
  hierarchy is `scene (GPS-world NUE) → arWorldGroup (receives the alignment) →
basisChangeNode → arpose → camera`, so the camera is a DESCENDANT of the
  aligned group and its world transform already carries the alignment; a
  direction taken _relative to_ `arWorldGroup` is in the un-aligned AR-odometry
  frame — the alignment's own domain — and is a plausible number that is not
  north. Use `ar-origin.ts`'s `nueBearingDeg`, which carries the axis
  convention and its tests, rather than an `atan2` at a call site.
  - **This bullet said the exact opposite until the PR #312 review**, and it was
    the fourth statement of the distinction and the last one still backwards —
    `ar-measurements.ts`, `ar-origin.ts` and `ar-mode.ts:498` had all been
    corrected. `ar-scene-hierarchy.ts` records two independent readers getting
    this frame backwards, so a sidecar restating the error was the likeliest way
    to produce a third.

## Collapsed and expanded (DEC-H2)

`describeArMeasurements(measurements, { expanded })` — **one list and one
boolean**, not two tiers. Two membership lists would need a test that one stays
a subset of the other; collapse/expand instead makes the expanded state _the
screenshot state_ rather than a mode someone has to remember to leave.

Collapsed is the walking set: draw cost, fps, fix accuracy, distance from
anchor, altitude, the residual, the auto offset, the baseline — **plus anything
degraded** (`terrain: no DEM`, a stale fix). Expanded adds terrain height,
geoid, position, fix age and the fused bearing.

`isSignedReading` is the counterpart to `isUsable` for values where a negative
is a real place or direction rather than an impossibility: terrain and altitude
(the Dead Sea, any basement) and the geoid undulation (about −30 m over India).
Routing those through `isUsable`'s `>= 0` guard would drop exactly the readings
that are most surprising.

## The DEM label under the race (2026-08-19)

`demStats` is now `{ servedBy, upgrades }` and the terrain/auto lines print
`servedBy` — the id of the source the CURRENT field came from.

It used to be three position counts, rendered as the primary's share
("mapterhorn 98%"). That share was only meaningful because `fallbackProvider`
guaranteed the two sources answered **disjoint** positions. Under the race both
answer every position, so the ratio stops partitioning anything and the
percentage becomes arithmetically **undefined**, not merely stale.

This matters more here than in most readouts: the AR overlay is read in the
field to judge whether an alignment looks right, and a confident wrong number
there is worse than a plain name. DEC-U6 accepted that AR upgrades silently with
no PER-POSITION attribution; a whole-field source name is not per-position and
is what remains honest.
