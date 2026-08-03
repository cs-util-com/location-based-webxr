# `site-picker.ts` — the example-location picker

## Purpose

Populates the header's location `<select>` from `PICKER_PLACES` and reports the
chosen place's position, so the demo can be moved to any of fourteen famous
places without editing a URL.

## Public API

- `attachSitePicker({ select, onChoose }): SitePicker`
  - `select` — the `<select>` to populate. Its children are **replaced**, so
    re-attaching is idempotent and the markup carries no place names.
  - `onChoose(position: LatLng)` — called once per user choice. Never called for
    an unrecognised value.
  - Returns `{ dispose() }`, which removes the listener.

## Invariants & assumptions

- **The options ARE `PICKER_PLACES`, in order, tooltips included.** A
  hand-written list inside this file would look identical on screen and silently
  reintroduce drift. `site-picker.test.ts` asserts identity with the list, not a
  count.
- **It no longer reads `CORPUS_SITES` (DEC-R6b-1), and the guarantee that
  change gave up is enforced elsewhere.** Until round 7 the picker rendered the
  fixture corpus so that the reachable places were the covered places. The sixth
  session made that untenable — corpus sites are chosen for being awkward to
  render, several deliberately unphotogenic. The property is preserved by
  `?site=<id>` reaching every corpus site whether or not it is in the dropdown,
  asserted in `start-position.test.ts`. **If you are looking for the anti-drift
  test, it is there, not here.**
- **Nothing is preselected**, even though option 1 is now where the demo opens.
  The demo may have started from `?lat=&lng=`, from `?site=`, from the locate
  button or from a map click, and only some of those are places in the list. A
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
