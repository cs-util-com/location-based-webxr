# `index.html`

## Purpose

Entry HTML markup and WebXR DOM-overlay tree for `GpsPlusSlamJs_RealisticSunLightingDemo`.

## Public API

Root document served by Vite and Cloudflare Pages.

## Invariants

- `#status-panel`, `#tap-hint`, and `#enter-ar` are descendants of `#ar-root` to ensure DOM-overlay compositing during WebXR `immersive-ar` sessions.

## Examples

```bash
pnpm run dev
```

## Tests

Covered by `tests/repo-config/hud-overlay-nesting.test.js`.
