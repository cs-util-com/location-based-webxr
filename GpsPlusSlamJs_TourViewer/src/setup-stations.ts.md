# setup-stations.ts

## Purpose

The setup page's stations (polish round M2b, the owner's chosen L5 look):
the chosen path's steps (`setup-path.ts`) as stations along a tour
route on a map. Pure: the path and the open step in, what the checklist
and the map show out. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-11-0049-tour-viewer-polish-round-plan.md`
("M2b - the L5 look"); verdict P8, P11 in
`2026-10-11-1155-tour-viewer-prototype-verdict-user-feedback.md`.

## Public API

- `stationView(path: readonly WizardStep[], open: WizardStep | null): StationView`
  - `number` (1-based) and `total` (the path's length);
  - `states` - one `"done" | "current" | "todo"` per step of the path;
  - `routeFraction` - how much of the map's route to draw;
  - `back` / `next` - where Back and Next lead, or null where none is
    offered;
  - `showNav` - whether the back/next row shows at all.
- `STATION_ROUTE_FRACTIONS` - the six route slots (0 the poster, 1 the
  end flag), from the prototype.
- `stationSlot(pathLength, i)` - the slot of a path's i-th station: a
  path of n steps takes the LAST n slots, so every path ends at the flag.

## Invariants & assumptions

- No Back on the path's first step; no Next where the step's own action
  moves on (`measure` - "Start creating", P8 - and `file`, `starter`,
  whose open moves on); no row at all on `done` (P11).
- Exactly one station is current; the ones before it are done, the ones
  after to do; back and next are the neighbours; the route only grows with
  the step.
- `null` (nothing open), or a step off the path, reads as the path's
  first step.
- Which step is open is `wizard.ts`'s alone; this module only describes it.

## Examples

```ts
const view = stationView(SETUP_PATHS["have-link"], "print");
// view.number === 2, view.states[0] === "done", view.next === "hang"
```

## Tests

`setup-stations.test.ts` - numbering and states per path, the rules of
the row, null and an off-path step as the first step, the slots each path
takes, the full route only at the end, and a property over every path and
open step.
