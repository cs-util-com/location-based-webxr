# setup-stations.ts

## Purpose

The setup page's stations (polish round M2b, the owner's chosen L5 look):
the six wizard steps as stations along a tour route on a map. Pure: the
open step in, what the station row and the map show out. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-11-0049-tour-viewer-polish-round-plan.md`
("M2b - the L5 look"); verdict P8, P11 in
`2026-10-11-1155-tour-viewer-prototype-verdict-user-feedback.md`.

## Public API

- `stationView(open: WizardStep | null): StationView`
  - `number` (1-based) and `total` (6);
  - `states` - one `"done" | "current" | "todo"` per step in
    `WIZARD_STEPS` order;
  - `routeFraction` - how much of the map's route to draw;
  - `back` / `next` - where Back and Next lead, or null where none is
    offered;
  - `showNav` - whether the back/next row shows at all.
- `STATION_ROUTE_FRACTIONS` - each station's place along the route
  (0 the poster, 1 the end flag), from the prototype.

## Invariants & assumptions

- No Back on step 1; no Next on step 5 ("Start creating" is its action,
  P8); no row at all on step 6 (P11).
- Exactly one station is current; the ones before it are done, the ones
  after to do; back and next are the neighbours; the route only grows with
  the step.
- `null` (nothing open) reads as the first step.
- Which step is open is `wizard.ts`'s alone; this module only describes it.

## Examples

```ts
const view = stationView("print");
// view.number === 3, view.states[0] === "done", view.next === "hang"
```

## Tests

`setup-stations.test.ts` - numbering and states, the rules of the row on
steps 1, 5 and 6, null as the first step, the full route only at the end,
and a property over every pair of steps.
