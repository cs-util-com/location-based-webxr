# summary-map-shell.ts

## Purpose

The 2D summary map's shell: a Leaflet map with the OSM basemap, the shared
trajectory layers (`map-overlay-draw.ts`), the app's own layers on top, an
optional fullscreen toggle, and a clean, idempotent `destroy`.

Moved out of the RecorderApp (`ui/summary-map.ts`) on 2026-10-01 under
DEC-H3, when the Tour Viewer's summary after Finish became the second
consumer (Tour Viewer authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§3.3, milestone M3b). What the two apps do differently is passed in, never
forked.

## Public API

- `createSummaryMapShell(container, data, options?): SummaryMapShell | null`
  - `data: SummaryMapShellData` - `rawGpsPath` (yellow polyline, an
    accuracy circle per sample with `accuracy`), `fusedPath` (cyan),
    optional `alignmentSnapshots` (red).
  - `options: SummaryMapShellOptions`:
    - `drawExtra(map) => L.Layer[]` - the app's layers (the Recorder's
      reference points; the Tour Viewer's codes, facing lines, rings and
      pins), drawn after the trajectory and removed on `destroy`.
    - `fitPoints` - frame these points (`fitBounds`, padding
      `SUMMARY_MAP_FIT_PADDING`, at most `SUMMARY_MAP_FIT_MAX_ZOOM`)
      instead of centring on the final position.
    - `initialZoom` - the zoom a centred map opens at
      (`SUMMARY_MAP_INITIAL_ZOOM` = 15).
    - `fullscreen` - `expandedClasses`, `inlineClasses`,
      `buttonClassName`, `hiddenClass`: the app's own styling. Without it
      no toggle is drawn.
  - `SummaryMapShell`: `destroy()`, `expand()`, `collapse()`,
    `isExpanded()`.
- Constants: `SUMMARY_MAP_INITIAL_ZOOM` (15), `SUMMARY_MAP_FIT_PADDING`
  (`[20, 20]`); module-private `SUMMARY_MAP_FIT_MAX_ZOOM` (18).

## Invariants & assumptions

- **Null, never a throw**: no container, nothing to show (no path and no
  `fitPoints`), or Leaflet or `drawExtra` throwing all return null; a map
  that failed half way is removed.
- **View**: without `fitPoints` the map centres on the final raw position
  (else the final fused one). This is the Recorder's rule (user feedback
  2026-06-02: fitting far-away prior reference points shrank the walk to a
  dot). With `fitPoints` it frames them; that is the Tour Viewer's rule,
  whose codes and pins exist without any walk.
- `SUMMARY_MAP_FIT_MAX_ZOOM` 18: one code and one pin a metre apart would
  otherwise open at the tiles' ceiling (19), where the basemap says nothing
  about where the place is; 18 shows about 150 m across a phone screen. 19
  would win only if a summary had to separate objects under a metre apart,
  which no GPS-placed content can be.
- `destroy()` is idempotent, removes the toggle buttons and their
  listeners, every layer (tiles, trajectory, app layers) and the map, and
  cancels the pending resize timers (a timer must never resize a removed
  map). `expand()`/`collapse()` are idempotent and no-ops after destroy.
- Container positioning: with a toggle, a container whose COMPUTED
  position is static is given `position: relative` (inline style,
  framework-neutral) so the absolutely placed buttons sit inside it. A
  container the app positions (a stylesheet rule, the Recorder's
  `relative` class) is left alone: an inline style beats every rule, so
  the app's fullscreen `position: fixed` lost and the Tour Viewer's
  enlarged map collapsed to 0 px (Tour Viewer M3a/M3b review #1). Leaflet
  makes the same computed check in `_initLayout`, so the app must declare
  the position itself.
- **Leaflet is a static import here**, so an app that must not ship it to
  every visitor imports this module dynamically (the Tour Viewer's
  `summary-map-view.ts`). Not re-exported from the `visualization` barrel
  (the barrel feeds the package root; deep-import it).
- Leaflet's CSS is the app's to load.

## Examples

```ts
import { createSummaryMapShell } from 'gps-plus-slam-app-framework/visualization/summary-map-shell';

const shell = createSummaryMapShell(
  container,
  { rawGpsPath, fusedPath },
  {
    fitPoints: [{ lat: 47.5, lng: 8.7 }],
    drawExtra: (map) => [L.circleMarker([47.5, 8.7]).addTo(map)],
  }
);
// later
shell?.destroy();
```

## Tests

- `summary-map-shell.test.ts` (jsdom, Leaflet mocked): null on missing
  container or data, the OSM tiles and the shared trajectory, centring vs
  framing, `drawExtra` and its cleanup, a throwing layer, the resize timer
  after destroy, the toggle's classes and buttons.
- The Recorder's `ui/summary-map.test.ts` keeps covering the composed
  Recorder map (reference points, Tailwind classes, centring) through this
  shell.
