# globe-cloud-flat-fade.ts

The flat cloud layer's share by altitude: how much of the NASA cloud map
(painted into the ground high up, on the cloud shell lower down) still
shows at the camera's altitude.

Source: round-2 plan
`GpsPlusSlamJs_Docs/docs/2026-10-07-2350-globe-flight-round-2-owner-feedback-plan.md`,
DEC-FR2-5 as revised by its cold review (finding 4), milestone R3.

## Purpose

The owner (2026-10-07, flying into the Alps on r793): the flat layer "is
still too visible at 1,000 km and at 100 km; it should weaken much earlier
and be gone at the latest when the volumetric clouds are fully in (about
15 km)". Nothing faded it with altitude before.

## Public API

- `GLOBE_CLOUD_FLAT`: `topM` 5,000 km (full from here up), `weakM` 100 km
  (weak by here), `weakShare` 0.3.
- `flatCloudShare(altitudeM, { ceilingKm, fadeKm, topM?, weakM?,
weakShare? })`, 0-1:
  - 1 from `topM` up;
  - a smoothstep in the altitude's logarithm down to `weakShare` by `weakM`;
  - times 1 - the volume's share (`cloudVolumeShare` with the given
    `ceilingKm` and `fadeKm`): gone exactly when the volume is full.
  - RangeError for an altitude that is not finite, a weak share outside
    [0, 1], or `topM` not above `weakM` (or `weakM` not positive).

## Invariants

- Full high up; 0 at and below the volume's full-in altitude (15 km with the
  lab's 40/25 km).
- Weaker at 1,000 km (under 0.75 with the defaults), `weakShare` by 100 km.
- Never rises on the way down.
- From the volume's ceiling down it is `weakShare` x (1 - the volume's
  share): the clouds are never drawn twice or not at all (the C2 invariant
  of `globe-cloud-volume.ts`). Pass the values the volume is drawn with: the
  module's default fade (40/10 km) and the lab's (40/25 km) differ.
- A page without the volume passes a ceiling of 0, so the layer only
  weakens and the clouds never vanish.

## How it is used

The globe lab computes it from the camera's current altitude and passes it
to `setCloudShellShare(share, flat)` (`globe-surface.ts`), which fades both
of the layer's forms and the water glint's cloud mask (`uCloudFlat`); the
lab scales the shell's ground shadow by it too. Never the global cloud
opacity, which the volume reads as well.

## Tests

- `globe-cloud-flat-fade.test.ts`; the surface's wiring in
  `globe-surface.test.ts` and `globe-surface-material.test.ts`; the lab's
  in the `flight=2` land=1 smoke of `globe-city.smoke.spec.mjs` (full above
  6,000 km, the weak share below 90 km, the volume off there).
