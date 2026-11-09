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

- **Deterministic per key**: the picks come from `mixedUnit(key, salt)`
  (`stable-jitter.ts`, FNV-1a with a fmix32 finaliser), salts `wall`, `roof`
  and `lid`, so the same house has the same colour on every device and reload.
- **Wall and roof picks are independent**: without the finaliser (plain
  `unit`) they were correlated over sequential ids (chi-square 140-230
  against the p = 0.001 bound 74.7, M7 review NIT 6); with it at most 59.2
  (pitched) and 29.8 (flat) over the property test's nine id ranges. The V2 prototype
  picked with its own `seededRandom`, so the tones match V2 but which house
  gets which tone does not.
- **`building:material` is not read** under this palette (owner, Q3 of that
  plan); the class palette still reads it.
- **Every tone is muted**: chroma (max minus min channel, 0-255) at most 58,
  the first clay, against the affordance heat ramp's floor of 80 (DEC-R4-5).
  The tones are sRGB; `buildCity` converts building chunks to linear light.
- Kept out of `allBuildingColours()`: that list's luma band (120-215) is for
  the class wall colours, and the darker roofs would leave it on purpose.

## Brightness (r1155 sweep, 2026-11-08)

The owner asked for the palette "etwas heller", with the June-noon lit-surface
floor (61.47 = 0.95 x 64.7, `scene-3d.spec.js`) as the bar. Every tone was
lifted in OKLab, L' = L + f(1 - L), chroma unchanged (all stay below 80). The
heat grid's margins do not depend on the palette (identical for every f).

- June-noon lit luma by lift f (e2e, Cologne fixture), then Heidelberg
  2026-11-08 13:00 at 1440x900:
  - f 0 (these tones): 48.8; 36.5
  - f 0.1: 51.3; 39.1
  - f 0.2: 53.9; 41.9
  - f 0.3: 56.8; 44.8
  - f 0.4: 59.7; 47.9
  - f 0.5: 62.6, clears the floor; 51.3
  - the class palette: 53.3, also below the floor; 57.2
- The floor is first cleared at about f 0.46, and f 0.5 turns the walls
  near white (f3e6d1 ...) and the clay roofs pale salmon, so no lift was
  committed: the tones above are unchanged.
- The cause of the June-noon red is not this palette but the linear-light
  conversion of building chunks (`linearChunkColours` in `city.ts`): with
  that conversion bypassed, June noon reads 62.6 with these tones and 64.3
  with the class palette, both above the floor. Whether the floor or the
  conversion is re-judged is the owner's call.

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
  part passing its outline's key gets the outline's colours. The wall-by-roof
  cells over 2000 sequential ids (nine id ranges) stay below the p = 0.001
  chi-square bound (74.7 pitched, 49.7 flat).
- Through `buildCity`: `city.test.ts` ("buildCity's seeded palette", incl.
  a pitched tag drawn as a prism taking a flat grey, and "Heidelberg under
  the seeded palette").
