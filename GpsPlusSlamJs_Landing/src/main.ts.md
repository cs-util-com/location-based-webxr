# `main.ts` — landing-page bootstrap

## Purpose

The only impure entry point: gathers browser signals, decides the quality
tier, boots the theme controller and the 3D scene controller, and wires
scroll/resize/toggle events to them. Everything it composes is a tested
pure module; `main.ts` itself stays thin glue (verified manually — see
Tests).

## Public API

None (side-effect entry module loaded by `index.html`).

## Invariants & assumptions

- **Boot order:** capability tier → scene controller → theme controller.
  The theme controller is created AFTER the scene so its initial
  `applyTheme` reaches both the DOM and the 3D palette in one call.
- **Fallback behavior:** `static-dom` tier or failed renderer creation →
  `body.no-webgl` (hides the canvas layer, restores full-opacity copy
  panels); the DOM copy stands alone. Missing chapter sections are
  console-warned, never fatal.
- **Modes:** `scroll` → target-progress scrubbing + auto-intro when the
  page loads at the top (first scroll past 40px skips the intro);
  `reduced-motion` → chapter end-state seeks on chapter change only.
- Scroll listener is passive; section metrics are re-measured on resize.
- The initial theme read from `document.documentElement.dataset.theme`
  (stamped by index.html's FOUC guard) is only a pre-boot hint for the
  scene; `createThemeController` re-resolves and re-applies immediately.
- The fire-and-forget `detectImmersiveArSupport` promise feeds BOTH Z6
  consumers: the CTA claim upgrade (`ar-support.ts`) and the desktop
  QR handoff (`qr-handoff.ts`, v2 B2 — fine pointer + ≥768 px viewport,
  QR encodes `location.href`).
- `visibilitychange` AND `pageshow` are wired to `scene.setPageVisible`
  (v3 F2 + round-9 R9-6): the continuous particle render stops entirely
  while the tab is hidden, and the flag self-heals after a bfcache
  restore (which can deliver `pageshow` without a
  visibilitychange-to-visible — the observed "frozen fireflies" bug
  after navigating away and back in the same tab).
- The hero snippet default (round-9 R9-5, `hero-snippet.ts`) is applied
  first thing in boot: expanded on desktop-class viewports, collapsed
  otherwise (the static HTML ships it closed).
- The chapter dot rail (v3 F6, `chapter-dots.ts`) is filled at boot;
  the scroll state machine drives `updateActiveDot`, clicks scroll the
  scroller to the chapter's measured top (smooth in scroll mode,
  instant under reduced motion).
- "Jump to the demos" (R17b) targets the CTA chapter's measured top via
  the same metrics (round-10 R10-2) — scrolling to `scrollHeight`
  overshot into the FAQ once it existed below the demos hub.
- Easter-egg click glue (catalog §2, scroll mode ONLY — reduced motion
  keeps eggs static): pointerdown/up on the scroller, drag-filtered via
  `isGenuineClick`, skipped on interactive elements and copy panels,
  forwarded to `scene.clickAt` as NDC; egg feedback surfaces through
  `egg-toast.ts` (geocache open → "Cache found" toast).

## Examples

Not applicable — loaded once via `<script type="module" src="/src/main.ts">`.

## Tests

No unit tests (thin impure glue; all logic lives in the imported tested
modules). The Playwright smoke suite (`playwright-tests/scroll-story.spec.js`)
exercises this wiring end-to-end in a real browser: boot + chapter
activation without console errors, canvas-or-floor, navigation, theme
persistence, reduced motion. The remaining coverage is the manual pass per
the plan's verification section: desktop Chrome/Firefox, Android phone,
both themes, no-WebGL (WebGL disabled via browser flag).
