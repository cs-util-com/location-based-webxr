# panel-layout.ts

## Purpose

Pure layout + hit-mapping for an in-world transport panel drawn on a
`CanvasTexture`: the one place that knows _where_ the play/stop button and
progress-bar track live, expressed as UV rectangles, so the same layout both
draws the panel and decides what a raycast hit means. The view raycasts the
panel, reads the hit UV, and asks `hitToAction` what to dispatch — no
renderer involved in the decision.

## Public API

- **`PanelLayout`** — `{ button: Rect, track: Rect }`.
- **`DEFAULT_PANEL_LAYOUT: PanelLayout`** — button on the left, track to its
  right, vertically centred; the two rects are disjoint so button-first
  resolution in `hitToAction` is unambiguous.
- **`PanelTapAction`** — `Extract<TransportAction, { type: 'toggle' | 'seek' }>`.
- **`hitToAction(uv: { u, v }, layout = DEFAULT_PANEL_LAYOUT): PanelTapAction | null`**
  — `toggle` on a button hit, `seek` at the fraction along the track's width
  on a track hit, `null` otherwise (panel padding/chrome).

## Invariants & assumptions

- UV convention matches `THREE.PlaneGeometry` intersection UVs: origin
  `(0,0)` is the bottom-left of the front face.
- The button is resolved before the track, so an overlapping layout would
  still resolve deterministically (the default layout keeps them disjoint).
- Depends on `clamp.ts` and `panel-geometry.ts`.

## Examples

```ts
import { hitToAction } from 'gps-plus-slam-app-framework/visualization';

const action = hitToAction({ u: 0.5, v: 0.4 }); // { type: 'seek', fraction: 0.3 }
```

## Tests

- `panel-layout.test.ts` — button hit → `toggle`, track hit → `seek` with the
  expected fraction (including edges), and a miss (padding/chrome) → `null`.
