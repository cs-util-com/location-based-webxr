# `then-now-check.html` - then and now's Swipe without an AR session

## Purpose

A standalone check page, linked from nothing, that shows one then-and-now
picture with its production part (`viewpointWorld`), seen from exactly
its viewpoint, so the visitor's slider is open at once and Swipe can be
tried with a mouse on a desktop, and so the e2e can drag the line and read
the cut.

It is a Vite build entry (`vite.config.ts`), so it is built and reachable
on a deployed branch preview at `/tour/then-now-check.html`; nothing in
the Tour Viewer imports it. Its code is `src/checks/then-now-check.ts`
(`src/checks/then-now-check.ts.md`), which documents the hook
`window.__thenNowCheck`. The page copies the visitor page's screen host
rules (`#narration-card-root`), so the panel sits where it sits there.

## What it shows

"Today" as a plain blue backdrop and the old picture as a red one with a
light grid. Choose Swipe in the panel and drag the round knob: red stays
left of the line, blue right of it.

## What it does not show

The camera image, walking up to the spot (the eye is on it from the
start), the spot guide on the way in, and the AR session's gestures.

## Tests

`playwright-tests/then-now-check.spec.js`.
