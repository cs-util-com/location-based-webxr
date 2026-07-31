# `site-picker.ts` — the example-location picker

## Purpose

Populates the header's location `<select>` from the shared corpus table and
reports the chosen site's position, so the demo can be moved to any of the six
places it is tested at without editing a URL.

## Public API

- `attachSitePicker({ select, onChoose }): SitePicker`
  - `select` — the `<select>` to populate. Its children are **replaced**, so
    re-attaching is idempotent and the markup carries no place names.
  - `onChoose(position: LatLng)` — called once per user choice. Never called for
    an unrecognised value.
  - Returns `{ dispose() }`, which removes the listener.

## Invariants & assumptions

- **The options ARE `CORPUS_SITES`, in order.** A hand-written list here would
  look identical on screen and silently undo DEC-R4-11 — the places a human can
  reach would stop being the places the fixture suite covers, which is the blind
  spot that produced the round-3 cathedral finding. `site-picker.test.ts`
  asserts identity with the table, not a count.
- **Nothing is preselected.** The demo may have started from `?lat=&lng=`, from
  the locate button, or from a map click, none of which are corpus sites. A
  picker naming a place the view is not at is the control contradicting the
  picture. Option 0 is a `"jump to…"` placeholder with an empty value.
- **An unknown value is ignored** — not reported, not thrown. A browser restores
  a stale `<select>` value across a reload when the option list has changed;
  moving the demo to `undefined` would be worse than doing nothing, and throwing
  would take the app down for a convenience control.
- **It reports a position, not an action.** The picker does not know the store
  exists. Choosing a site, clicking the map and pressing locate all dispatch the
  same `positionChanged`, so there is exactly one refresh path.
- **A first visit costs a cold fetch** (18–110 s for an uncached res-7 tile), by
  decision: DEC-R4-11 chose live data over loading the committed extract, on the
  grounds that fixture data looking identical to live data is the "two claims
  that look the same" defect this project keeps removing.

## Examples

```ts
const picker = attachSitePicker({
  select: document.querySelector("#site")!,
  onChoose: (position) => {
    mapView.centreOn(position);
    store.dispatch(actions.positionChanged(position));
  },
});
```

## Tests

- `site-picker.test.ts` (jsdom, per-file environment) — option identity with the
  table including titles, the choose callback and its argument, the unknown-value
  branch, the no-preselection rule, and that `dispose()` really detaches.
- The e2e suite covers the picker actually moving both views.
