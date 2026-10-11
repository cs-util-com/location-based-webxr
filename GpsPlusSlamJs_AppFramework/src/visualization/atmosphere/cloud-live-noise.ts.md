# cloud-live-noise.ts

## Purpose

The clouds' noise evaluated live, per octave (round-3 plan
`GpsPlusSlamJs_Docs/docs/2026-10-08-2345-globe-round-3-owner-feedback-plan.md`,
N1, DEC-R3-4; the second cold review's items 4, 5, 6 and 15): the
value-noise fBm the baked 24 km tile holds (`cloud-layer.ts`), but each
octave with its own rotation, a slightly irrational lacunarity and its own
anchor, its lattice values from a 1,024^2 byte texture. The owner saw the
volume's clouds as "carpet tiles that are all identical" (2026-10-08); the
tile repeats every 24 km, the hex-tiled field (`cloud-hex.ts`) every 312 km.
The live field's largest shapes repeat only every 6,144 km.

This file holds the constants, the lattice, the anchoring, the CPU twin,
the cover's threshold table, the lattice texture and the GLSL chunk. The
readers (`atmosphere-glsl.ts`, `cloud-shadow.ts`) switch to it by a uniform;
`SkyAtmosphere` carries the anchor (`configure({ cloudNoise: 'live' })`,
`setCloudNoiseAnchor`).

## Public API

- `CloudNoiseMode` (`'tile' | 'hex' | 'live'`) and `CLOUD_NOISE_MODES`.
- `CLOUD_LIVE_NOISE`: 7 octaves, gain 0.5, base cells 6 km (the tile's),
  lacunarities 2.07, 1.97, 2.13, 2.03, 1.93, 2.11 (2.05 spare for an eighth
  octave in a sweep), octave k turned by 1.1 (k + 1) rad, a 1,024^2 lattice
  (seed 11, mean `latticeMean`, held by a test; the shader's constant. The CPU sample centres every octave on its own lattice's mean, so a `latticeSize` or `latticeSeed` other than the default leaves no offset, the PR #581 review), the anti-aliasing ratios
  `aaStartRatio` 0.5 and `aaEndRatio` 4 (cells), the spread kept as
  octaves fade (`restoreSpread`, at most `maxSpreadGain` 4), and `fieldMean` 0.38008 and
  `contrast` 1.431, which match the drawn tile field's mean (0.3801) and
  spread (0.1792) so the slab's columns rise as high at the same cover.
- `fineGain` (0.5): the amplitude ratio from octave 2 on, the fine
  detail's knob (round-3 plan §19 item 2). The tile is 0.7 fBm + 0.3 fBm at
  3x, more fine detail than gain 0.5: live's octaves 3-6 carry 1.6 % of
  the variance at 0.5, 4.6 % at 0.6, 7.5 % at 0.7. The amplitudes keep
  their root sum of squares, so the spread (0.1797) and the cover's table
  hold (within 0.0034 at covers 0.1-0.9 for fine gains 0.5-0.7, measured
  over 200,000 points).
- `cloudLiveAmplitudes(options?)`: the octaves' amplitudes, the shader's
  amplitude uniform.
- `marchOctaves` (5): the octaves the slab's march reads at most (round-3
  plan §19 item 5). The two finest (cells of 176 and 84 m) carry 0.09 %
  of the variance (0.8 % at fine gain 0.65) but cost 7 % of the live
  volume pass: on SwiftShader, the pass alone in one page load, the tile
  722 ms, live with 7 octaves 802 (x1.11), with 5 in the march 743
  (x1.03). The dome, the sheet and the shadow read all 7.
- `CloudLiveOptions`: every constant above, overridable for the sweeps,
  and `octaveLimit` (octaves read at most; the rest count as faded).
- `cloudLiveLattice(size?, seed?)`: the lattice bytes, cached per (size,
  seed); RangeError for a size that is not a power of two from 16 to 4,096.
- `cloudLiveOctaves(options?)`: each octave's `cellKm`, `amplitude`
  (normalised to sum to `contrast`), `angleRad` and `seedCells`. RangeError
  for 0 or more than 8 octaves, a gain outside (0, 1), too few or
  out-of-range lacunarities, a base cell that is not positive, a fade that
  does not run from a ratio >= 0 to a larger finite one, a gain cap under
  1, or an octave limit that is not a whole number >= 1.
- `CloudNoiseAnchor`: `{ originKm: [x, y], rotationRad }`, where the
  caller's frame origin lies on the noise plane (km, unwrapped, float64) and
  the frame's rotation on it.
- `cloudLiveBasis(anchor, options?, out?)`: four numbers an octave, (a, b, ox,
  oy): octave k reads its lattice at q = (a x - b y + ox, b x + a y + oy)
  for the local point (x, y) km, written into `out` when given (a caller
  sets the anchor every frame: no allocation). RangeError for a non-finite
  anchor.
- `cloudLiveSample(basis, xKm, yKm, footprintKm = 0, options?)`: the CPU
  twin of `atmCloudLiveNoise`. RangeError for non-finite coordinates, a
  negative or NaN footprint, or a basis of the wrong length.
- `cloudLiveCoverThresholds({ samples?, seed?, covers?, spanKm? })`: the
  field's (1 - cover) quantiles over uniform random points (default
  1,000,000 over 20,000 km), +Infinity at cover 0.
