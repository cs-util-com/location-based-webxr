# `legend-view.ts`

**Purpose.** Turn a `LegendModel` into DOM nodes in the header. Nothing else.

## Public API

- `class LegendView`
  - `constructor({ container })`
  - `render(scale, category, showBelowThreshold)` — replaces the container's children with the legend for that scale.
  - `clear()` — empties it. Called when a failed refresh leaves no map to explain.

## Invariants & assumptions

- **Thin on purpose.** Every decision lives in `legend-model.ts` and is tested without a browser; this file only creates elements. If a legend question can be asked in a unit test, it belongs there, not here.
- **Built with `textContent`, never a template string.** The category name is a column header from a publicly editable rule sheet. `escape-html.ts` exists because this app already renders sheet-derived text into HTML sinks (Leaflet tooltips); the legend avoids the sink entirely rather than escaping its way through one.
- **The replaced sentence survives as `title` and `aria-label` on `.legend-strip`.** DEC-13: the scale claim is replaced pictorially, not deleted. It is still the on-screen answer to iteration 8's second question, and it stays reachable by hover and by screen reader. The e2e asserts this attribute, so a legend that dropped it would fail rather than quietly pass a "there are swatches" check.
- **`render` replaces rather than diffs.** The legend is a handful of nodes rebuilt at most once per refresh; a diff would be a second source of truth about what is on screen, which is the last thing a view built to be trusted by eye should have. Same reasoning as `MapView.render`.
- Class names (`legend-category`, `legend-strip`, `legend-min`, `legend-max`, `legend-swatch`, `legend-band`, `legend-swatch-<kind>`) are the e2e's handles. Renaming one silently breaks an assertion that was checking a real user-visible claim.

## Examples

```ts
const legendView = new LegendView({
  container: document.getElementById("legend"),
});
legendView.render({ threshold: 1, max: 8 }, "walkable", false);
legendView.clear();
```

## Tests

Covered end to end by `playwright-tests/osm-demo.spec.js`:

- _"reports the scale it is drawing with, as a legend"_ — the legend is visible, has swatches, labels both ends with numbers, and carries `describeScale`'s sentence in its `title`.
- _"switching category redraws the grid"_ — `.legend-category` shows the newly selected category (W2). This is the assertion that makes a redraw visible to a person rather than only to a tooltip.

The model behind it is unit- and property-tested in `legend-model.{test,property.test}.ts`; this file has no logic of its own worth a separate unit test.
