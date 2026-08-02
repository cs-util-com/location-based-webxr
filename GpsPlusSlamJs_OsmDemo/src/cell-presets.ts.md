# `cell-presets.ts`

**Purpose:** named looks for the affordance grid, cycled by a hotkey — the whole
of §3, which is a structured experiment rather than a feature.

## Public API

- `CELL_PRESETS` — the looks, in cycling order, starting at the default.
- `DEFAULT_CELL_PRESET` — `"current"`, the shipped look the e2e suite pins.
- `cellPreset(name)` — falls back to the default rather than throwing.
- `nextCellPreset(name)` — wraps; an unknown name restarts the cycle.
- `needsMeshRebuild(from, to)` — whether the change touches the vertex buffers.
- `CELL_PRISM_HEIGHT_M` (0.03), `CELL_BAR_MAX_HEIGHT_M` (8).

## The four axes

- **`opacity`** — the specular is exactly the part alpha eats, so 0.55 gives 55 %
  of the highlight the lit material exists for. Fully opaque hides the ground,
  which since §2 is the slope treatment — so this trade got _more_ expensive.
- **`extrude`** — real side faces instead of a faked bevel. Two rings, not
  per-face sides: 2× the vertices rather than 5×, at the cost of edges that
  shade as a rounded bevel rather than as crisp facets.
- **`heightByScore`** — the "Inversion" prototype's bar field. Colour and height
  then encode one value, both via `heatFraction`, so they cannot contradict each
  other. **The axis most in tension with DEC-R4-5.**
- **`fog` / `liftM`** — nearly free. `fog: false` is a **no-op today** (cells
  reach ~250 m, haze starts at 1584 m) and stops being one after §6.

## Invariants & assumptions

- **Every preset states every axis.** A preset that omitted one would inherit
  whatever the previous look left behind, making two runs of the same named
  preset different and the comparison worthless.
- **The default is in the list and is first**, so the hotkey walks away from
  what shipped rather than towards it, and cycling can return to it.
- **Only two axes cross the worker boundary.** Opacity, fog and lift are a
  material and a transform; republishing for them would make every press wait on
  up to ~2 989 cells and the hotkey would feel broken.
- **A plain prism stays inside the 0.04 m per-layer budget** (`layer-order.ts`).
  A bar deliberately does not — if bars win, the ladder is what gets revisited.

## How this file ends (DEC-R6-22)

When a preset wins it becomes the default and the losing branches are deleted in
the same commit as the decision. **That cannot happen until §6 has landed**,
because the opacity and fog axes are both premised on the wider heat radius.

## Tests

- `cell-presets.test.ts` — the table's completeness and uniqueness, the default
  being the shipped look, the cycle being a cycle, the rebuild predicate, and
  the layer-ladder bound.
- `cell-mesh-prisms.test.ts` — the geometry the two worker-side axes produce.
- The e2e `the affordance-tile look presets` — the key cycles, each preset
  reaches the screen, and the default is `current`.
