# v3-architects-model.js

## Purpose

The page entry of V3: the city as an architect's massing model.

## Public API

No exports. Calls `startCityLook` with V3's `buildingsFor`, `materialFor`,
`postprocess: "gtao"` and `aoParams`.

## Invariants and assumptions

- `LOOK` holds the chosen values. Each can be overridden by a link parameter of
  the same name, for comparing values (for example `?lineStrength=0.3`,
  `?bayM=0` for no openings, `?aoRadius=12`, `?groundColour=cfcbc3`). There is
  deliberately no control on the page.
- A non-numeric value is ignored; colours take six hex digits without `#`.

## Example

`/lookdev/labs/city-look/v3-architects-model/index.html?scene=heidelberg&view=landing`

## Tests

None of its own; see the neighbouring modules.
