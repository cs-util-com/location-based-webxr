# `src/ground-mode.ts`

## Purpose

Which surface is drawn as the ground — the CPU-displaced plane, the
GPU-displaced one, or none at all (W11, DEC-R3-3).

## Public API

- `GROUND_MODES` — `["cpu", "gpu", "none"]`, in picker order. The picker is
  populated from this, so the two cannot drift.
- `GroundMode`, `DEFAULT_GROUND_MODE` (`"cpu"`).
- `groundModeLabel(mode)` — what the picker shows.
- `parseGroundMode(value)` — narrows an untrusted string, falling back to the
  default.
- `groundDebugAvailable(mode)` — whether the height ramp can do anything.

## Invariants & assumptions

- **A MODE, NOT A LAYER.** `ALL_LAYERS` means "things the scene can draw", each
  independently; these three are one thing drawn three ways and are exclusive.
  W23's `GPU ground` checkbox was deliberately kept out of the registry for the
  same reason, and this keeps it out.
- **The notes asked for `OSM ground / CPU / GPU`, and that shape was wrong.**
  The OSM ground areas are CONTENT — the `plates` layer — while CPU and GPU are
  strategies for the same terrain, so one exclusive picker over all three would
  have made "OSM areas lying on the terrain", the physically correct picture the
  geometry is built for, unselectable. The owner's revision is `CPU / GPU / No
ground` with `plates` staying a layer: the terrain can be taken away to inspect
  the areas alone, and every combination stays reachable.
- **The invisibility that prompted the request is fixed by W10, not by this
  control.** Plates sank under the terrain because `heightAt` read a different
  surface from the one the plane drew; the picker is for inspection, not a
  workaround.
- **`parseGroundMode` falls back rather than throwing.** The store holds the mode
  as a plain `string` (the framework may not name a demo type) and this is a
  candidate for a URL parameter, so the input is genuinely untrusted — and "the
  ground vanished because of a typo in a query string" is the worst available
  outcome.
- **The default is `cpu`, i.e. what shipped before the picker existed**, so a new
  control does not move every screenshot and pixel assertion in the suite.
- **`none` disables the height ramp (DEC-R3-17)**, because `terrainDebug`
  re-colours the ground plane _in place_ rather than adding a surface — with no
  plane it would be a switch that does nothing, which is the shape of half of
  round 3's findings. Disabled rather than hidden, value preserved.

## Examples

```ts
for (const mode of GROUND_MODES) picker.append(optionFor(mode));

const ground = parseGroundMode(store.getState().osmView.groundMode);
buildingView.setGroundDisplacement(ground);
layerToggles.setAvailable("terrainDebug", groundDebugAvailable(ground));
```

## Tests

`ground-mode.test.ts` covers the two ways this fails silently: an unknown value
leaving the scene with no ground and no explanation, and `none` failing to
disable the ramp. End to end, `osm-demo.spec.js`'s _"the ground mode picker"_
block asserts the picture changes on `none`, that the mesh layers are NOT cleared
with it, and that the ramp is disabled-but-still-checked while it is selected.
