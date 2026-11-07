# o2-painted-ground.js

## Purpose

Entry of the throwaway city look prototype O2 "painted ground": V2's closed
roofscape on a ground tinted by mapped land use. The land-use polygons are
painted once at load into a canvas texture over the fixture's bbox, which the
harness's ground disc samples by world position. Zero extra triangles or draw
calls, nothing to z-fight.

## API (page)

- `index.html` loads it; it calls `startCityLook` with `v2Variant`, its own
  `materialFor` (ground only, patched by `onBeforeCompile`) and an `objectsFor`
  that adds the panel's on/off row and legend and returns no objects.
- Link knobs for sweeps: `texel` (m a texel, default 1), `strength` (0..1,
  default 1), `soft` (edge blur in m, default 0), `fade` (fade at the bbox edge
  in m, default 40), `tint=off`. The harness's own controls rewrite the link and
  drop these knobs.
- Publishes `window.__paintedGround`: settings, texture size and bytes (with
  and without mipmaps), area count per class, failures per class and reason,
  shares of the box per class, tagged share, chroma per class, paint time.

## Invariants and defensive measures

- Features whose geometry fails `toGeometry`, or is not a polygon, are counted
  in `failed` and skipped (unclosed squares and piers are lines).
- Shares are counted on exact colours before any blur, so they are a floor.
- Outside the bbox the tint fades to today's grey; the ground's own colour is
  unchanged there.
- `soft` uses canvas `ctx.filter`, absent in older Safari (it is then a no-op).
- Colours are the only invented thing; the classes are real OSM tags.

## Example

`o2-painted-ground/index.html?scene=reuss&view=bird&split=off&heat=1`

## Tests

The rules are tested in `painted-ground-rules.test.mjs`. The page itself is
checked by screenshots only (throwaway lab).
