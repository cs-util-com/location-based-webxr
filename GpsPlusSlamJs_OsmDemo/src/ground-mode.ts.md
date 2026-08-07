# `src/ground-mode.ts`

## Purpose

How the ground is drawn: which path displaces it (CPU / GPU / none) and how it is
coloured (neutral / height ramp), as one enumerated picker (W11, DEC-R3-3; W6,
DEC-R5-4).

## Public API

- `GROUND_MODES` — `["cpu", "cpu-ramp", "gpu", "gpu-ramp", "none"]`, in picker
  order. The picker is populated from this, so the two cannot drift.
- `GroundMode`, `GroundStrategy` (`"cpu" | "gpu" | "none"`).
- `DEFAULT_GROUND_MODE` — `"cpu-ramp"`.
- `groundModeLabel(mode)` — what the picker shows.
- `groundStrategy(mode)` — which displacement path the mode drives.
- `groundAppearance(mode)` — `plain` | `slope` | `ramp`.
- `groundShowsRamp(mode)` — whether the ramp material is used (now derived from
  `groundAppearance`).
- `parseGroundMode(value)` — narrows an untrusted string, falling back to the
  default.

## Invariants & assumptions

- **A MODE, NOT A LAYER.** `ALL_LAYERS` means "things the scene can draw", each
  independently; these are one surface drawn several ways and are exclusive.
  W23's `GPU ground` checkbox was deliberately kept out of the registry for the
  same reason, and this keeps it out.
- **The notes asked for `OSM ground / CPU / GPU`, and that shape was wrong.** The
  OSM ground areas are CONTENT — the `plates` layer — while CPU and GPU are
  strategies for the same terrain, so one exclusive picker over all three would
  have made "OSM areas lying on the terrain", the physically correct picture the
  geometry is built for, unselectable. The owner's revision is `CPU / GPU / No
ground` with `plates` staying a layer.
- **FIVE ENTRIES, BECAUSE THE TWO AXES MUST STAY INDEPENDENT (W6, DEC-R5-4).**
  The height ramp used to be `terrainDebug`, a switch in the layer registry, and
  round 5 asked for it to become the default appearance.
  - The obvious fold — `CPU / GPU / Height ramp / No ground` — was offered and
    **rejected**: choosing the ramp would then silently choose a strategy too, and
    the CPU-vs-GPU A/B is the entire reason this picker exists.
  - Enumerating the combinations keeps both reachable **without adding a second
    control** to a header the same round's feedback already calls too busy.
  - **DEC-R3-17 is now true by construction.** There is no `none-ramp` entry, so
    the "greyed out when there is no ground" rule has nothing left to enforce —
    which is why `groundDebugAvailable` and `LayerToggles.setAvailable` were both
    deleted rather than adapted.
- **The ramp was never really a layer.** It re-colours the ground plane _in
  place_ rather than adding a surface, which is why it alone needed a bespoke
  entry in `layer-order.ts` and a bespoke availability rule. Every remaining entry
  in `ALL_LAYERS` is a thing in the world.
- **`parseGroundMode` falls back rather than throwing.** The store holds the mode
  as a plain `string` (the framework may not name a demo type) and this is a
  candidate for a URL parameter, so the input is genuinely untrusted — and "the
  ground vanished because of a typo in a query string" is the worst available
  outcome.
  - **This is also the entire migration for the retired `terrainDebug` value**,
    and that is a finding rather than an omission: nothing persists the demo's
    layer set (`osm-store.ts` uses a plain `configureStore`, with none of the
    framework's persistence middleware) and `parseLayers`/`serialiseLayers` have
    no production caller, so a stored or URL-supplied `terrainDebug` has never
    been reachable.
- **The default is `cpu-ramp` (DEC-R5-4)**, which **overrides DEC-R4-5's "the
  height ramp stays off by default"** taken twenty hours earlier. The reason that
  decision gave has not expired: with building and road colours landed, the
  affordance heat ramp must still be the loudest thing on screen. That is a look,
  and only the owner can settle it.
- **The default must be applied explicitly at boot.** `subscribe` fires on change
  only, so before W6 nothing ever applied the initial mode — it worked because
  three independent defaults agreed: the store's seed, `GROUND_MODES[0]` (what a
  `<select>` shows when nothing sets its value) and `building-view`'s own initial
  field. `cpu-ramp` is not `GROUND_MODES[0]`, so that coincidence is gone and
  `main.ts` calls `applyGroundMode` once at startup.

## Examples

```ts
for (const mode of GROUND_MODES) picker.append(optionFor(mode));

const ground = parseGroundMode(store.getState().osmView.groundMode);
buildingView.setGroundDisplacement(groundStrategy(ground));
buildingView.setGroundAppearance(groundAppearance(ground));
```

## Tests

`ground-mode.test.ts` covers the ways this fails silently: an unknown value
leaving the scene with no ground and no explanation, the retired `terrainDebug`
string still falling back, and — the point of the five-way form — that both
strategies keep both appearances and that no mode combines "no ground" with a
ramp. End to end, `playwright-tests/`'s _"the ground mode picker"_ block asserts
the picture changes on `none`, that the mesh layers are NOT cleared with it, that
the picker offers exactly the five entries, and that `cpu-ramp` is what a fresh
load shows.
