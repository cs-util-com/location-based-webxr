# `terrain-cycle.ts`

**Purpose.** Load the heightfield under a position, coalesced so the terrain and the buildings can never be for two different places.

## Public API

- `createTerrainCycle({ provider, extentM, spacingM, apply })` → `LatestOnly<LatLng>`
  - Called with the centre position. Loads a `Heightfield` through `buildHeightfield` and reports it via `apply` exactly once per load that is not superseded.
  - Coalesced through `latestOnly`: at most one load in flight, only the newest waiting position survives, never rejects.
- `interface TerrainState` — `field` (`Heightfield | undefined`; `undefined` means the ground stays flat) and `note` (one status-line phrase, never empty).
- `interface TerrainCycleOptions` — `provider` (`ElevationProvider`), `extentM`, `spacingM`, `apply`.

## Invariants & assumptions

- **This exists because it was the demo's ONE un-coalesced async action.** `refresh` went through `latestOnly` from the start; the terrain load did not, and both are driven by the same click. `TerrariumProvider` caches decoded tiles, so a second click can resolve from cache while the first is still fetching — the older load then lands last and wins. The result is the new position's buildings standing on the old position's relief, with a status line confidently reporting the old position's `reliefM`. Nothing about that symptom points at concurrency, which is exactly why it needs a structural guarantee rather than care.
  - Latest-wins rather than a lock, for the reason `latest-only.ts` gives: refusing a click while a fetch is open would make the map feel broken. The intermediate load is what gets dropped, never the user's final intent.
  - The guarantee is asserted as "only one load is ever open", not as "the stale write is discarded". With one load open at a time the out-of-order interleaving is unrepresentable, which is a stronger property than filtering it after the fact — and it also stops the middle of a click burst from costing DEM requests for ground nobody will see.
- **`apply` reports everything at once, on purpose.** The caller updates four things together — the field the 3D view stands on, its own copy for the next `drawScene`, the status-line note, and the attribution — and they must move as a unit or the screen says one thing while it draws another.
- **`field: undefined` is never a zero heightfield.** `hasData: false` means the ground stays FLAT, not at sea level: a hole shaped exactly like the DEM outage reads as terrain rather than as a failure, and buries the buildings standing in it. `heightfield.ts` makes the same point at more length.
- **The note always says something.** `terrain ±N m` (plus `(missing/total samples missing)` when posts were filled) or `terrain unavailable — ground is flat`. The relief is the one number distinguishing "loaded, and this place is flat" from "did not load" — two facts that render identically.
- **Never rejects.** `buildHeightfield` already swallows a provider failure into a flat field, and `latestOnly` swallows anything else. A DEM outage costs the relief, not the 3D view.

## Examples

```ts
const loadTerrain = createTerrainCycle({
  provider: elevation,
  extentM: TERRAIN_EXTENT_M,
  spacingM: 12,
  apply: ({ field, note }) => {
    terrain = field;
    terrainNote = note;
    buildingView.setTerrain(field);
  },
});

subscribe(
  (view) => view.position,
  (position) => void loadTerrain(position).finally(() => refresh()),
);
```

## Tests

`terrain-cycle.test.ts`, against a provider whose every call the test holds open — the newest position wins even when an older load would have resolved later (only one load is ever in flight); the middle of a three-click burst is dropped; a DEM outage reports flat with an explicit note rather than sea level; the relief and missing-sample counts reach the note; and a rejecting provider still resolves with a flat field.

Related: `latest-only.ts.md` (the coalescing contract), `refresh-cycle.ts.md` (the other half of the same click), `heightfield.ts.md` (what a field is and why it is relative).