- `CLOUD_LIVE_COVER_THRESHOLDS` (covers k / 32) and
  `CLOUD_LIVE_COVER_LOW_TAIL` (k / 512, k = 1..16, ending at the table's
  1 / 32 entry): precomputed from that, held by a test.
- `liveCloudThreshold(cover)`: the table read by `coverTableThreshold`
  (`cloud-hex.ts`); +Infinity at 0; RangeError outside [0, 1].
- `createCloudLiveLatticeTexture()`: the default lattice as a repeating,
  linear, mip-less `RedFormat` byte texture (1 MB on the GPU).
- `CLOUD_LIVE_NOISE_GLSL`: include-guarded (`ATM_CLOUD_LIVE_GLSL`):
  - `atmCloudLiveNoise(lattice, basis[7], amp[7], p, footprintKm, octaves)`: the
    field at the local point p (km), `amp` the amplitudes
    (`cloudLiveAmplitudes`; a uniform, so the fine gain needs no new
    program);
  - `atmCloudLiveAt(lattice, basis, amp, uv, offset, footprintKm, octaves)`: the same from
    a reader's noise coordinate (tiles with the offset), p = (uv - offset)
    x 24 km;
  - `atmCloudLiveGrad(lattice, basis, amp, uv, offset)`: the footprint from the
    screen derivatives of uv, for readers outside a loop.

## Invariants & assumptions

