# demo.ts

## Purpose

Standalone demo entry (no store, no Three.js renderer): replays a recorded
walk top-down on a 2D canvas and shows each object's zone changing as the
playback position moves. The walk path is precomputed into
[demo-walk.json](demo-walk.json) so the page stays a few KB; three objects
are synthesized from that path (two pass-throughs, one near-miss) exactly as
the replay e2e does.

It is a thin _view_ of the pure machine: it calls the same
[`step()`](core/proximity-machine.ts.md) the app uses and only draws the
result, so the hysteresis claim is visible directly — a dot sitting on a ring
does not flicker between colours.

## Public API

None (side-effecting entry, loaded by [index.html](index.html)).

## Invariants & assumptions

- Purely a rendering shell around `step()` — it holds no zone logic of its
  own, so it cannot drift from what the app actually runs.
- `ZoneState` and the object shape are re-exported from
  [core/proximity-machine.ts](core/proximity-machine.ts.md), not duplicated.

## Examples

```bash
pnpm dev   # then open the proximity demo page
```

Scrub the timeline or hit play; each object shows an outer PREFETCH ring and
an inner ACTIVE ring, and its dot recolours (grey → amber → green) as the
playback position crosses them. The near-miss object only ever reaches
PREFETCHING (amber). Every crossing is listed in the transition log.

## Tests

None directly — this is a manually-run visual demo. The logic it renders is
covered by [core/proximity-machine.test.ts](core/proximity-machine.test.ts)
and [view/proximity-driver.test.ts](view/proximity-driver.test.ts).
