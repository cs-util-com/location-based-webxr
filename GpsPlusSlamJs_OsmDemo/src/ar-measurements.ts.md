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
order with all four present; and the order preserved with two missing.

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
