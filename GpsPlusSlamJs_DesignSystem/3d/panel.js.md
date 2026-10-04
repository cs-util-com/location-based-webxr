# panel.js - the look-dev control plate's collapse

- Purpose: on a phone the control plate covered the scene (owner feedback,
  programme plan 2026-09-26-0539, W1 M2). The header button folds the whole
  body, each `<details>` section folds on its own, the choice survives a
  reload, and a narrow screen starts folded.
- Public API:
  - `initPanel(doc, { storage?, narrow? })`: wires `.lookdev-head` to
    `#lookdev-body`. It does nothing when either is missing (a lab page
    without a plate). `storage` defaults to `localStorage` (null when
    refused), `narrow` to `matchMedia(NARROW_QUERY)`.
  - `PANEL_STORAGE_KEY` (`"lookdev.panel"`, namespaced because the page
    shares its origin with every app on the branch preview) and
    `NARROW_QUERY` (`(max-width: 600px)`).
  - The module calls `initPanel(document)` when loaded; `index.html` loads
    it as its own module script, beside `lookdev.js`.
  - It also installs the framework's page-wide [`guardSlidersIn(document)`](../../GpsPlusSlamJs_AppFramework/src/utils/slider-scroll-guard.ts.md) (fetched over `/fw/`) when loaded, for
    every page that loads it (the look-dev page, the globe and terrain labs):
    a vertical swipe that starts on a slider scrolls the plate instead of
    editing it (owner report 2026-09-30). Held to it by the root
    `tests/repo-config/slider-pages-load-the-guard.test.js`; proven in a
    browser by `slider-touch.smoke.spec.mjs`.
- Invariants & assumptions:
  - The stored choice (`"open"` or `"collapsed"`) wins over the width; with
    none, a narrow screen starts folded and a wide one open.
  - Storage failures (private windows) are swallowed: the fold works for
    the visit and is not remembered.
  - The error box (`[data-error-box]`) sits outside `#lookdev-body`, so a
    folded plate never hides an error.
  - The plate never scrolls; its body does (`lookdev.css`). A scrolling
    plate carried the design-system stripe away with its content.
  - Sections start open, so every control the smoke tests select is
    visible at the test viewport (1280x800).
- Example: `initPanel(document, { storage: null, narrow: true })` starts
  folded and remembers nothing.
- Tests: `lookdev.smoke.spec.mjs`:
  - "the control plate collapses from its header and per section, and
    remembers it": the header state, a section folding, the reload, the error
    box outside the body, and the plate not scrolling;
  - "the control plate starts collapsed on a phone-width screen": a
    390x780 context.
