# Road drape chord error inverts the class order on curved ground (follow-up)

**Status: filed, NOT fixed (found in r1171 while measuring the end-disc
change).** On a curved hill the per-vertex drape of a road ribbon leaves the
ground by decimetres between vertices, which is about a hundred times the
5 mm class step, so the class order (a carriageway over a footway) holds in
only about half of every overlap there. The error predates the class order and
the r1171 change; no step value fixes it.

**Related docs**

- The builder: [`../src/mesh/roads.ts.md`](../src/mesh/roads.ts.md), "The
  decision and its numbers on the real code (r1171)", the drape bullet.
- [`2026-11-09-1241-road-class-order-ignores-bridge-and-layer-followup.md`](2026-11-09-1241-road-class-order-ignores-bridge-and-layer-followup.md)
  - the other way the class order is wrong today.
- `GpsPlusSlamJs_Docs/docs/2026-11-07-2315-city-objects-and-roofscape-into-library-plan.md`
  (primary repo) - M4a and the owner's depth decision (5 mm step, discs at
  their strip's height).

## What was measured

A CPU check, not a render: the heights a GPU would interpolate across each
road triangle (the ribbon's vertices sampled from the ground, linear in
between), against a heightfield that is barycentric on a 12 m triangle grid,
sampled every 25 cm over the overlap of two crossing ways. 150 random
placements (seed 777), steps 3, 5 and 8 mm, three cases (a service way's end disc
over the footway, the footway's end disc under the service way, two strips
crossing). Ground models:

- flat, and planes of 10 % and 25 %: the order holds everywhere; the smallest
  gap is the builder's own (3.2 mm at 5 mm after r1171).
- a hill (an 80 m Gaussian, sigma 150 m, on the 12 m grid): 22-57 % of the
  overlap samples, by case, have the lower way's surface above the upper
  way's, at every step (cross case 51.7 / 49.8 / 46.8 % at 3 / 5 / 8 mm), with the worst
  sample 0.11-0.29 m the wrong way.
- the same hill with 1 m ripples at a 30 m wavelength: 36-54 % inverted by case,
  worst sample about 1.2-1.3 m.

The cause is that a ribbon's vertex sits on the ground but its triangle spans
several ground triangles, so along an edge it follows a chord, not the
ground. Two crossing ribbons have different vertices, so their chords differ
by far more than a step.

## Why it is not fixed here

- It needs a design choice: either sample the ribbon where it crosses the
  ground grid's edges (more vertices, the honest drape), or snap overlapping
  roads to a common height at a junction, or draw roads with a depth rule
  that does not rely on geometry (a stencil or ordered pass per class).
- It needs a measurement on a real hill first (the Schlossberg DEM), in a
  render, because the CPU check counts surfaces, not pixels, and part of an
  inversion may sit under the terrain itself.
- Phone GPUs were not part of any measurement.

## What would change the verdict

A ground grid much finer than the road's vertex spacing on a gentle hill
shrinks the chord error toward the flat case; the 80 m / sigma 150 m hill is
a guess at the Schlossberg, not a measurement of it.
