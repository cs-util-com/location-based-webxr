# `attribution-view.ts`

## Purpose

The map's attribution line: a short name for every credited source, always
visible, with the full credit text behind an "Attributions" expander.

## Public API

- `new AttributionView()` — builds the element; starts hidden and empty.
  - `.element: HTMLElement` — the control's root. Carries both
    `leaflet-control-attribution` and `map-attribution`.
  - `.setEntries(entries: readonly AttributionEntry[]): void` — replaces the
    credited sources. Idempotent, order-preserving, and **restores** the
    expanded state rather than resetting it. An empty list hides the element.
- `AttributionEntry` — `{ short, full, href? }`.

No error modes: every input is a string and every path renders. A malformed
entry produces a visible oddity, never an exception, which is the right failure
for a control whose job is to keep a credit on screen.

## Invariants & assumptions

- **EVERY SOURCE IS NAMED WITHOUT INTERACTION (DEC-W1).** Only the long credit
  text collapses. This is the invariant with a licence behind it rather than a
  preference:
  - ODbL requires the OpenStreetMap credit to be reasonably visible wherever the
    data is shown, and this view shows both the basemap tiles and data derived
    from OSM.
  - `map-view.ts` and `main.ts` both record that the elevation credits are
    required **"the same as the OSM one"** — which is why they were put in the
    always-visible attribution bar and explicitly _not_ in the collapsible
    header. The first plan for this milestone put them behind the tap on the
    reasoning that only ODbL was in play; that was false and the cold review
    caught it (finding F6).
  - The owner asked for "one word per attribution" in a thin line. One short
    name each is exactly that — so the request and the obligation are the same
    design here, not a compromise between two.
- **The demo owns this control; Leaflet's is switched off.** `Control.Attribution._update`
  ends by assigning `innerHTML` on its container and runs on **every**
  `addAttribution`/`removeAttribution` — which `MapView.setTerrainAttribution`
  calls on every terrain apply. An expander injected into Leaflet's control
  would be destroyed mid-session at random, taking the user's expanded state
  with it. There is no hook that survives it (finding F5).
- **The expanded state survives a re-render**, because that is the only reason
  owning the control pays for itself.
- **Built with `textContent`, never a template string** — the rule
  `legend-view.ts` states and for the same reason. Credit strings are
  externally-authored text; avoiding the HTML sink beats escaping through one.
- **It keeps the `leaflet-control-attribution` class deliberately.** Leaflet's
  stylesheet then gives it the right look for free, and every existing e2e
  locator addresses the bar by that class — so replacing the rendering did not
  also mean rewriting the suite's selectors.
- **This file is DOM only.** The Leaflet wiring lives in `map-view.ts`, the same
  split `locate-control.ts` / `locate-state.ts` uses, and the reason is that no
  unit test in this package instantiates a Leaflet map.

## Examples

```ts
const attribution = new AttributionView();
attribution.setEntries([
  {
    short: "OpenStreetMap",
    full: "© OpenStreetMap contributors",
    href: "https://www.openstreetmap.org/copyright",
  },
  ...DEM_ATTRIBUTION_ENTRIES,
]);
```

## Tests

`attribution-view.test.ts` (jsdom), eight cases. The one carrying the weight is
the first: **every source is named in the resting line with no interaction**.

- **It asserts on the RESTING line's own nodes, not on `textContent` of the
  whole control**, and that distinction is the whole point. The e2e that used to
  guard this used `toContainText`, which reads `textContent` and therefore
  matches CSS-hidden nodes — so it would have kept passing over a credit hidden
  behind the expander, silently, on the one rule in this app with legal weight
  (finding F10). That guard is migrated to visibility-based assertions.
- The re-render case pins the reason the control exists: expanding, then
  changing the entries, must not collapse the panel.
- The removal case exists because crediting a DEM source whose tiles all failed
  would be a claim about what is on screen.
- The markup-injection case pins the `textContent` rule against a future
  refactor to template strings.
