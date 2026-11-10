# `colour-scheme.ts`

## Purpose

Every colour `buildCity` paints, as one value, so a consumer can switch the
whole look of a city (OSM demo colour schemes plan
`GpsPlusSlamJs_Docs/docs/2026-11-10-0841-osm-demo-colour-schemes-plan.md`,
section 4.1). OsmDemo carries ten named schemes; every other consumer builds
without one and gets `DEFAULT_CITY_COLOUR_SCHEME`.

## Public API

- `CityColourScheme` - every field required:
  - `honourColourTags` - keep `building:colour` / `roof:colour`, and mix a
    barrier's `colour` tag in (owner D7); false paints over them.
  - `roadsBySurface` - car roads take a `surface` colour before their class.
  - `ground` - the neutral ground (the tint's unclassified texels and blend
    target, and the ground material with the tint off).
  - `walls`, `pitchedRoofs`, `flatRoofs` - the seeded tone lists.
  - `roads` (per `highway`), `roadSurfaces` (per `surface`), `sidewalk`,
    `defaultRoad`.
  - `barriers` (per `BarrierKind`), `barrierMaterials`.
  - `trees` (per `TreeKey`), `landUse` (per `GroundClass`).
  - It is the union of `PaletteColours`, `RoadColours` and `BarrierColours`,
    the parts each colour function reads, so a scheme can be passed straight
    to `seededBuildingColours`, `roadColour` and `barrierColour`.
- `DEFAULT_CITY_COLOUR_SCHEME` - today's colours, frozen, built by spreading
  each module's own default (`DEFAULT_PALETTE_COLOURS`,
  `DEFAULT_ROAD_COLOURS`, `DEFAULT_BARRIER_COLOURS`, `TREE_PALETTE`,
  `DEFAULT_GROUND_RGB`, `DEFAULT_LAND_USE_RGB`), never a copy of them.
- `validateCityColourScheme(unknown) -> CityColourScheme` - throws
  `RangeError` naming the first problem: not an object, a flag not boolean,
  a colour that is not an integer in 0..0xffffff, an empty tone list, a map
  that is not a `Map`, a map missing one of the default's keys, or holding a
  key the default does not have. Returns its argument unchanged.

## Invariants & assumptions

- **No optional fields**: a missing colour is an error, not a fallback, so a
  scheme can never look half switched. A scheme is written as
  `{ ...DEFAULT_CITY_COLOUR_SCHEME, walls: [...], roads: new Map(...) }`.
- **Strict keys**: an extra map key is refused, because it is a typo that
  would never be read.
- **Colour space**: all values are sRGB hex. Building chunks (walls, roofs,
  barriers) are converted to linear light by `buildCity`; road chunks stay
  raw (a road hex renders lighter than the same hex on a wall); tree colours
  are converted by the renderer (three's `setRGB` in sRGB). The land-use
  tint's colour space follows its renderer (`three/ground-tint.ts`).
- The modules import no scheme: each colour function takes its own part with
  a module-local default, and this file composes them, so there is no import
  cycle.

## Examples

```ts
import { buildCity, DEFAULT_CITY_COLOUR_SCHEME } from "gps-plus-slam-osm/mesh";

const blueprint = {
  ...DEFAULT_CITY_COLOUR_SCHEME,
  honourColourTags: false,
  walls: [0xb8cce4],
  ground: 0x1b2a4a,
};
const city = buildCity(features, ground, {
  window,
  roads: true,
  colours: blueprint,
});
```

## Tests

- `colour-scheme.test.ts` - validation cases, the buildCity boundary, the
  linear-versus-raw rule for a scheme's colours, trees from a scheme, D7 for
  buildings and barriers, `roadsBySurface` at the Heidelberg fixture.
- `colour-scheme.property.test.ts` - any well-shaped scheme validates; with
  tags painted over every building colour is a scheme tone; every road
  colour comes from the scheme.
- `colour-identity.test.ts` - the default, absent or explicit, reproduces
  the golden digests recorded before schemes at twelve sites.
