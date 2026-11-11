# invented-roofs-switch.ts

## Purpose

The header checkbox "invented roofs": switches the roofs the city plans for
buildings OpenStreetMap gives no roof shape on or off, shows the switch in
progress, and reverts a switch whose own build failed. Modelled on
`colour-scheme-switch.ts` so both header controls behave alike.

## Public API

- `attachInventedRoofsSwitch({ box, status, initial, choose })` - wires the
  checkbox; throws `TypeError` when `initial` is not a boolean.
- `InventedRoofsSwitch`
  - `show(on)` - the store changed; the box follows.
  - `meshDrawn(on | undefined)` - a full mesh was drawn with that choice
    (absent means on); ends a pending switch that asked for it.
  - `failed(failedOn?)` - any failure ends a pending switch; only a failed city
    build WITH the pending choice reverts the box and calls `choose(drawn)`.
  - `pending()` - the choice being applied, or `undefined`.

## Invariants & assumptions

- While a switch is pending the box is disabled and the status reads
  "Applying invented roofs..." or "Applying flat roofs...".
- The in-progress state ends on the echoed mesh (the durable end state), never
  on the dispatch; a mesh from a pass in flight with the old choice does not
  end it.
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
