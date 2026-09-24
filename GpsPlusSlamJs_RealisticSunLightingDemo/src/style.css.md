# `src/style.css`

## Purpose

Glassmorphic dark styling for the Realistic Sun Lighting AR HUD, controls, metric pills, and WebXR DOM overlay stacking.

## Public API

CSS stylesheets consumed by `index.html`.

## Invariants

- `#ar-root` sits as the fixed root overlay containing `#status-panel` and `#enter-ar`.
- Interactive overlay elements have `pointer-events: auto`, while root backdrop has `pointer-events: none` to permit WebXR hit testing and scene gestures.

## Examples

```html
<link rel="stylesheet" href="./src/style.css" />
```

## Tests

Covered by visual integration and DOM overlay nesting guard `tests/repo-config/hud-overlay-nesting.test.js`.
