# globe-cloud-shell-light.ts

## Purpose

The spherical cloud volume's ambient light (round-4 plan
`2026-10-11-0122-globe-round-4-owner-feedback-plan.md`, R4d;
`globe-cloud-shell-volume-pass.ts`): the zenith sky's radiance seen from the
cloud deck by the sun's cosine. The slab lights its clouds with one zenith
(the ground sky's sky-view table, for one sun); the shell spans the
terminator, so each sample reads this table at its own sun. No three.js.
Moved out of the globe lab (`labs/globe/globe-cloud-shell-light.js`) as a
pure refactor (editor-on-the-full-globe plan, clouds part b).

## Public API

- `ZENITH_MU`: the table's sun cosines, -0.3 to 0.9 in 13 entries (held
  from 0.9 up: there the zenith direction looks into the sun's aureole and
  the value jumps fourfold, which is not an ambient).
- `ZENITH_TABLE`: `zenithTable(60, 3)` baked (frozen [r, g, b] rows, the
  array frozen too): the lab's air seen from 3 km. The shell reads this one.
- `zenithTable(visibilityKm, heightKm)`: the computation, the framework's
  CPU sky (`skyRadiance` with `psiLookupFor`), in the sky-view table's
  units (a sun of `ATMOSPHERE_RADIANCE_SCALE`). About 470 ms on its first
  call (the multi-scattering's first use): never on a frame. RangeError for
  a visibility that is not positive and finite or a height that is not
  finite and >= 0.
- `ZenithRgb`: one row's type.

## Invariants

- Finite, non-negative, blue by day, dark below the horizon, rising with
  the sun from the horizon on.
- The baked table is the computation's to 1e-4 (relative). The tolerance
  is a rounding bound for the five printed digits, not a tuned threshold:
  a looser one (1e-3) would still hold today, a tighter one (1e-5) would
  fail on the rounding alone.

## Tests

`globe-cloud-shell-light.test.ts` (the lab's node test, moved: the length,
finite non-negative rows, blue by day and dark at night, the rise with the
sun, the baked table against the computation, frozen rows, the refusals).
