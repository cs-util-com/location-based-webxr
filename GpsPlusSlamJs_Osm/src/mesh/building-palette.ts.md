# `building-palette.ts`

## Purpose

The seeded palette every building without a colour tag takes by default
(city objects plan `GpsPlusSlamJs_Docs/docs/2026-11-07-2315-*` M7; the owner
chose the V2 "closed roofscape" city look, `GpsPlusSlamJs_DesignSystem/labs/city-look/v2-closed-roofscape/`).
`buildCity` draws it unless asked for `palette: "class"`, the class colours
of `feature-colours.ts`.

## Public API

- `BuildingPalette` - `"seeded" | "class"`, the `buildCity` option's type.
- `WALL_TONES` - six warm plaster and sandstone tones.
- `PITCHED_ROOF_TONES` - five clay tones, then two slate greys.
- `FLAT_ROOF_TONES` - four bitumen and gravel greys.
- `seededBuildingColours(tags, outline, key, pitched) → { wall, roof }`
  - `wall`: `building:colour` (the part's, then the outline's), else a wall
    tone picked by `key`.
  - `roof`: `roofColour(tags, outline)`, else a pitched tone (`pitched`) or a
    flat one, picked by `key`.
  - `key` is the building's feature key, or its OUTLINE's for a
    `building:part`, so all parts of one building share both colours.
  - Never throws; a non-string key reads as the empty string.
- `allPaletteColours()` - every tone, for the chroma check.

## Invariants & assumptions

- **Deterministic per key**: the picks come from `unit(key, salt)`
  (`stable-jitter.ts`, FNV-1a), salts `wall`, `roof` and `lid`, so the same
  house has the same colour on every device and reload. The V2 prototype
  picked with its own `seededRandom`, so the tones match V2 but which house
  gets which tone does not.
- **`building:material` is not read** under this palette (owner, Q3 of that
  plan); the class palette still reads it.
- **Every tone is muted**: chroma (max minus min channel, 0-255) at most 58,
  the first clay, against the affordance heat ramp's floor of 80 (DEC-R4-5).
  The tones are sRGB; `buildCity` converts building chunks to linear light.
- Kept out of `allBuildingColours()`: that list's luma band (120-215) is for
  the class wall colours, and the darker roofs would leave it on purpose.

## Examples

```ts
const { wall, roof } = seededBuildingColours(
  { building: "house" },
  undefined,
  "way/42",
  true,
);
buildCity(features, ground); // seeded, the default
buildCity(features, ground, { palette: "class" }); // the colours before M7
```

## Tests

- `building-palette.test.ts`: list sizes, determinism, every tone reached,
  roof list by shape, colour-tag precedence (own then outline), material
  ignored, unparsable tags ignored, a non-string key.
- `building-palette.property.test.ts`: chroma below 80 with the maximum at
  58; any key and colourless tags draw from the lists, deterministically; a
  part passing its outline's key gets the outline's colours.
- Through `buildCity`: `city.test.ts` ("buildCity's seeded palette" and
  "Heidelberg under the seeded palette").
