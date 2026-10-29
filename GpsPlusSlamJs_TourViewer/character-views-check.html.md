# `character-views-check.html` - a tour character in each world view

## Purpose

A standalone check page, linked from nothing, that stands one tour character (the station-blocks-7 prototype's knight, Wendel the Warden) in one of his world views (`bubble`, `speak`, `two-stations`, `portrait`, `popup`) as `src/character-look.ts` draws him, in a plain daylight scene with the prototype's numbers. It exists so that the views can be put side by side with their prototype (`public/prototypes/station-blocks-7-character/`) without an AR session, and so that the layout e2e (`playwright-tests/character-views.spec.js`) can pin where his parts land.

It is a Vite build entry (`vite.config.ts`), so it is built and reachable on a deployed branch preview at `/tour/character-views-check.html`; nothing in the Tour Viewer imports it. Its code is `src/checks/character-views-check.ts`; its figure is the knight's frames sheet `public/checks/character-knight-sheet.webp` (2048 x 1024, WebP at quality 0.85): the prototype's own procedural `drawKnight` (`public/prototypes/station-blocks-7-character/index.html`, the code from `const FW = 512` to `function silhouette`) drawn into four 512 x 1024 cells as its frames 0, 2, 1, 3 - idle, talk-a (half open), talk-b (open), beckon - because the prototype numbers its mouth frames the other way round (its 1 is open, its 2 half). Rendered once in a headless Chromium (Playwright) with `canvas.toDataURL("image/webp", 0.85)`; to re-render, run that code in a page the same way. It replaced `character-knight.webp` (frame 0 alone).

## Two modes

- **Demo, for a person** (the plain URL): a bar of buttons at the top switches the view; `two-stations` beckons toward the page's second station and `portrait` speaks.
- **Hook, for tests** (`?hook=1`): no bar; the page is driven through `window.__characterViewsCheck` (installed in both modes; see `src/checks/character-views-check.ts.md`).

## Not copied from the prototype

The prototype's surroundings (the walls, the paving, the other station's props) and its DOM portrait card: the build shows the portrait in the walk card (`#scene-portrait` in `index.html`), not on this page.
