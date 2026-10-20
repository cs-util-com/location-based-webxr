# globe-cloud-shell-light.js

## Purpose

The spherical cloud volume's ambient light (round-4 plan
`2026-10-11-0122-globe-round-4-owner-feedback-plan.md`, R4d;
`globe-cloud-shell-volume.js`): the zenith sky's radiance seen from the
cloud deck by the sun's cosine. The slab lights its clouds with one zenith
(the ground sky's sky-view table, for one sun); the shell spans the
terminator, so each sample reads this table at its own sun. No three.js, so
the lab's node tests import it.

## Public API

- `ZENITH_MU`: the table's sun cosines, -0.3 to 0.9 in 13 entries (held
  from 0.9 up: there the zenith direction looks into the sun's aureole and
  the value jumps fourfold, which is not an ambient).
- `ZENITH_TABLE`: `zenithTable(60, 3)` baked (frozen [r, g, b] rows): the
  lab's air seen from 3 km. The shell reads this one.
- `zenithTable(visibilityKm, heightKm)`: the computation, the framework's
  CPU sky (`skyRadiance` with `psiLookupFor`), in the sky-view table's
  units (a sun of `ATMOSPHERE_RADIANCE_SCALE`). About 470 ms on its first
  call (the multi-scattering's first use): never on a frame. RangeError for
  a visibility that is not positive or a height that is not finite and >= 0.

## Invariants

- Finite, non-negative, blue by day, dark below the horizon, rising with
  the sun from the horizon on.
- The baked table is the computation's to 1e-4 (relative).

## Tests

`globe-cloud-shell-light.test.mjs`.