- **The anchoring.** A local point p lies on the plane at P = originKm +
  R(rotation) p. Octave k reads q = R(angle_k) P / cell_k + seed_k = M_k p +
  o_k: the basis composes the octave's rotation with the frame's, and
  reduces o_k modulo the lattice size in float64. Each octave alone repeats
  at the lattice size exactly, so the reduction never moves the field
  (property-tested: a point reads its plane position's noise for origins to
  50,000 km and any rotation, within 1e-7; two mutants killed: the
  reduction at a wrong size, the frame's rotation subtracted). The shader
  sees only the reduced offsets (under 1,024 cells) and the local point:
  centimetres of precision at 300 km.
- **Readers address it as they address the tile.** Every reader computes a
  noise coordinate uv = local / 24 km + `atmCloudOffset`; the live chunk
  takes the local point back as (uv - offset) x 24 km. So the offset may
  be anything (the tile's drift, the globe's anchoring) and the live field
  stays on the plane. The CPU twins do the same.
- **One lattice read an octave**, at level 0, through Quilez's smooth remap:
  the hardware's bilinear read at i + fade(f) + 0.5 texels is value noise
  with the Hermite fade. The GPU's bilinear weights are 8-bit, so the GPU
  and the twin agree within about 1/256 of a lattice step (the globe lab's
  browser check).
- **Anti-aliasing by octave** (cold review item 5): an octave is whole while
  the footprint is at most half its cell and its mean from 4 cells
  (smoothstep between); the loop ends at the first faded octave. Not
  mipmaps: the smooth remap moves the read inside a cell non-linearly, so
  at a coarser level the hardware's bilinear read is no longer the
  octave's value noise, and a faded octave costs no fetch at all.
- **The spread is kept as octaves fade** (the N1 milestone review, round-3
  plan §19 item 1): the faded sum's deviation is scaled by the spread at
  footprint 0 over the spread left (at most x4), so the cover drawn with
  the footprint-0 threshold holds. With the fade alone and its end at one
  cell, the field went to its mean at a 6 km footprint and the cover drawn
  flipped: asked 0.3 / 0.5 / 0.7 drew 0.00 / 0.50 / 1.00 (the base octave
  carries about 75 % of the variance, so its fade decides it, not the fine
  octaves'). Measured (`SWEEP_AA`, 1,500 points, footprints 0.25-24 km):
  - the tile's mipmaps flip too, from about 4 km (0.19 / 0.51 / 0.84 at
    4 km, 0.06 / 0.48 / 0.97 at 8 km);
  - with the spread kept and the fade ending at 1 / 2 / 3 / 4 cells, the
    cover drawn holds within 0.02 to a footprint of 4 / 8 / 12 / 16 km;
    the gain cap 2 lets it go earlier at the far end, 8 changes nothing
    beyond 4;
  - against the box-filtered density (6 x 6 samples a footprint), the end
    at 4 cells has the least RMS difference at every footprint to 8 km
    (0.17 at 4 km, against 0.20-0.22 for the tile and 0.22 as built);
  - past the end the field still goes to its mean (continuously, through
    the cap), and the cover drawn with it.
    In the globe's volume the march's footprint stays small at the 5 km hold
    (about 1 km: the slab's footprint is the pixel's along the ray and the
    step's, not projected onto the deck), and the browser's drawn cover by
    distance showed no flip there before the change (tile 0.20 against live
    0.19 from 24 to 80 km); the fade matters where footprints reach a cell,
    from much higher (V1).
- **The cover's table is the field's own** (its quantiles at footprint 0),
  and holds at every footprint to 16 km through the spread kept.
- **What still repeats**: each octave alone, at 1,024 cells (6,144, 2,968,
  1,507, 707, 348, 180 and 85 km). The correlation at an octave's own
  period is about its share of the variance (75 / 19 / 4.7 / 1.2 / 0.3 /
  0.07 / 0.02 % at gain 0.5), and the octaves' periods share no common
  multiple, so the field as a whole does not repeat within any view;
  `cloud-live-noise.sweep.test.ts` measures it.
- Value noise, not gradient noise: the rotations hide its axes; gradient
  noise is the next step if blockiness shows (plan §6, a risk named).

## Examples

```ts
const basis = cloudLiveBasis({
  originKm: [4_210.5, -5_220.25],
  rotationRad: 0.1,
});
const value = cloudLiveSample(basis, 12.5, -3); // the twin at 12.5 km east, 3 km north
const threshold = liveCloudThreshold(0.4); // 40 % of the plane is cloud above it
```

## Tests

- `cloud-live-noise.test.ts`: the lattice (size, cache, range, mean, the
  refusals), the octaves (cells, the plan's periods, rotations, gains,
  refusals), the basis (reduced offsets, refusals), the twin (a lattice
  point reads its byte, continuity, the anti-aliasing's fade and its whole
  octaves, refusals), the field against the tile (mean and spread), no
  repeat at 24, 1,536 and 6,144 km, the threshold table held to a fresh
  computation and met on other points, its interpolation, the texture and
  the GLSL text (guard, constants, one read an octave, the remap, the
  break).
- `cloud-live-noise.property.test.ts`: the anchoring invariance, and a
  finite value in range for any anchor and footprint.
- `cloud-live-noise.sweep.test.ts`: the window-correlation measure (fast
  form always, the full sweep with `SWEEP=1`).
- The browser: the globe lab's `globe-cloud-noise.smoke.spec.mjs` (the GPU
  against the twin, two anchors far apart, the cost against the tile).
