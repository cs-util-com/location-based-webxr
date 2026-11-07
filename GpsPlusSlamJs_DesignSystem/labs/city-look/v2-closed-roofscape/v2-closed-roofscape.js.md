# v2-closed-roofscape.js

## Purpose

The V2 page: every low house without a roof tag gets a roof, unless the data
around it says roofs there are flat, or it is a large or commercial footprint
(`roofscape-rules.js.md`); it gets a roof on its real
footprint (straight skeleton, gables, shared walls, a 32 cm eave), seeded
heights and a muted seeded palette, with GTAO. Tagged buildings are built by
the library exactly as today.

## Public API

None; an entry module calling `startCityLook({ id: "v2", ... })` with
`buildingsFor` and `postprocess: "gtao"`. Lab-only query keys on top of the
harness's: `limit` (height limit, m), `tolerance` (corner simplification, m),
`prior=off` (turns the local roof prior and the class and size refusals off: V2
as first chosen, for a before and after on one page), `audit` (counts the kept triangles that differ from today's into
`window.__roofscape.keptChanged`). `window.__roofscape` also carries the plan
`counts` and `planMs`.

## Invariants and assumptions

- The kept buildings come from `ctx.buildCity` on the features minus the roofed
  ones, so their geometry and colours are today's; `audit=1` measures it (0 on
  both fixtures).
- Draw calls: today's building chunks plus one mesh for all invented houses. No
  per-frame work; the planning runs once at load.
- Multipolygon buildings use their first polygon, as the library does.

## Example

`/labs/city-look/v2-closed-roofscape/index.html?scene=heidelberg&view=landing`

## Tests

`roof-skeleton.test.mjs`, `roofscape-rules.test.mjs`, `house-shell.test.mjs`
(`node --test labs/city-look/v2-closed-roofscape/`), and the lab's
`../city-look.smoke.spec.mjs`.
