# `ground-tint.ts`

## Purpose

The land-use ground tint (city objects plan
`GpsPlusSlamJs_Docs/docs/2026-11-07-2315-city-objects-and-roofscape-into-library-plan.md`
M3, a port of the O2 painted-ground prototype,
`GpsPlusSlamJs_DesignSystem/labs/city-look/o2-painted-ground/`).

## Public API

- `GROUND_CLASS_NAMES`, `GroundClass` - the 25 classes, in O2's order.
- `DEFAULT_GROUND_RGB` - the neutral ground, `0x6b7280` (OsmDemo's
  `GROUND_COLOUR`).
- `DEFAULT_LAND_USE_RGB` - O2's class colours, sRGB; the default colour
  scheme's `landUse`.

## Invariants & assumptions

- Every default class colour has a chroma (max minus min channel) under 45
  (DEC-R4-5: the heat ramp stays the loudest colour).

## Tests

- `colour-scheme.test.ts` (the default's land use).
