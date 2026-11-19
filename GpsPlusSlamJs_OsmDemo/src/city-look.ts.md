# city-look.ts

## Purpose

The city's look on the page: one owner for the colours the drawn city wears
and how bright its neutral surfaces are. It holds the scheme of the mesh
being drawn (through what it last followed), the time-of-day look weights,
the shared look mix (`LookMix`), the plates' colour, the fixed scheme's
brightness trim and the noon gain, so a rebuilt city, a new set of weights
and a scheme switch all read the same held values. `BuildingView` owns one
and draws the city only through it.

The state the app is ABOUT (the chosen scheme, the sun) lives in the Redux
store; this module holds three.js objects and what was last drawn from that
state, which is why it is a class and not store state.

## Public API

- `new CityLook({ root, setGroundColours, setLandUseLookWeights })`
  - `root`: the city's `Object3D`; buildings, roads, plates and trees are
    drawn under it.
  - `setGroundColours(ground, slope)`: the ground material colour (sRGB
    `0xrrggbb`) and slope colours (linear).
  - `setLandUseLookWeights(weights | undefined)`: the land-use tint's weights.
- `mix` - the shared `LookMix` every look material of a time-of-day build reads.
- `lookWeights` - the weights last set, undefined while a fixed scheme is drawn.
- `neutralSurfaceFactor` - the noon gain times the trim, as buildings and
  roads wear it.
- `followScheme(scheme, lookWeights)` - follows the scheme a mesh was BUILT
  in: `"timeofday"` takes `lookWeights`; any other name (unknown names fall
  back to the default scheme, as `colourSchemeOf` does) clears the weights and
  sets that scheme's ground, slope, plates and brightness trim.
- `setLookWeights(weights | undefined)` - with weights: the trim weights go
  to the mix (`mixedPageLook`), the material trim to 1, and the land-use
  tint, the drawn trees, the drawn plates and the ground follow. Undefined
  clears the blend (the land-use tint's weights too). `RangeError` for
  weights `mixedPageLook` refuses, before any write.
- `setBrightnessTrim(trim)` - `RangeError` outside
  `MIN_BRIGHTNESS_TRIM`-`MAX_BRIGHTNESS_TRIM`; returns whether it changed.
- `setSurfaceGain(gain)` - the noon gain (`surfaceGainAt`); `RangeError`
  unless positive and finite, and then nothing changes.
- `draw(mesh, layers, context)` - draws `mesh` under the root with
  `drawMeshLayers`: on the mix only when the mesh was built as the blend AND
  weights are held, its trees mixed then; the plates in the held colour;
  the neutral surfaces at the held gain times trim. Returns `{objects, stats}`.
  The context omits `plateColour` and `looks`: this module decides both, so a
  caller cannot pass a plate colour that disagrees with the mesh.

## Invariants & assumptions

- Under look weights the material trim is 1: each look's trim is folded into
  the mix's weights, and a trim on the material too would brighten twice.
- A fixed build always gets its own scheme's trim back (`followScheme`).
- The page calls `followScheme` for every full mesh BEFORE drawing it, so the
  held plate colour and weights belong to the mesh `draw` receives.
- Plates are found by `userData[LANDUSE_PLATE_TAG]` (`mesh-layers.ts`);
  their colour is not touched by the surface gain.
- Every setter is a uniform, colour or material write, never a rebuild.
- **The trees re-mix in steps:** `setLookWeights` re-mixes the drawn trees'
  colours (a write per tree instance, the costly part of a sun step) only
  once a weight has moved by `TREE_MIX_STEP` (1/255, one step of an 8-bit
  colour channel) since their last mix; the other layers follow every call.
  A newly drawn mesh always mixes its trees at the held weights.

## Examples

```ts
const look = new CityLook({
  root: group,
  setGroundColours: (g, s) => view.setGroundColours(g, s),
  setLandUseLookWeights: (w) => landUse.setLookWeights(w),
});
look.followScheme(mesh.colourScheme, weights);
const { stats } = look.draw(mesh, layers, context);
look.setLookWeights([0, 0.5, 0.5, 0]); // a sun step: no rebuild
```

## Tests

`city-look.test.ts`: a time-of-day mesh drawn after a trimmed fixed build
(material colour equals the gain, mix `(0, trimGolden, 0, 0)`, look
attributes and no `color`, mixed plates); a following fixed build gets its
trim back and its plain colours; moving weights recolours the drawn plates,
ground and land use; bad weights change nothing. Two source-text checks pin
that `BuildingView` and `main.ts` route through this module, since neither
can run in the unit suite. The first test was seen to fail with the reset of
the trim to 1 removed.
