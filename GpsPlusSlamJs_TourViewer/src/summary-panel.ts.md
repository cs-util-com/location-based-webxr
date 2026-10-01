# summary-panel.ts

## Purpose

The summary after Finish, on the page (authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§1 item 5, §3.3, milestone M3b): one row per code with its verdict and the
numbers behind it (folded away), the map, and the way back into AR. The
creator setup builds the model (`summary-model.ts`) at each successful
Finish and hands it here.

## Public API

- `createSummaryPanel({ dom, doc, loadMap, startAr }): SummaryPanel`
  - `dom`: `root` (`#summary`, inside `#finish-block`), `codes`
    (`#summary-codes`), `map` (`#summary-map`), `mapStatus`
    (`#summary-map-status`), `startAr` (`#summary-start-ar`).
  - `loadMap`: the dynamic import of `summary-map-view.ts` (`main.ts`).
  - `startAr`: the page's own Start AR setup (`main.ts` clicks `#enter-ar`).
  - `SummaryPanel`: `show(model)` replaces any earlier summary; `hide()`
    drops it and its map (a new AR visit, a closed tour).
- `SUMMARY_MAP_TEXT`: the map's words per state (`loading`, `ready`,
  `failed`, `empty`).

## Invariants & assumptions

- **The map loads on demand and says so** (CLAUDE.md, "UI feedback for
  async actions"): `data-state="loading"` with "Loading the map..." while
  the import runs, then `ready` (the line hidden) or `failed` ("The map
  could not load (offline?). The verdicts above still hold."), on the
  status line and the map container. A map module that refuses to draw is
  a failure too. With nothing to frame the map is not loaded at all
  (`empty`).
- **The verdicts never wait for the map**: the rows are written before the
  import starts and stay whatever it does.
- **A late load never draws into another summary**: every `show` and
  `hide` bumps a generation; a load that lands after either is dropped.
  The previous map is destroyed before a new one is drawn into the same
  container.
- "Back to authoring" is "Start AR setup" again (plan §3.3): the button
  hands its tap to the page's own AR entry inside the same user gesture,
  so a session request still has its user activation.
- Text is set with `textContent` only; labels and numbers are never
  markup.
- Rows carry `data-testid="summary-code"` and `data-verdict` (the kind);
  the verdict span `summary-verdict`, the numbers `summary-numbers`.

## Examples

```ts
const summary = createSummaryPanel({
  dom,
  doc: document,
  loadMap: () => import("./summary-map-view.js"),
  startAr: () => enterArButton.click(),
});
summary.show(buildSummaryModel(input));
```

## Tests

- `summary-panel.test.ts` (fake elements; this package's unit tests run
  without a DOM): rows and numbers before the map, loading then ready,
  failure on a rejected import and on a refused draw, no load with nothing
  to frame, late loads dropped and old maps destroyed, Start AR setup.
- `playwright-tests/summary.spec.js`: the real page - a Finish shows the
  code, its facing line, its verdict and the pin; a refused import says
  so while the verdict stays; Start AR setup re-enters AR.
