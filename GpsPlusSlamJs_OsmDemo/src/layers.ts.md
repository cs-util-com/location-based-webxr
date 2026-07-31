# `layers.ts`

## Purpose

Names every render layer, and holds the enabled set as plain, immutable data.

## Public API

- `ALL_LAYERS` — the ordered tuple; `LayerKind` is derived from it.
- `LayerSet` — `Readonly<Record<LayerKind, boolean>>`, exhaustive by construction.
- `DEFAULT_LAYERS` — every layer except `terrainDebug` (W9).
- `isLayerEnabled`, `toggleLayer` (returns a new set), `serialiseLayers`,
  `parseLayers`.

## Invariants & assumptions

- **This seam is the deliverable, not the builders (DEC-R2-12).** The feedback asked
  for modularity so a later AR mode can request buildings + POI markers and skip
  ground plates. Individual builders are each straightforward; the seam is what is
  expensive to retrofit, so it landed first and the two existing layers were migrated
  through it **before** any new one was written.
- **Independent toggles, not a two-state mode (DEC-R2-10).** A mode makes it
  impossible to view a merged area _over_ the cells that produced it — the first
  check anyone runs when a region looks wrong. One mechanism therefore covers both
  the layer question and the cells/areas question.
- **`DEFAULT_LAYERS` is everything except the diagnostic (W9, DEC-R4-4).** It used
  to be `cells`, `buildings`, `trees` — the three the demo shipped with — because
  the W10 registry migration needed a known-good baseline to compare against. That
  migration is complete, so what remained was the historical order in which builders
  happened to be written, which is not a fact about what a user should see.
  - It is DERIVED from `ALL_LAYERS` rather than listed, so a new layer is on by
    default and the test cannot go stale by omission.
  - `terrainDebug` is the one exclusion, asserted separately so a bulk flip cannot
    quietly take it along: it re-colours the ground rather than adding a thing to
    the world, and DEC-R3-17 already disables it when there is no ground to colour.
  - **Cost, stated rather than discovered (N7):** every layer on multiplies the
    per-publish rebuild, which is why W6/W7 (instancing) and W10 (the draw-call
    readout) land before this.
- **A plain record, never a `Set`.** This lives in a Redux slice: a `Set` is rejected
  by RTK's serialisability scan and dropped by `structuredClone` — silently, in the
  clone's case, so it would break the worker boundary without an error.
- **Every set has every key.** `setOf` builds from `ALL_LAYERS`, not from its input,
  so `isLayerEnabled` can never return `undefined` for a layer someone forgot — which
  would read as "off" while being a different thing.
- **`parseLayers` treats its input as untrusted** (it is a candidate URL parameter):
  unknown names are discarded rather than added, or they would be keys nothing could
  switch off and `LayerSet`'s exhaustiveness would be a lie.
- **An empty string means NO layers, not the default.** "Show nothing" has to be
  expressible, or a user who switches everything off gets the default back on reload
  with no explanation.

## Examples

```ts
const next = toggleLayer(DEFAULT_LAYERS, "roads", true);
if (isLayerEnabled(next, "roads")) buildRoads(features);
```

## Tests

`layers.test.ts` — 8 examples: the union is pinned against `ALL_LAYERS`, the default
matches the shipped picture, a toggle disturbs nothing else, the set is immutable
(a mutation would update store state without a dispatch, so subscribers would never
fire), the serialised form round-trips, unknown names are ignored, and an empty
string is distinct from the default.

## The scene is swapped WHOLE, never layer by layer (F5)

Stated here, once, before W12–W15 add four more independently-timed layers. It
is enforced in four separate places today and nothing named it, which is how a
fifth arrival gets it wrong.

**The invariant.** Every layer on screen at any instant describes the _same
position and the same working set_. There is no frame in which one layer belongs
to the previous place and another to the current one.

That is not fussiness about a single frame. Each layer is individually plausible,
so a half-swapped scene does not look broken — it looks like _data_. Buildings
from the last click standing on this click's terrain is a city on the wrong hill,
and the status line agrees with it, because the status line is built from what
was drawn. Nothing in the picture says which half is stale.

**Where it is enforced, and what each one covers:**

- `latest-only.ts` — coalesces overlapping runs to the newest intent, so a burst
  of clicks produces one result rather than a race between several.
- `refresh-cycle.ts` — hands the mesh over **before** dispatching the snapshot.
  A dispatch-first order would run the snapshot subscriber with the previous
  position's mesh still in place, drawing one frame of the wrong buildings.
- `refresh-cycle.ts` and `terrain-cycle.ts` — each re-check `signal.aborted`
  _after_ the await. If a reply has already landed when a newer input arrives,
  the abort has nothing to cancel and the continuation would otherwise apply a
  superseded result. Both guards were added after a PR review found the second
  one missing.
- `terrain-cycle.ts` — one `apply` for all four UI writes, so relief, note,
  field and status move as a unit.
- `building-view.ts` — `clearScene()` and `resize()` repaint rather than only
  clearing, because on an on-demand renderer a cleared buffer is never
  overwritten by anything else.
- `height-ramp.ts` via `setTerrain` — the ramp is normalised over the field's own
  range, so a new field is a new range and the colours are recomputed with it.

**What a new layer (W12 POI, W13 roads, W14 slabs, W15 regions) must do:**

- **Arrive through the existing snapshot/mesh handover.** Do not give a layer its
  own fetch or its own async lifetime. A layer that loads independently is a
  layer that can be one refresh behind, and no amount of care at the draw call
  fixes that.
- **If it genuinely cannot** — an imagery tile is the plausible future case —
  then it must carry the identity of the working set it belongs to, and be
  dropped rather than drawn when that no longer matches. "Draw it late" is not
  an option; late and wrong are the same picture.
- **Report its counters from what was drawn**, which `mesh-layers.ts` now does by
  construction: a row that is off contributes zeros rather than the mesh's value.

**The rule this all reduces to:** a layer may be absent, and a layer may be
current, but a layer may never be _stale_. Absence is visible and self-reporting;
staleness is invisible and self-consistent.
