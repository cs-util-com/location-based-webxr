# invented-roofs-switch.ts

## Purpose

The header checkbox "invented roofs": switches the roofs the city plans for
buildings OpenStreetMap gives no roof shape on or off, shows the switch in
progress, and reverts a switch whose own build failed. Modelled on
`colour-scheme-switch.ts` so both header controls behave alike. Since M4b
the behaviour lives in `build-choice-switch.ts` (shared with the zebras and
pedestrian areas switch); this module names it and words its status.

## Public API

- `attachInventedRoofsSwitch({ box, status, initial, choose })` - wires the
  checkbox; throws `TypeError` when `initial` is not a boolean.
- `InventedRoofsSwitch` - the shared `BuildChoiceSwitch` (`show`, `meshDrawn`,
  `failed`, `pending`; see `build-choice-switch.ts.md`).

## Invariants & assumptions

- While a switch is pending the box is disabled and the status reads
  "Applying invented roofs..." or "Applying flat roofs...".
- The echo and revert rules are the shared switch's.
- The box stays usable in AR: AR draws the same buildings as the map.

## Examples

```ts
const roofs = attachInventedRoofsSwitch({
  box: el<HTMLInputElement>("invented-roofs"),
  status: el("invented-roofs-status"),
  initial: selectInventedRoofs(store.getState()),
  choose: (on) => store.dispatch(inventedRoofsChanged(on)),
});
roofs.meshDrawn(mesh.inventedRoofs);
```

## Tests

`invented-roofs-switch.test.ts` (jsdom): boot state, the in-progress state to
the echo, the absent field, the revert on its own failed build, an unrelated
failure keeping the choice, following the store, and idle meshes and failures.
