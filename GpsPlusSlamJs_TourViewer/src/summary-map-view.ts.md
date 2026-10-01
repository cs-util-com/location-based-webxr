# summary-map-view.ts

## Purpose

The summary's map (authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§3.3, milestone M3b): the model of `summary-model.ts` drawn with Leaflet
through the framework's summary map shell
(`gps-plus-slam-app-framework/visualization/summary-map-shell`, moved out of
the Recorder under DEC-H3) and its shared trajectory drawing
(`map-overlay-draw`).

## Public API

- `drawSummaryMap(container, model): SummaryMapShell | null` - the map in
  `container`, framed on `model.fitPoints`, with a fullscreen toggle styled
  by the page (`summary-map-expanded`, `summary-map-toggle`); null when the
  shell refuses (nothing to frame, Leaflet threw).
- `drawSummaryLayers(map, model, doc): L.Layer[]` - every layer over the
  basemap:
  - each visit's walk through `drawMapData` (raw GPS yellow with accuracy
    circles, fused cyan), ONE CALL PER VISIT so visits are never joined;
  - each pin and photo: a white dot (`tv-summary-pin` / `tv-summary-photo`)
    with a permanent label (`tv-summary-object-label`);
  - each code: a solid ring at the stored pose's own predicted error
    (`tv-summary-ring`, when a visit this device kept saved it), a dashed
    ring at the estimate's (`tv-summary-estimate-ring`) where the estimate
    is drawn or where nothing else rings the code (M3a/M3b review #2), a
    filled dot at the stored pose (`tv-summary-code`) with its facing line
    (`tv-summary-facing`, weight 5) and the label "<code>: <what visitors
    get>" (`tv-summary-code-label`); where the visits' estimate differs, a hollow
    dot (`tv-summary-estimate`) and a dashed line
    (`tv-summary-estimate-facing`). A code the tour does not store yet is
    labelled on its estimate.
- `CODE_COLOR`, `OBJECT_COLOR`.

## Invariants & assumptions

- **Loaded only by a dynamic import** (`main.ts` hands
  `() => import("./summary-map-view.js")` to `summary-panel.ts`). This is
  the one Tour Viewer module that imports Leaflet, Leaflet's CSS and the
  framework's map modules, so a visitor never downloads them
  (`summary-map-lazy.test.ts` reads the import graph; the Playwright
  summary spec checks the network).
- **Labels are text, never markup**: each tooltip's content is an element
  whose `textContent` is set. A pin's label comes from a zip anyone can
  write, and Leaflet renders a string tooltip as HTML.
- **The container declares `position: relative`** (`index.html`):
  Leaflet's `_initLayout` and the framework shell's toggle both set an
  INLINE `position: relative` on a container that is not positioned, and
  an inline style beats the page's
  `#summary-map.summary-map-expanded { position: fixed }` - "Enlarge"
  collapsed the map to 0 x 416 px (M3a/M3b review #1). The CSS alone was
  not enough: the shell checked only the inline style and the Recorder's
  `relative` class, so it now checks the computed position too. The e2e
  taps Enlarge and measures the box against the viewport.
- No default marker icons (they would fetch images); every mark is a
  vector `circleMarker`, so the only network requests are tiles.
- The code colour stands apart from the yellow and cyan of the shared
  trajectory layers.
- Tiles come from the framework's `addOsmTileLayer` (the shell); the e2e
  answers them locally.

## Examples

```ts
const { drawSummaryMap } = await import("./summary-map-view.js");
const shell = drawSummaryMap(container, model);
shell?.destroy();
```

## Tests

- `summary-map-view.test.ts` (Leaflet recorded by `vi.mock`): the stored
  code's dot, line, ring and label; the estimate only where it differs;
  the estimate's ring where it is drawn or the stored pose's error is
  unknown;
  a code only the visits know labelled on its estimate and a flat code
  without a line; labels as text; one track per visit.
- `summary-map-lazy.test.ts`: nothing else on the page imports Leaflet or
  the map modules, however deep.
- `playwright-tests/summary.spec.js`: the drawn SVG on the real page.
